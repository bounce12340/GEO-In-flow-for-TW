# 從台灣部署

完整運維說明見原始文件 [docs/deployment.md](../deployment.md) 與 [docs/local-deployment.md](../local-deployment.md)（簡體中文）。本頁說明台灣部署需要注意的差異。

## 下載來源（預設全部為全球官方來源）

2026-10-28 檢查了 `Dockerfile.liekan`、`docker-compose.liekan.yml`、`scripts/liekan-deploy.sh`、`scripts/liekan-start.sh`、`env.example`、專案文件與 `.npmrc`（不存在），沒有發現中國大陸鏡像（npmmirror、阿里雲、清華 TUNA、中科大 USTC、DaoCloud、網易 163、僅限 Gitee 的下載或中國 CDN）。建置與執行使用：

| 元件 | 來源 |
| --- | --- |
| Node.js / Redis / PostgreSQL 映像 | Docker Hub 官方映像（`node:22.23.4-alpine`、`redis:7.4-alpine`、`postgres:16-alpine`） |
| Alpine 套件 | Alpine 官方 CDN（映像預設） |
| npm 套件 | npm 官方 registry（https://registry.npmjs.org/），以 `pnpm-lock.yaml` 凍結 |
| 城市地理資料 | DB-IP City Lite（https://download.db-ip.com/），或已授權的 MaxMind GeoLite2 |

原始碼取得方式：本分支的遠端為 GitHub。`AGENTS.md` 中的 Gitee 為原始專案的鏡像推送設定，部署不需要。

## 選用：區域 npm 鏡像

若建置網路無法順利連到 npm 官方 registry，可在 `.env` 加入：

```sh
LIEKAN_NPM_REGISTRY=https://你的鏡像位址/
```

此變數只在建置的相依套件階段使用（安裝 pnpm 與 `pnpm install --frozen-lockfile`），不會寫入最終應用程式環境；lockfile 的完整性檢查仍然有效。未設定時一律使用官方 registry。

也可以使用既有的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 或 `LIEKAN_DOCKER_HTTP_PROXY`，說明見 [docs/local-deployment.md](../local-deployment.md)。

## 語言與時區

- 新安裝的 `.env` 會寫入 `DEFAULT_LOCALE=zh-TW`。`docker-compose.liekan.yml` 改為讀取 `.env` 的 `DEFAULT_LOCALE`（未設定時為 `zh-TW`）。
- **既有安裝**：部署腳本保留原 `.env`。原始版本產生的 `.env` 內含 `DEFAULT_LOCALE=zh-CN`，升級後仍以簡體中文為預設；要改為繁體中文請手動修改後重新部署。已選擇過語言的瀏覽器不受影響。
- 預設分析時區為 `Asia/Taipei`。已儲存時區的帳戶保持原設定。

## 資料落地

自架於台灣機房或台灣區域雲端時，存取日誌與瀏覽資料不需跨境傳輸。若開啟選用的 AI 分析，所選資料會送往模型供應商，請在隱私權政策中說明（見 [taiwan-context.md](taiwan-context.md)）。

## 重新產生繁體中文語系檔

繁體中文語系檔由簡體來源以 OpenCC（cn → twp）加上台灣用語對照表產生：

```sh
pnpm liekan:zh-tw          # 重新產生
pnpm liekan:zh-tw --check  # 確認已提交的檔案是最新的
node scripts/liekan-i18n-check.mjs
```

需要人工修訂的句子請寫入 `config/liekan/zh-TW-overrides.json`（以訊息 ID 為鍵），重新產生時會優先採用。
