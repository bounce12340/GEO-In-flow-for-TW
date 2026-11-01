#!/bin/sh
set -eu

if [ "${1:-}" = '--help' ]; then
  printf '%s\n' '用法：sh scripts/liekan-deploy.sh' '需要 Docker 和 Docker Compose。首次生成私有配置，构建并启动GEOInflow；再次运行保留配置与数据。'
  exit 0
fi
if [ "$#" -ne 0 ]; then
  printf '%s\n' '用法：sh scripts/liekan-deploy.sh' >&2
  exit 1
fi
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' '请先安装并启动 Docker 和 Docker Compose。' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' '无法连接 Docker，请确认服务已启动，当前用户有访问权限。' >&2
  exit 1
fi
umask 077
mkdir -p .local
deployment_lock=.local/liekan-deploy.lock
# The operating system releases this lock after the shell and its children exit.
exec 9> "$deployment_lock"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    printf '%s\n' '另一个部署正在执行，请等待它结束。' >&2
    exit 1
  fi
elif command -v lockf >/dev/null 2>&1; then
  if ! lockf -s -t 0 9; then
    printf '%s\n' '另一个部署正在执行，请等待它结束。' >&2
    exit 1
  fi
else
  printf '%s\n' '需要系统锁工具 flock（Linux util-linux）或 lockf（macOS）来安全执行部署。' >&2
  exit 1
fi
temporary=''
candidate_override=''
candidate_tag=''
cleanup() {
  cleanup_status=$?
  if [ "$cleanup_status" -ne 0 ] && [ -n "${workers_stopped:-}" ]; then stop_candidate_workers; fi
  if [ -n "$temporary" ]; then rm -f "$temporary"; fi
  if [ -n "$candidate_override" ]; then rm -f "$candidate_override"; fi
  if [ -n "$candidate_tag" ]; then docker image rm "$candidate_tag" >/dev/null 2>&1 || :; fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

if [ ! -e .env ] && [ ! -L .env ]; then
  # Existing volumes need their original configuration, including app and 2FA keys.
  existing_volumes=$(docker volume ls --format '{{.Name}}')
  existing_database=''
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    if printf '%s\n' "$existing_volumes" | grep -Fx "${COMPOSE_PROJECT_NAME}_liekan-data" >/dev/null; then
      existing_database=1
    fi
  elif printf '%s\n' "$existing_volumes" | grep -E '_liekan-data$' >/dev/null; then
    # A lost .env may have contained a custom Compose project name.
    existing_database=1
  fi
  if [ -n "$existing_database" ]; then
    printf '%s\n' '发现已有 GEOInflow 数据库，请恢复原 .env 后再部署，以保留数据库密码、应用密钥和双重验证密钥。' >&2
    exit 1
  fi
  random_secret() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
  database_password=$(random_secret)
  app_secret=$(random_secret)
  two_factor_key=$(random_secret)
  temporary=$(mktemp .local/liekan-env.XXXXXX)
  cat > "$temporary" <<EOF
POSTGRES_USER=liekan
POSTGRES_DB=liekan
POSTGRES_PASSWORD=$database_password
DATABASE_URL=postgresql://liekan:$database_password@127.0.0.1:15435/liekan
APP_SECRET=$app_secret
TWO_FACTOR_ENCRYPTION_KEY=$two_factor_key
DISABLE_TELEMETRY=1
NEXT_TELEMETRY_DISABLED=1
DEFAULT_LOCALE=zh-TW
API_KEY_ENABLED=1
LIEKAN_AI_ENABLED=false
EOF
  # A hard link installs the configuration atomically without overwriting a file.
  ln "$temporary" .env
  rm -f "$temporary"
  temporary=''
  printf '%s\n' '首次安装配置已生成并保存在私有 .env 中。'
fi

docker compose -f docker-compose.liekan.yml config --quiet
compose_configuration=$(docker compose -f docker-compose.liekan.yml config --format yaml)
application_image=$(printf '%s\n' "$compose_configuration" | awk '
  /^services:$/ { in_services=1; next }
  in_services && /^[^[:space:]]/ { in_services=0 }
  in_services && /^  app:$/ { in_app=1; next }
  in_services && /^  [^[:space:]]/ { in_app=0 }
  in_services && in_app && /^    image: / { sub(/^    image: /, ""); print }
' | tr -d "\"'")
database_volume=$(printf '%s\n' "$compose_configuration" | awk '
  /^volumes:$/ { in_volumes=1; next }
  in_volumes && /^[^[:space:]]/ { in_volumes=0 }
  in_volumes && /^  liekan-data:$/ { in_database=1; next }
  in_volumes && /^  [^[:space:]]/ { in_database=0 }
  in_volumes && in_database && /^    name: / { sub(/^    name: /, ""); print }
' | tr -d "\"'")
unset compose_configuration
case "$database_volume" in
  ''|*[!a-zA-Z0-9_.-]*)
    printf '%s\n' '无法确认 Compose 数据库卷名称，部署已停止。' >&2
    exit 1
    ;;
esac
case "$application_image" in
  ''|*[!a-zA-Z0-9_./:@-]*)
    printf '%s\n' '无法确认应用镜像名称，部署已停止。' >&2
    exit 1
    ;;
esac
database_container=$(docker compose -f docker-compose.liekan.yml ps --all --quiet db)
cache_container=$(docker compose -f docker-compose.liekan.yml ps --all --quiet analytics-cache)
for container_id in "$database_container" "$cache_container"; do
  case "$container_id" in
    *[!a-zA-Z0-9_.-]*)
      printf '%s\n' '发现多个或无法识别的依赖服务容器，部署已停止。' >&2
      exit 1
      ;;
  esac
done
existing_volumes=$(docker volume ls --format '{{.Name}}')
if [ -z "$database_container" ] && printf '%s\n' "$existing_volumes" | grep -Fx "$database_volume" >/dev/null; then
  printf '%s\n' '发现已有数据库卷，但原数据库容器缺失。请按原 PostgreSQL 大版本恢复容器并检查数据，再执行部署。' >&2
  exit 1
fi

start_existing_dependency() {
  dependency_name=$1
  dependency_id=$2
  dependency_state=$(docker inspect --format '{{.State.Status}}' "$dependency_id")
  case "$dependency_state" in
    running) ;;
    created|exited) docker start "$dependency_id" >/dev/null ;;
    *)
      printf '%s\n' "$dependency_name 容器状态异常，部署已停止，请先检查原容器。" >&2
      return 1
      ;;
  esac
  health_attempt=0
  while [ "$health_attempt" -lt 150 ]; do
    dependency_health=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$dependency_id")
    case "$dependency_health" in
      'running healthy') return 0 ;;
      'running starting') ;;
      *)
        printf '%s\n' "$dependency_name 容器未通过健康检查，部署已停止，请先恢复原服务。" >&2
        return 1
        ;;
    esac
    health_attempt=$((health_attempt + 1))
    sleep 2
  done
  printf '%s\n' "$dependency_name 容器健康检查超时，部署已停止。" >&2
  return 1
}

# Build a private tag so another build cannot replace our candidate between build and inspect.
# Git is optional for source archives. Unknown metadata never substitutes for an image ID.
source_revision=unknown
source_state=unknown
source_difference=unknown
if command -v git >/dev/null 2>&1 && [ "$(git rev-parse --show-toplevel 2>/dev/null || :)" = "$PWD" ]; then
  source_revision=$(git rev-parse HEAD)
  source_state=clean
  source_difference=none
  source_status=$(git status --porcelain --untracked-files=all -- . ':!.local' ':!.env*' ':!**/.env*' ':!node_modules' ':!**/node_modules' ':!.next' ':!outputs' ':!tmp' ':!coverage' ':!test-results' ':!playwright-report')
  if [ -n "$source_status" ]; then
    source_state=dirty
    source_difference=$({
      printf '%s\n' "$source_status"
      git diff --binary HEAD -- . ':!.local' ':!.env*' ':!**/.env*' ':!node_modules' ':!**/node_modules' ':!.next' ':!outputs' ':!tmp' ':!coverage' ':!test-results' ':!playwright-report'
      git ls-files --others --exclude-standard -z -- . ':!.local' ':!.env*' ':!**/.env*' ':!node_modules' ':!**/node_modules' ':!.next' ':!outputs' ':!tmp' ':!coverage' ':!test-results' ':!playwright-report' | xargs -0 git hash-object --
    } | git hash-object --stdin)
  fi
  unset source_status
fi
candidate_override=$(mktemp .local/liekan-candidate.XXXXXX)
candidate_tag="liekan:deploy-$(basename "$candidate_override" | tr '[:upper:]' '[:lower:]')"
cat > "$candidate_override" <<EOF
services:
  app:
    image: $candidate_tag
    build:
      labels:
        org.opencontainers.image.revision: "$source_revision"
        io.liekan.source.state: "$source_state"
        io.liekan.source.difference: "$source_difference"
EOF
candidate_compose() { docker compose -f docker-compose.liekan.yml -f "$candidate_override" "$@"; }
candidate_compose build --build-arg "LIEKAN_REVISION=$source_revision" app
candidate_image=$(docker image inspect --format '{{.Id}}' "$candidate_tag")
case "$candidate_image" in
  sha256:*) image_digest=${candidate_image#sha256:} ;;
  *) image_digest='' ;;
esac
case "$image_digest" in
  ''|*[!a-f0-9]*) image_digest='' ;;
esac
if [ "${#image_digest}" -ne 64 ]; then
  printf '%s\n' '无法确认本次构建的不可变镜像 ID，部署已停止。' >&2
  exit 1
fi
revision_format='{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "io.liekan.upstream.revision"}}|{{index .Config.Labels "io.liekan.migration"}}'
candidate_revisions=$(docker image inspect --format "$revision_format" "$candidate_image")
if [ "$source_revision" != unknown ] && [ "${candidate_revisions%%|*}" != "$source_revision" ]; then
  printf '%s\n' 'app 构建来源版本不匹配，部署已停止。' >&2
  exit 1
fi
cat > "$candidate_override" <<EOF
services:
  app:
    image: $candidate_image
    pull_policy: never
  log-worker:
    image: $candidate_image
    pull_policy: never
  analytics-worker:
    image: $candidate_image
    pull_policy: never
EOF

verify_candidate_service() {
  service_name=$1
  require_health=$2
  service_id=$(candidate_compose ps --all --quiet "$service_name")
  case "$service_id" in
    ''|*[!a-zA-Z0-9_.-]*)
      printf '%s\n' "$service_name 容器无法唯一确认，部署已停止。" >&2
      return 1 ;;
  esac
  actual_image=$(docker inspect --format '{{.Image}}' "$service_id")
  actual_revisions=$(docker inspect --format "$revision_format" "$service_id")
  if [ "$actual_image" != "$candidate_image" ] || [ "$actual_revisions" != "$candidate_revisions" ]; then
    printf '%s\n' "$service_name 镜像或版本与本次候选不匹配，部署已停止；后台处理服务保持停止。" >&2
    return 1
  fi
  if [ "$require_health" = healthy ]; then
    service_health=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$service_id")
    if [ "$service_health" != 'running healthy' ]; then
      printf '%s\n' "$service_name 未通过候选健康检查，部署已停止。" >&2
      return 1
    fi
  else
    service_state=$(docker inspect --format '{{.State.Status}}' "$service_id")
    case "$service_state" in
      created|exited) ;;
      *)
        printf '%s\n' "$service_name 未处于待启动状态，部署已停止。" >&2
        return 1 ;;
    esac
  fi
}

workers_stopped=''
stop_candidate_workers() {
  if [ -n "$workers_stopped" ]; then
    candidate_compose stop log-worker analytics-worker >/dev/null 2>&1 || :
  fi
}
# Existing dependencies retain their container, image, configuration and data mounts.
if [ -n "$database_container" ]; then
  start_existing_dependency '数据库' "$database_container"
else
  docker compose -f docker-compose.liekan.yml up -d --no-build --no-deps --wait --wait-timeout 300 db
fi
if [ -n "$cache_container" ]; then
  start_existing_dependency '缓存' "$cache_container"
else
  docker compose -f docker-compose.liekan.yml up -d --no-build --no-deps --wait --wait-timeout 300 analytics-cache
fi
docker compose -f docker-compose.liekan.yml stop log-worker analytics-worker
workers_stopped=1
trap 'stop_candidate_workers; exit 130' INT
trap 'stop_candidate_workers; exit 143' TERM HUP
if ! candidate_compose up -d --no-build --no-deps --wait --wait-timeout 1800 app; then
  printf '%s\n' 'app 启动或迁移健康检查失败，后台处理服务保持停止。' >&2
  exit 1
fi
verify_candidate_service app healthy
# Inspect stopped workers before they can claim work, then start these exact containers.
candidate_compose up -d --no-build --no-deps --no-start log-worker analytics-worker
for service_name in log-worker analytics-worker; do
  if ! verify_candidate_service "$service_name" stopped; then
    stop_candidate_workers
    exit 1
  fi
done
if ! candidate_compose up -d --no-build --no-deps --no-recreate --wait --wait-timeout 300 log-worker analytics-worker; then
  for service_name in log-worker analytics-worker; do verify_candidate_service "$service_name" healthy || :; done
  stop_candidate_workers
  printf '%s\n' 'log-worker 或 analytics-worker 启动健康检查失败，后台处理服务已停止。' >&2
  exit 1
fi
for service_name in app log-worker analytics-worker; do
  if ! verify_candidate_service "$service_name" healthy; then
    stop_candidate_workers
    exit 1
  fi
done
docker tag "$candidate_image" "$application_image"
printf '%s\n' "候选镜像：${candidate_image}；来源：${source_revision}；工作区：${source_state}；差异摘要：${source_difference}。"
printf '%s\n' 'GEOInflow部署完成：http://127.0.0.1:3002' '首次安装登录：admin / liekan。已有账号使用原密码。' '公网访问通过反向代理配置域名与 HTTPS。' '访客统计需要可信 IP 入口：按 docs/local-deployment.md 配置 CLIENT_IP_HEADER 和代理覆盖规则，再核对新事件身份覆盖。'
