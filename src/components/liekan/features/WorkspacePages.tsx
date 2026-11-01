'use client';
import { liekanProduct } from '@/lib/liekan/contracts/product';
import { TableCell } from './ui';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { pageLink } from '../PageLink';
import { TeamUserCreateDialog } from './TeamUserCreateDialog';
import { canAssignTeamUserRole, type TeamUserCreated } from '@/lib/liekan/contracts/team-users';
import {
  ManualAuthorizationBoundary,
  ManualReadDependencyBoundary,
  useManualRefresh,
} from '@/lib/liekan/contracts/manual-refresh';
import { ManualRefreshControl } from '../ManualRefreshControl';
import { useListState } from './listState';

import {
  freshnessStaleTime,
  shareWithFreshness,
  monotonicNow,
} from '@/lib/liekan/upstream/client-freshness';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDateRangeClock } from '@/lib/liekan/upstream/date-range-clock';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { FeatureEntity } from '@/lib/liekan/contracts/features';
import { numberLabel, rowsOf } from '@/lib/liekan/contracts/features';
import { websiteHandle } from '@/lib/liekan/website-handle';
import {
  allowedShareSections,
  bindBoardComponent,
  boardColumns,
  boardEntity,
  boardParameters,
  canCreateResource,
  canManageMember,
  canManageResource,
  canManageTeam,
  eventChartData,
  hasShareSection,
  moveBoardColumn,
  nativeMetric,
  removeBoardColumn,
  setBoardColumnWidth,
  shareParameters,
  shareSections,
  shareTypes,
  teamRoleOptions,
  updateBoardColumn,
  userRoleOptions,
  type WorkspaceComponent,
  type WorkspaceParameters,
  workspaceRoleLabels,
  workspaceTeamRole,
} from '@/lib/liekan/contracts/workspace';
import {
  featureRequest,
  mapFeatureRows,
  getAllFeatureRows,
  getFeaturePreferences,
} from '@/lib/liekan/upstream/features-client';
import { Chart } from './Chart';
import { SharedWebsiteOverview } from './SharedWebsiteOverview';
import {
  resolveSharedDateRange,
  sharedDateRange,
  sharedTimezone,
  type SharedDateRange,
} from '@/lib/liekan/contracts/shared-report';
import sharedStyles from '@/styles/liekan/SharedReport.module.css';
import {
  FeatureProvider,
  useAction,
  useData,
  useFeature,
  useFreshQuery,
  useResourceContext,
} from './context';
import {
  Badge,
  Body,
  Button,
  Check,
  Definition,
  LiekanDialog,
  Field,
  Form,
  Icon,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  QueryState,
  Select,
  Switch,
  Table,
  Tabs,
  Textarea,
} from './ui';

export const workspacePages = new Set([
  'teams',
  'team-detail',
  'team-join',
  'admin-users',
  'admin-user',
  'admin-websites',
  'admin-teams',
  'admin-security',
  'boards',
  'board-editor',
  'board-design',
  'board-view',
  'sharing',
  'share-preview',
]);
const types: [string, string][] = [
  ['website', '网站'],
  ['link', '链接'],
  ['pixel', '像素'],
  ['mixed', '混合'],
];
const labels: Record<string, string> = {
  website: '网站',
  link: '链接',
  pixel: '像素',
  board: '看板',
  mixed: '混合',
  open: '混合',
};
const date = (value: any) =>
  value
    ? new Date(value).toLocaleString('zh-CN', { timeZone: getFeaturePreferences().timezone })
    : '未提供';
const role = (value: string) => workspaceRoleLabels[value] || value || '未提供';
const pagesOf = (data: any, size = 20) =>
  Math.max(1, Math.ceil((data?.count || 0) / (data?.pageSize || size)));
const readable = (value: any, display = (source: string) => source) =>
  value == null ? display('未提供') : numberLabel(nativeMetric(value));
const uid = () => crypto.randomUUID();

function Forbidden() {
  const i18n = useLiekanI18n();
  return (
    <Notice tone="amber">
      {i18n.fragment('当前账户没有系统管理权限。', false, true)}
      <div className="form-actions">
        <LinkButton page="websites">{i18n.text('返回工作台')}</LinkButton>
      </div>
    </Notice>
  );
}
function ReadOnly() {
  const i18n = useLiekanI18n();
  return <Notice tone="amber">{i18n.text('当前角色可以查看资源。修改配置需要管理权限。')}</Notice>;
}
function Search({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const i18n = useLiekanI18n();
  return (
    <label className="search">
      <input
        type="search"
        aria-label={i18n.text('搜索资源')}
        placeholder={i18n.text('搜索名称')}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  );
}
function Confirm({
  title,
  word = 'DELETE',
  children,
  onConfirm,
  onClose,
  message,
  navigateTo,
}: any) {
  const i18n = useLiekanI18n();
  const action = useAction();
  return (
    <LiekanDialog
      protectUnsaved={false}
      title={i18n.system(title)}
      onClose={() => !action.busy && onClose()}
    >
      <Form
        busy={action.busy}
        danger
        trackUnsaved={false}
        submitLabel={i18n.system(title)}
        onSubmit={async (values: any) => {
          if (values.confirmation !== word) throw new Error(`请输入 ${word} 确认`);
          await action.run(onConfirm, message, { navigateTo });
          onClose();
        }}
      >
        <Notice tone="red">{children}</Notice>
        <Field
          label={i18n.text('输入 {v0} 确认', [word])}
          name="confirmation"
          required
          autoComplete="off"
        />
      </Form>
    </LiekanDialog>
  );
}

export function useWorkspaceEntities() {
  const c = useFeature();
  const allSources = ['board-editor', 'board-design', 'board-view'].includes(c.route.page);
  const websiteOnly = c.route.page === 'sharing' && c.route.context === 'website';
  const query = useData(
    ['workspace-entities', c.route.teamId, allSources, websiteOnly, c.teams.map(team => team.id)],
    async signal => {
      if (websiteOnly) return { link: [], pixel: [], board: [] };
      const prefix = c.route.teamId && !allSources ? `/teams/${c.route.teamId}` : '';
      const [links, pixels, boards] = await Promise.all(
        ['links', 'pixels', 'boards'].map(async kind => {
          const personal = await getAllFeatureRows<FeatureEntity>(`${prefix}/${kind}`, {}, signal);
          if (!allSources) return personal;
          const teams = await mapFeatureRows(c.teams, team =>
            getAllFeatureRows<FeatureEntity>(`/teams/${team.id}/${kind}`, {}, signal),
          );
          return [
            ...new Map([...personal, ...teams.flat()].map(entity => [entity.id, entity])).values(),
          ];
        }),
      );
      return { link: links, pixel: pixels, board: boards };
    },
    !allSources || c.teamsReady !== false,
  );
  return {
    ...query,
    data: query.data
      ? { ...query.data, website: websiteOnly ? (c.site ? [c.site] : []) : c.sites }
      : undefined,
  };
}

function TeamCreate({ onClose }: { onClose: () => void }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction();
  const users = useData(
    'team-owner-options',
    signal => getAllFeatureRows<any>('/admin/users', {}, signal),
    !!c.user.isAdmin,
  );
  return (
    <LiekanDialog title={i18n.text('创建团队')} onClose={() => !action.busy && onClose()}>
      <Form
        columns
        busy={action.busy}
        submitLabel={i18n.text('创建团队')}
        onSubmit={async (values: any) => {
          await action.run(
            () =>
              c.api.post('/teams', {
                name: String(values.name).trim(),
                ...(c.user.isAdmin && values.ownerId ? { ownerId: values.ownerId } : {}),
              }),
            '团队已创建',
          );
          try {
            await c.refresh();
          } catch {
            c.notify('团队已创建，页面状态刷新失败，请重新读取。');
          }
          onClose();
        }}
      >
        <Field label={i18n.text('团队名称')} name="name" maxLength={50} required />
        {c.user.isAdmin ? (
          <QueryState query={users}>
            <Select
              label={i18n.text('团队所有者')}
              name="ownerId"
              defaultValue={c.user.id}
              options={(users.data || []).map((user: any) => [user.id, user.username])}
            />
          </QueryState>
        ) : (
          <Definition items={[[i18n.text('团队所有者'), c.user.username]]} />
        )}
      </Form>
    </LiekanDialog>
  );
}
function TwoFactorBadge({ userId }: { userId: string }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    q = useData(
      ['user-2fa', userId],
      signal => c.api.get(`/admin/users/${userId}/2fa`, undefined, signal),
      !!c.user.isAdmin,
    );
  return q.error ? (
    <span className="muted">{i18n.text('未提供')}</span>
  ) : q.isPending ? (
    <span className="muted">{i18n.text('读取中')}</span>
  ) : (
    <Badge tone={q.data?.isEnabled ? 'green' : 'amber'}>
      {q.data?.isEnabled ? i18n.text('已启用') : i18n.text('未启用')}
    </Badge>
  );
}
function Teams({ admin = false }: { admin?: boolean }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [create, setCreate] = useState(false);
  const q = useData(
    [admin ? 'admin-teams' : 'teams', page, search],
    async signal => {
      if (admin) return c.api.get('/admin/teams', { page, pageSize: 20, search }, signal);
      const all = await getAllFeatureRows<FeatureEntity>('/teams', {}, signal);
      const filtered = all.filter(
        team => !search || team.name.toLowerCase().includes(search.toLowerCase()),
      );
      return {
        data: filtered.slice((page - 1) * 20, page * 20),
        count: filtered.length,
        pageSize: 20,
      };
    },
    !admin || !!c.user.isAdmin,
  );
  const rows = rowsOf<FeatureEntity>(q.data).filter(
    team => !search || team.name.toLowerCase().includes(search.toLowerCase()),
  );
  if (admin && !c.user.isAdmin) return <Forbidden />;
  const myTeams = c.teams,
    totalMembers = myTeams.every(team => team._count?.members != null)
      ? myTeams.reduce((n, team) => n + team._count.members, 0)
      : null;
  return (
    <>
      {!admin && (
        <Metrics
          loading={q.isPending}
          items={[
            [i18n.text('参与团队'), myTeams.length, i18n.text('当前账户')],
            [
              i18n.text('团队网站'),
              myTeams.every(team => team._count?.websites != null)
                ? myTeams.reduce((total, team) => total + team._count.websites, 0)
                : i18n.text('未提供'),
              i18n.text('按团队汇总'),
            ],
            [i18n.text('团队成员'), readable(totalMembers, i18n.system), i18n.text('按团队汇总')],
            [i18n.text('安全策略'), i18n.text('按团队设置'), i18n.text('沿用双重验证要求')],
          ]}
        />
      )}
      <Panel
        title={i18n.system(admin ? i18n.text('全局团队') : i18n.text('我的团队'))}
        subtitle={i18n.system(
          admin
            ? i18n.text('系统管理员管理团队与所有者。')
            : i18n.text('所有者管理团队，管理员管理资源与成员。'),
        )}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            {!admin && <LinkButton page="team-join">{i18n.text('通过访问码加入')}</LinkButton>}
            <Button primary disabled={!canCreateResource(c.user)} onClick={() => setCreate(true)}>
              <Icon name="plus" />
              {i18n.fragment('创建团队', true, false)}
            </Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rows.map(team => team.id)}
            columns={
              admin
                ? ['团队', '所有者', '成员', '网站', '操作']
                : ['团队', '我的角色', '成员', '网站', '操作']
            }
            numeric={[2, 3]}
            rows={rows.map(team => [
              team.name,
              <TableCell
                sortValue={
                  admin
                    ? team.members?.find((m: any) => m.role === 'team-owner')?.user?.username ||
                      i18n.source('未提供')
                    : role(workspaceTeamRole(c.user, team))
                }
                searchValue={
                  admin
                    ? team.members?.find((m: any) => m.role === 'team-owner')?.user?.username ||
                      i18n.english.text('未提供')
                    : i18n.english.system(
                        i18n.english.system(role(workspaceTeamRole(c.user, team))),
                      )
                }
              >
                {admin ? (
                  team.members?.find((m: any) => m.role === 'team-owner')?.user?.username ||
                  i18n.text('未提供')
                ) : (
                  <Badge
                    key="cell-badge-1"
                    tone={workspaceTeamRole(c.user, team) === 'team-owner' ? 'blue' : 'gray'}
                  >
                    {i18n.system(role(workspaceTeamRole(c.user, team)))}
                  </Badge>
                )}
              </TableCell>,
              <TableCell
                sortValue={team._count?.members ?? i18n.source('未提供')}
                searchValue={team._count?.members ?? i18n.english.text('未提供')}
              >
                {team._count?.members ?? i18n.text('未提供')}
              </TableCell>,
              <TableCell
                sortValue={team._count?.websites ?? i18n.source('未提供')}
                searchValue={team._count?.websites ?? i18n.english.text('未提供')}
              >
                {team._count?.websites ?? i18n.text('未提供')}
              </TableCell>,
              <TableCell
                sortValue={canManageTeam(c.user, team) ? i18n.source('管理') : i18n.source('查看')}
                searchValue={
                  canManageTeam(c.user, team)
                    ? i18n.english.text('管理')
                    : i18n.english.text('查看')
                }
              >
                <LinkButton
                  key="cell-linkbutton-2"
                  page="team-detail"
                  params={{ id: team.id, teamId: team.id }}
                >
                  {canManageTeam(c.user, team) ? i18n.text('管理') : i18n.text('查看')}
                </LinkButton>
              </TableCell>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      {create && <TeamCreate onClose={() => setCreate(false)} />}
    </>
  );
}
function MemberDrawer({
  team,
  member,
  onClose,
}: {
  team: FeatureEntity;
  member?: any;
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    [remove, setRemove] = useState(false);
  const pending = useRef(false);
  const users = useData(
    ['member-user-options', team.id],
    signal => getAllFeatureRows<any>('/admin/users', {}, signal),
    !member && !!c.user.isAdmin,
  );
  const selfRole = workspaceTeamRole(c.user, team),
    choices = teamRoleOptions.filter(([value]) =>
      canAssignTeamUserRole(!!c.user.isAdmin, selfRole, value),
    );
  return (
    <LiekanDialog
      subtitle={team.name + (member ? ' · ' + (member.user?.username || member.userId) : '')}
      title={i18n.system(
        remove
          ? i18n.text('移除成员')
          : member
            ? i18n.text('编辑成员角色')
            : i18n.text('添加团队成员'),
      )}
      protectUnsaved={!remove && !action.busy && !pending.current}
      onClose={() => !action.busy && !pending.current && onClose()}
    >
      <Form
        columns
        busy={action.busy}
        danger={remove}
        submitLabel={i18n.system(
          remove
            ? i18n.text('移除成员')
            : member
              ? i18n.text('保存成员角色')
              : i18n.text('添加团队成员'),
        )}
        onSubmit={async (values: any) => {
          pending.current = true;
          try {
            if (remove) {
              if (values.confirmation !== 'REMOVE') throw new Error('请输入 REMOVE 确认');
              await action.run(
                () => c.api.del(`/teams/${team.id}/users/${member.userId}`),
                '成员已移除',
              );
            } else {
              await action.run(() =>
                c.api.post(`/teams/${team.id}/users${member ? `/${member.userId}` : ''}`, {
                  role: values.role,
                  ...(!member && { userId: values.userId }),
                }),
              );
            }
            try {
              await c.refresh();
            } catch {
              c.notify(
                `${remove ? '成员已移除' : member ? '成员角色已保存' : '成员已添加'}，页面状态刷新失败，请重新读取。`,
              );
            }
            onClose();
          } finally {
            pending.current = false;
          }
        }}
      >
        {remove ? (
          <>
            <Notice tone="red">
              {i18n.fragment('成员“', false, true)}
              {member.user?.username || member.userId}
              {i18n.fragment('”将失去团队“', true, true)}
              {team.name}
              {i18n.fragment('”的资源访问权限，个人账户继续保留。', true, false)}
            </Notice>
            <Field
              label={i18n.text('输入 REMOVE 确认')}
              name="confirmation"
              required
              autoComplete="off"
            />
          </>
        ) : (
          <>
            {member ? (
              <Field
                label={i18n.text('用户名')}
                defaultValue={member.user?.username || member.userId}
                readOnly
              />
            ) : c.user.isAdmin ? (
              <QueryState query={users}>
                <Select
                  label={i18n.text('用户名')}
                  name="userId"
                  required
                  options={(users.data || [])
                    .filter((user: any) => !team.members?.some((m: any) => m.userId === user.id))
                    .map((user: any) => [user.id, user.username])}
                />
              </QueryState>
            ) : (
              <Field
                label={i18n.text('已有用户 ID')}
                name="userId"
                required
                pattern="[a-fA-F0-9-]{36}"
                help={i18n.text(
                  '请向该用户取得账户 ID。现有接口仅向系统管理员开放全局用户名列表。',
                )}
              />
            )}
            <Select
              label={i18n.text('团队角色')}
              name="role"
              defaultValue={member?.role || 'team-member'}
              options={choices}
              localizeLabels
            />
            <Notice>{i18n.text('添加使用本系统已有账户。')}</Notice>
            {member && (
              <Button danger disabled={action.busy} onClick={() => setRemove(true)}>
                {i18n.text('移除成员')}
              </Button>
            )}
          </>
        )}
      </Form>
    </LiekanDialog>
  );
}
function TeamDetail() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    id = c.route.teamId || c.route.id,
    [tab, setTab] = useListState('tab', 'members'),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [drawer, setDrawer] = useState<any>(null),
    [created, setCreated] = useState<{ owner: string; team: string; result: TeamUserCreated }>(
      null,
    ),
    [refreshError, setRefreshError] = useState(false),
    action = useAction();
  const client = useQueryClient();
  const scope = `${c.user.id}:${id}`;
  const lifecycle = useRef({ scope, alive: true });
  lifecycle.current.scope = scope;
  useEffect(() => {
    lifecycle.current.alive = true;
    return () => {
      lifecycle.current.alive = false;
    };
  }, []);
  const activeCreated =
    created?.owner === c.user.id && created?.team === id ? created.result : null;
  async function refreshCreated() {
    const started = scope;
    setRefreshError(false);
    await client.invalidateQueries({
      predicate: query =>
        query.queryKey[0] === 'liekan-feature' && query.queryKey.includes(c.user.id),
      refetchType: 'none',
    });
    if (!lifecycle.current.alive || lifecycle.current.scope !== started) return;
    try {
      await c.refresh();
    } catch {
      if (lifecycle.current.alive && lifecycle.current.scope === started) setRefreshError(true);
    }
  }
  const q = useData(
    ['team-record', id],
    signal => c.api.get<FeatureEntity>(`/teams/${id}`, undefined, signal),
    !!id,
  );
  const members = useData(
    ['team-members', id, page, search],
    signal => c.api.get(`/teams/${id}/users`, { page, pageSize: 20, search }, signal),
    !!id && tab === 'members',
  );
  const resources = useData(
    ['team-resources', id, page, search],
    signal => c.api.get(`/teams/${id}/websites`, { page, pageSize: 20, search }, signal),
    !!id && tab === 'resources',
  );
  const security = useData(
    'workspace-security',
    signal => c.api.get('/2fa/status', undefined, signal),
    tab === 'security',
  );
  const team = q.data,
    management = canManageTeam(c.user, team),
    owner = workspaceTeamRole(c.user, team) === 'team-owner',
    canDelete = !!c.user.isAdmin || owner;
  useResourceContext(team);
  if (!id)
    return (
      <Notice>
        {i18n.fragment('请选择一个团队。', false, true)}
        <LinkButton page="teams">{i18n.text('我的团队')}</LinkButton>
      </Notice>
    );
  return (
    <QueryState query={q}>
      {team && (
        <>
          <div className="row between">
            <div>
              <h2>{team.name}</h2>
              <p className="muted">{i18n.system(role(workspaceTeamRole(c.user, team)))}</p>
            </div>
            <LinkButton page="teams">{i18n.text('返回团队列表')}</LinkButton>
          </div>
          <Tabs
            items={[
              ['members', i18n.text('成员')],
              ['resources', i18n.text('资源')],
              ['security', i18n.text('安全')],
              ['settings', i18n.text('设置')],
            ]}
            active={tab}
            onChange={value => {
              setTab(value);
              setPage(1);
              setSearch('');
            }}
          />
          {tab === 'members' ? (
            <>
              {activeCreated && (
                <Notice tone="blue">
                  {i18n.fragment('用户“', false, true)}
                  {activeCreated.user.username}
                  {i18n.fragment('”已创建并加入团队，角色为', true, true)}
                  {i18n.system(role(activeCreated.member.role))}。
                  {refreshError && <p>{i18n.text('创建已完成，成员列表读取失败，请重新读取。')}</p>}
                  <div className="form-actions">
                    <Button onClick={refreshCreated}>{i18n.text('重新读取')}</Button>
                    <LinkButton page="admin-user" params={{ id: activeCreated.user.id }}>
                      {i18n.text('查看用户')}
                    </LinkButton>
                  </div>
                </Notice>
              )}
              <Panel
                title={i18n.text('团队成员')}
                subtitle={i18n.text('所有者、管理员、成员与只读角色分别保留。')}
                actions={
                  <>
                    <Search
                      value={search}
                      onChange={value => {
                        setSearch(value);
                        setPage(1);
                      }}
                    />
                    <Button disabled={!management} onClick={() => setDrawer({ type: 'member' })}>
                      {i18n.text('添加已有用户')}
                    </Button>
                    {c.user.isAdmin && (
                      <Button
                        primary
                        onClick={() => setDrawer({ type: 'new-user', owner: c.user.id, team: id })}
                      >
                        <Icon name="plus" />
                        {i18n.fragment('新建用户', true, false)}
                      </Button>
                    )}
                  </>
                }
              >
                <QueryState query={members}>
                  <Table
                    mobile
                    highlightRowKey={activeCreated?.member.id}
                    rowKeys={rowsOf<any>(members.data).map(member => member.id || member.userId)}
                    columns={['成员', '用户名', '角色', '双重验证', '加入时间', '操作']}
                    rows={rowsOf<any>(members.data).map(member => [
                      member.user?.username || member.userId,
                      <TableCell
                        sortValue={member.user?.username || i18n.source('未提供')}
                        searchValue={member.user?.username || i18n.english.text('未提供')}
                      >
                        {member.user?.username || i18n.text('未提供')}
                      </TableCell>,
                      <TableCell
                        sortValue={role(member.role)}
                        searchValue={i18n.english.system(i18n.english.system(role(member.role)))}
                      >
                        <Badge
                          key="cell-badge-3"
                          tone={member.role === 'team-owner' ? 'blue' : 'gray'}
                        >
                          {i18n.system(role(member.role))}
                        </Badge>
                      </TableCell>,
                      <TableCell
                        sortValue={c.user.isAdmin ? '' : i18n.source('未提供')}
                        searchValue={c.user.isAdmin ? '' : i18n.english.text('未提供')}
                      >
                        {c.user.isAdmin ? (
                          <TwoFactorBadge key="cell-twofactorbadge-4" userId={member.userId} />
                        ) : (
                          i18n.text('未提供')
                        )}
                      </TableCell>,
                      date(member.createdAt),
                      <TableCell
                        sortValue={
                          member.role === 'team-owner'
                            ? i18n.source('所有者')
                            : i18n.source('编辑角色')
                        }
                        searchValue={
                          member.role === 'team-owner'
                            ? i18n.english.text('所有者')
                            : i18n.english.text('编辑角色')
                        }
                      >
                        {member.role === 'team-owner' ? (
                          <span key="cell-span-5" className="muted">
                            {i18n.text('所有者')}
                          </span>
                        ) : (
                          <Button
                            key="cell-button-6"
                            disabled={!canManageMember(c.user, team, member)}
                            onClick={() => setDrawer({ type: 'member', member })}
                          >
                            {i18n.text('编辑角色')}
                          </Button>
                        )}
                      </TableCell>,
                    ])}
                    page={page}
                    pages={pagesOf(members.data)}
                    onPage={setPage}
                  />
                </QueryState>
              </Panel>
            </>
          ) : tab === 'resources' ? (
            <Panel
              title={i18n.text('团队资源')}
              subtitle={i18n.text(
                '查看此团队所属的网站、看板、链接和像素。网站转移保留历史访问数据。',
              )}
              actions={
                <>
                  <LinkButton page="boards" params={{ teamId: id }}>
                    {i18n.text('团队看板')}
                  </LinkButton>
                  <LinkButton page="links" params={{ teamId: id }}>
                    {i18n.text('团队链接')}
                  </LinkButton>
                  <LinkButton page="pixels" params={{ teamId: id }}>
                    {i18n.text('团队像素')}
                  </LinkButton>
                  <Search
                    value={search}
                    onChange={value => {
                      setSearch(value);
                      setPage(1);
                    }}
                  />
                  {canCreateResource(c.user, team) && (
                    <LinkButton page="onboarding" params={{ teamId: id }} primary>
                      {i18n.text('添加网站')}
                    </LinkButton>
                  )}
                </>
              }
            >
              <QueryState query={resources}>
                <Table
                  mobile
                  rowKeys={rowsOf<FeatureEntity>(resources.data).map(site => site.id)}
                  columns={['网站', '域名', '状态', '操作']}
                  rows={rowsOf<FeatureEntity>(resources.data).map(site => [
                    site.name,
                    site.domain,
                    <TableCell
                      sortValue={i18n.source('未提供接入状态')}
                      searchValue={i18n.english.system(i18n.english.text('未提供接入状态'))}
                    >
                      <Badge key="cell-badge-7">{i18n.text('未提供接入状态')}</Badge>
                    </TableCell>,
                    <TableCell
                      sortValue={i18n.source('设置')}
                      searchValue={i18n.english.text('设置')}
                    >
                      <LinkButton
                        key="cell-linkbutton-8"
                        page="website-settings"
                        params={{ websiteId: site.id, teamId: id }}
                      >
                        {i18n.text('设置')}
                      </LinkButton>
                    </TableCell>,
                  ])}
                  page={page}
                  pages={pagesOf(resources.data)}
                  onPage={setPage}
                />
              </QueryState>
            </Panel>
          ) : tab === 'security' ? (
            <Panel
              title={i18n.text('团队双重验证')}
              subtitle={i18n.text('团队要求覆盖个人自主设置。')}
            >
              <Body>
                <QueryState query={security}>
                  <Form
                    key={team.id}
                    resetKey={String(team.twoFactorRequired)}
                    busy={action.busy}
                    disabled={!c.user.isAdmin || !security.data?.isConfigured}
                    submitLabel={i18n.text('保存团队策略')}
                    onSubmit={(values: any) =>
                      action.run(() =>
                        c.api.post(`/admin/teams/${id}/2fa`, {
                          required: values.required === 'on',
                        }),
                      )
                    }
                  >
                    <Switch
                      label={i18n.text('要求团队成员启用双重验证')}
                      name="required"
                      defaultChecked={team.twoFactorRequired}
                      help={i18n.text('开启后未配置的成员需要完成绑定。')}
                    />
                    <Notice tone="amber">
                      {!c.user.isAdmin
                        ? i18n.text('团队安全策略由系统管理员设置。')
                        : !security.data?.isConfigured
                          ? i18n.text('服务缺少加密配置，暂时无法开启策略。')
                          : team.twoFactorRequired
                            ? i18n.text('团队已要求双重验证，成员无法自行关闭。')
                            : i18n.text('成员当前可自主启用双重验证。')}
                    </Notice>
                  </Form>
                </QueryState>
              </Body>
            </Panel>
          ) : (
            <Panel
              title={i18n.text('团队设置')}
              subtitle={i18n.text('访问码用于已登录用户加入团队。')}
            >
              <Body>
                {!management && <ReadOnly />}
                <Form
                  key={team.id}
                  resetKey={String(team.updatedAt)}
                  busy={action.busy}
                  disabled={!management}
                  submitLabel={i18n.text('保存团队设置')}
                  onSubmit={async (values: any) => {
                    await action.run(() => c.api.post(`/teams/${id}`, { name: values.name }));
                    await c.refresh();
                  }}
                >
                  <Field
                    label={i18n.text('团队名称')}
                    name="name"
                    defaultValue={team.name}
                    maxLength={50}
                    required
                  />
                  <Field label={i18n.text('团队 ID')} value={team.id} readOnly />
                  <div className="row">
                    <Field
                      label={i18n.text('团队访问码')}
                      value={team.accessCode || '未提供'}
                      readOnly
                    />
                    <Button
                      disabled={!team.accessCode}
                      onClick={async () => {
                        await navigator.clipboard.writeText(team.accessCode);
                        c.notify('访问码已复制');
                      }}
                    >
                      {i18n.text('复制访问码')}
                    </Button>
                    <Button
                      disabled={action.busy || !management}
                      onClick={async () => {
                        await action.run(
                          () =>
                            c.api.post(`/teams/${id}`, {
                              accessCode: `team_${uid().replaceAll('-', '').slice(0, 16)}`,
                            }),
                          '访问码已更新',
                        );
                      }}
                    >
                      {i18n.text('重新生成')}
                    </Button>
                  </div>
                  <Notice tone="amber">{i18n.text('新访问码生成后旧码失效。')}</Notice>
                </Form>
                <hr className="divider" />
                <div className="row">
                  <Button
                    disabled={owner || action.busy}
                    title={i18n.system(owner ? i18n.text('所有者需要先转移所有权') : undefined)}
                    onClick={() => setDrawer({ type: 'leave' })}
                  >
                    {i18n.text('退出团队')}
                  </Button>
                  <Button
                    danger
                    disabled={!canDelete || action.busy}
                    onClick={() => setDrawer({ type: 'delete' })}
                  >
                    {i18n.text('删除团队')}
                  </Button>
                </div>
              </Body>
            </Panel>
          )}
          {drawer?.type === 'member' && (
            <MemberDrawer team={team} member={drawer.member} onClose={() => setDrawer(null)} />
          )}
          {drawer?.type === 'new-user' &&
            c.user.isAdmin &&
            drawer.owner === c.user.id &&
            drawer.team === id && (
              <TeamUserCreateDialog
                key={scope}
                team={team}
                onClose={() => setDrawer(null)}
                onCreated={result => {
                  setCreated({ owner: c.user.id, team: id, result });
                  setDrawer(null);
                  setSearch('');
                  setPage(result.page);
                  c.notify('用户已创建并加入团队');
                  void refreshCreated();
                }}
              />
            )}
          {['delete', 'leave'].includes(drawer?.type) && (
            <Confirm
              title={i18n.system(
                drawer.type === 'delete' ? i18n.text('删除团队') : i18n.text('退出团队'),
              )}
              word={drawer.type === 'delete' ? 'DELETE' : 'LEAVE'}
              onClose={() => setDrawer(null)}
              message={
                drawer.type === 'delete'
                  ? i18n.source('「{v0}」已删除', [team.name])
                  : i18n.source('已退出「{v0}」', [team.name])
              }
              navigateTo="teams"
              onConfirm={async () => {
                await c.api.del(
                  drawer.type === 'delete' ? `/teams/${id}` : `/teams/${id}/users/${c.user.id}`,
                );
              }}
            >
              {drawer.type === 'delete'
                ? i18n.text('此操作会删除团队及关联链接、像素和看板。请先核对资源归属。')
                : i18n.text('退出后将失去该团队的资源访问权限。')}
            </Confirm>
          )}
        </>
      )}
    </QueryState>
  );
}
function TeamJoin() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction();
  return (
    <div className="wide-narrow">
      <Panel title={i18n.text('通过访问码加入')} subtitle={i18n.text('向团队管理者获取访问码。')}>
        <Body>
          <Form
            busy={action.busy}
            submitLabel={i18n.text('验证并加入')}
            cancel={<LinkButton page="teams">{i18n.text('取消')}</LinkButton>}
            onSubmit={async (values: any) => {
              const result = await action.run(
                () => c.api.post('/teams/join', { accessCode: values.accessCode }),
                '已加入团队',
              );
              await c.refresh();
              c.navigate('team-detail', { id: result.teamId, teamId: result.teamId });
            }}
          >
            <Field label={i18n.text('访问码')} name="accessCode" required maxLength={50} />
            <Notice>{i18n.text('加入使用已有登录账户。成功后显示团队名称与分配角色。')}</Notice>
          </Form>
        </Body>
      </Panel>
      <Panel title={i18n.text('角色说明')} subtitle={i18n.text('权限来自团队管理者的角色设置。')}>
        <Body>
          <Definition
            items={[
              [i18n.text('管理员'), i18n.text('管理资源与成员')],
              [i18n.text('成员'), i18n.text('查看分析并管理授权资源')],
              [i18n.text('只读'), i18n.text('查看分析，无法修改配置')],
            ]}
          />
        </Body>
      </Panel>
    </div>
  );
}
function CreateUser({ onClose }: { onClose: () => void }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction();
  return (
    <LiekanDialog title={i18n.text('创建系统用户')} onClose={() => !action.busy && onClose()}>
      <Form
        columns
        busy={action.busy}
        submitLabel={i18n.text('创建用户')}
        onSubmit={async (values: any) => {
          await action.run(() => c.api.post('/users', values), '用户已创建');
          onClose();
        }}
      >
        <Field
          label={i18n.text('用户名')}
          name="username"
          required
          maxLength={255}
          autoComplete="off"
        />
        <Field
          label={i18n.text('初始密码')}
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={255}
          autoComplete="new-password"
          help={i18n.text('密码至少 8 位。')}
        />
        <Select
          label={i18n.text('系统角色')}
          name="role"
          options={userRoleOptions}
          localizeLabels
          defaultValue="user"
        />
      </Form>
    </LiekanDialog>
  );
}
function AdminUsers() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [create, setCreate] = useState(false);
  const q = useData(
    ['admin-users', page, search],
    signal => c.api.get('/admin/users', { page, pageSize: 20, search }, signal),
    !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <>
      <Panel
        title={i18n.text('系统用户')}
        subtitle={i18n.text('创建、查看角色和管理双重验证。')}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Button primary onClick={() => setCreate(true)}>
              <Icon name="plus" />
              {i18n.fragment('创建用户', true, false)}
            </Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(user => user.id)}
            columns={['用户名', '系统角色', '团队', '双重验证', '状态', '操作']}
            rows={rowsOf<any>(q.data).map(user => [
              user.username,
              <TableCell
                sortValue={role(user.role)}
                searchValue={i18n.english.system(i18n.english.system(role(user.role)))}
              >
                <Badge key="cell-badge-9" tone={user.role === 'admin' ? 'blue' : 'gray'}>
                  {i18n.system(role(user.role))}
                </Badge>
              </TableCell>,
              <TableCell
                sortValue={user._count?.teams ?? i18n.source('未提供')}
                searchValue={user._count?.teams ?? i18n.english.text('未提供')}
              >
                {user._count?.teams ?? i18n.text('未提供')}
              </TableCell>,
              <TwoFactorBadge key="cell-twofactorbadge-10" userId={user.id} />,
              <TableCell
                sortValue={user.deletedAt ? i18n.source('已删除') : i18n.source('正常')}
                searchValue={i18n.english.system(
                  user.deletedAt ? i18n.english.text('已删除') : i18n.english.text('正常'),
                )}
              >
                <Badge key="cell-badge-11" tone={user.deletedAt ? 'gray' : 'green'}>
                  {user.deletedAt ? i18n.text('已删除') : i18n.text('正常')}
                </Badge>
              </TableCell>,
              <TableCell sortValue={i18n.source('查看')} searchValue={i18n.english.text('查看')}>
                <LinkButton key="cell-linkbutton-12" page="admin-user" params={{ id: user.id }}>
                  {i18n.text('查看')}
                </LinkButton>
              </TableCell>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      <Notice>
        {i18n.text('系统角色与团队角色独立。编辑当前管理员时，禁止修改自己的系统角色。')}
      </Notice>
      {create && <CreateUser onClose={() => setCreate(false)} />}
    </>
  );
}
function AdminUser() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    id = c.route.id,
    action = useAction(),
    [confirm, setConfirm] = useState('');
  const q = useData(
    ['admin-user', id],
    signal => c.api.get(`/users/${id}`, undefined, signal),
    !!id && !!c.user.isAdmin,
  );
  const resources = useData(
    ['admin-user-resources', id],
    async signal => {
      const [websites, teams] = await Promise.all([
        getAllFeatureRows<any>(`/users/${id}/websites`, {}, signal),
        getAllFeatureRows<any>(`/users/${id}/teams`, {}, signal),
      ]);
      return { websites, teams };
    },
    !!id && !!c.user.isAdmin,
  );
  const security = useData(
    ['user-2fa', id],
    signal => c.api.get(`/admin/users/${id}/2fa`, undefined, signal),
    !!id && !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <QueryState query={q}>
      {q.data && (
        <>
          <div className="row between">
            <h2>
              {i18n.fragment('用户 · ', false, true)}
              {q.data.username}
            </h2>
            <LinkButton page="admin-users">{i18n.text('返回用户管理')}</LinkButton>
          </div>
          <div className="two">
            <Panel
              title={i18n.text('账户信息')}
              subtitle={i18n.text('管理员可修改用户资料，密码留空表示保留。')}
            >
              <Body>
                <Form
                  key={id}
                  resetKey={JSON.stringify([q.data.username, q.data.role])}
                  busy={action.busy}
                  submitLabel={i18n.text('保存用户')}
                  onSubmit={(values: any) =>
                    action.run(() =>
                      c.api.post(`/users/${id}`, {
                        username: values.username,
                        ...(values.password ? { password: values.password } : {}),
                        ...(id !== c.user.id ? { role: values.role } : {}),
                      }),
                    )
                  }
                >
                  <Field
                    label={i18n.text('用户名')}
                    name="username"
                    defaultValue={q.data.username}
                    required
                    maxLength={255}
                  />
                  <Field
                    label={i18n.text('新密码（可选）')}
                    name="password"
                    type="password"
                    minLength={8}
                    maxLength={255}
                    autoComplete="new-password"
                    help={i18n.text('留空保留当前密码，修改需至少 8 位。')}
                  />
                  <Select
                    label={i18n.text('系统角色')}
                    name="role"
                    options={userRoleOptions}
                    localizeLabels
                    defaultValue={q.data.role}
                    disabled={id === c.user.id}
                  />
                </Form>
              </Body>
            </Panel>
            <Panel
              title={i18n.text('账户安全')}
              subtitle={i18n.text('重置双重验证后，用户需要重新绑定。')}
            >
              <Body>
                <QueryState query={security}>
                  <Definition
                    items={[
                      [
                        i18n.text('双重验证'),
                        <Badge
                          key="cell-badge-13"
                          tone={security.data?.isEnabled ? 'green' : 'amber'}
                        >
                          {security.data?.isEnabled ? i18n.text('已启用') : i18n.text('未启用')}
                        </Badge>,
                      ],
                      [
                        i18n.text('账户要求'),
                        q.data.twoFactorRequired ? i18n.text('必须启用') : i18n.text('自主选择'),
                      ],
                      [
                        i18n.text('账户状态'),
                        <Badge key="cell-badge-14" tone="green">
                          {i18n.text('正常')}
                        </Badge>,
                      ],
                    ]}
                  />
                  <div className="form-actions">
                    <Button disabled={action.busy} onClick={() => setConfirm('reset')}>
                      {i18n.text('重置双重验证')}
                    </Button>
                    <Button
                      danger
                      disabled={id === c.user.id || action.busy}
                      onClick={() => setConfirm('delete')}
                    >
                      {i18n.text('删除用户')}
                    </Button>
                  </div>
                </QueryState>
              </Body>
            </Panel>
          </div>
          <Panel
            title={i18n.text('用户资源')}
            subtitle={i18n.text('管理员查看该账户的网站和团队。')}
          >
            <QueryState query={resources}>
              <Table
                mobile
                identity={1}
                rowKeys={[
                  ...(resources.data?.teams || []).map((team: any) => `team:${team.id}`),
                  ...(resources.data?.websites || []).map((site: any) => `site:${site.id}`),
                ]}
                columns={['类型', '资源名称', '角色', '操作']}
                rows={[
                  ...(resources.data?.teams || []).map((team: any) => [
                    <TableCell
                      sortValue={i18n.source('团队')}
                      searchValue={i18n.english.text('团队')}
                    >
                      {i18n.text('团队')}
                    </TableCell>,
                    team.name,
                    <TableCell
                      sortValue={role(
                        workspaceTeamRole(
                          { id, username: q.data.username, role: q.data.role },
                          team,
                        ),
                      )}
                      searchValue={i18n.english.system(
                        role(
                          workspaceTeamRole(
                            { id, username: q.data.username, role: q.data.role },
                            team,
                          ),
                        ),
                      )}
                    >
                      {i18n.system(
                        role(
                          workspaceTeamRole(
                            { id, username: q.data.username, role: q.data.role },
                            team,
                          ),
                        ),
                      )}
                    </TableCell>,
                    <TableCell
                      sortValue={i18n.source('查看')}
                      searchValue={i18n.english.text('查看')}
                    >
                      <LinkButton
                        key="cell-linkbutton-15"
                        page="team-detail"
                        params={{ id: team.id, teamId: team.id }}
                      >
                        {i18n.text('查看')}
                      </LinkButton>
                    </TableCell>,
                  ]),
                  ...(resources.data?.websites || []).map((site: any) => [
                    <TableCell
                      sortValue={i18n.source('网站')}
                      searchValue={i18n.english.text('网站')}
                    >
                      {i18n.text('网站')}
                    </TableCell>,
                    site.name,
                    <TableCell
                      sortValue={i18n.source('所有者')}
                      searchValue={i18n.english.text('所有者')}
                    >
                      {i18n.text('所有者')}
                    </TableCell>,
                    <TableCell
                      sortValue={i18n.source('查看')}
                      searchValue={i18n.english.text('查看')}
                    >
                      <LinkButton
                        key="cell-linkbutton-16"
                        page="website-settings"
                        params={{ websiteId: site.id }}
                      >
                        {i18n.text('查看')}
                      </LinkButton>
                    </TableCell>,
                  ]),
                ]}
              />
            </QueryState>
          </Panel>
          {confirm && (
            <Confirm
              title={i18n.system(
                confirm === 'reset' ? i18n.text('重置用户双重验证') : i18n.text('删除用户'),
              )}
              word={confirm === 'reset' ? 'RESET' : 'DELETE'}
              onClose={() => setConfirm('')}
              message={
                confirm === 'reset' ? i18n.source('用户双重验证已重置') : i18n.source('用户已删除')
              }
              navigateTo={confirm === 'delete' ? 'admin-users' : undefined}
              onConfirm={async () => {
                await c.api.del(confirm === 'reset' ? `/admin/users/${id}/2fa` : `/users/${id}`);
              }}
            >
              {confirm === 'reset'
                ? i18n.text('该用户需重新绑定验证器，现有恢复码将失效。')
                : i18n.text('此操作会删除该用户及其拥有的资源。请核对资源归属。')}
            </Confirm>
          )}
        </>
      )}
    </QueryState>
  );
}
function AdminWebsites() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', ''),
    [space, setSpace] = useState(''),
    [filter, setFilter] = useState(false);
  const q = useData(
    ['admin-websites', page, search, space],
    signal =>
      c.api.get(
        space ? `/teams/${space}/websites` : '/admin/websites',
        { page, pageSize: 20, search },
        signal,
      ),
    !!c.user.isAdmin,
  );
  const teams = useData(
    'admin-space-options',
    signal => getAllFeatureRows<any>('/admin/teams', {}, signal),
    filter && !!c.user.isAdmin,
  );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <>
      <Panel
        title={i18n.text('全局网站')}
        subtitle={i18n.text('系统管理员检索资源及所属账户、团队。')}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <LinkButton page="analytics-acceleration">{i18n.text('统计加速')}</LinkButton>
            <LinkButton page="history-repair">{i18n.text('历史数据修复')}</LinkButton>
            <Button onClick={() => setFilter(true)}>{i18n.text('按空间筛选')}</Button>
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(site => site.id)}
            columns={['网站', '域名', '所属空间', '所有者', '操作']}
            rows={rowsOf<any>(q.data).map(site => [
              site.name,
              site.domain,
              <TableCell
                sortValue={
                  site.team?.name ||
                  c.teams.find(team => team.id === (site.teamId || space))?.name ||
                  (site.teamId ? i18n.source('团队') : i18n.source('个人空间'))
                }
                searchValue={
                  site.team?.name ||
                  c.teams.find(team => team.id === (site.teamId || space))?.name ||
                  (site.teamId ? i18n.english.text('团队') : i18n.english.text('个人空间'))
                }
              >
                {site.team?.name ||
                  c.teams.find(team => team.id === (site.teamId || space))?.name ||
                  (site.teamId ? i18n.text('团队') : i18n.text('个人空间'))}
              </TableCell>,
              <TableCell
                sortValue={
                  site.user?.username ||
                  site.team?.members?.find((member: any) => member.role === 'team-owner')?.userId ||
                  i18n.source('未提供')
                }
                searchValue={
                  site.user?.username ||
                  site.team?.members?.find((member: any) => member.role === 'team-owner')?.userId ||
                  i18n.english.text('未提供')
                }
              >
                {site.user?.username ||
                  site.team?.members?.find((member: any) => member.role === 'team-owner')?.userId ||
                  i18n.text('未提供')}
              </TableCell>,
              <TableCell sortValue={i18n.source('设置')} searchValue={i18n.english.text('设置')}>
                <LinkButton
                  key="cell-linkbutton-17"
                  page="website-settings"
                  params={{ websiteId: site.id, teamId: site.teamId || space || undefined }}
                >
                  {i18n.text('设置')}
                </LinkButton>
              </TableCell>,
            ])}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      {filter && (
        <LiekanDialog title={i18n.text('按所属空间筛选')} onClose={() => setFilter(false)}>
          <QueryState query={teams}>
            <Form
              submitLabel={i18n.text('应用筛选')}
              onSubmit={(values: any) => {
                setSpace(values.space);
                setPage(1);
                setFilter(false);
              }}
            >
              <Select
                label={i18n.text('所属空间')}
                name="space"
                defaultValue={space}
                options={[
                  ['', i18n.text('全部空间')],
                  ...(teams.data || []).map((team: any) => ({ value: team.id, label: team.name })),
                ]}
              />
            </Form>
          </QueryState>
        </LiekanDialog>
      )}
    </>
  );
}
function AdminSecurity() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    q = useData(
      'workspace-security',
      signal => c.api.get('/2fa/status', undefined, signal),
      !!c.user.isAdmin,
    );
  if (!c.user.isAdmin) return <Forbidden />;
  return (
    <>
      <QueryState query={q}>
        <div className="wide-narrow">
          <Panel
            title={i18n.text('系统双重验证策略')}
            subtitle={i18n.text('全局要求覆盖个人与团队的自主设置。')}
          >
            <Body>
              <Form
                resetKey={String(q.data?.globalRequired)}
                busy={action.busy}
                disabled={!q.data?.isConfigured}
                submitLabel={i18n.text('保存全局策略')}
                onSubmit={(values: any) =>
                  action.run(() =>
                    c.api.post('/admin/2fa/global', { required: values.required === 'on' }),
                  )
                }
              >
                <Switch
                  label={i18n.text('所有用户必须启用双重验证')}
                  name="required"
                  defaultChecked={q.data?.globalRequired}
                  help={i18n.text('下次登录时引导尚未绑定的用户完成设置。')}
                />
                <hr className="divider" />
                <Notice tone={q.data?.isConfigured ? 'blue' : 'red'}>
                  {q.data?.isConfigured
                    ? i18n.text('加密配置已就绪。开启前请确认管理员已保存恢复码。')
                    : i18n.text('服务缺少加密配置，暂时无法开启全局策略。请先完成服务端配置。')}
                </Notice>
              </Form>
            </Body>
          </Panel>
          <Panel title={i18n.text('配置状态')} subtitle={i18n.text('当前服务的配置与策略。')}>
            <Body>
              <Definition
                items={[
                  [
                    i18n.text('加密配置'),
                    <Badge key="cell-badge-18" tone={q.data?.isConfigured ? 'green' : 'red'}>
                      {q.data?.isConfigured ? i18n.text('已配置') : i18n.text('未配置')}
                    </Badge>,
                  ],
                  [
                    i18n.text('全局要求'),
                    q.data?.globalRequired ? i18n.text('开启') : i18n.text('关闭'),
                  ],
                  [i18n.text('团队策略'), i18n.text('全局要求开启时，团队无法覆盖')],
                ]}
              />
            </Body>
          </Panel>
        </div>
      </QueryState>
      <Panel
        title={i18n.text('爬虫来源与核验')}
        subtitle={i18n.text('来源状态、官方资料和目录变更集中在爬虫管理页。')}
      >
        <Body>
          <LinkButton page="crawlers-manage" params={{ tab: 'sources' }}>
            {i18n.text('打开爬虫管理')}
          </LinkButton>
        </Body>
      </Panel>
    </>
  );
}

export function ResourceAnalytics({
  id,
  boardId,
  kind = 'website',
  title = '访问趋势',
  metrics = true,
  request,
  range,
  filters = {},
  variant,
  allowGoals = true,
  chartEnabled = true,
}: {
  chartEnabled?: boolean;
  variant?: 'board' | 'public';
  allowGoals?: boolean;
  id: string;
  boardId?: string;
  kind?: string;
  title?: string;
  metrics?: boolean;
  request?: (path: string, params?: any, signal?: AbortSignal) => Promise<any>;
  range?: any;
  filters?: any;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    params = {
      ...(range || c?.range),
      ...filters,
      ...(!request ? (kind === 'website' ? c?.filters : {}) : {}),
      ...(kind === 'link' ? { eventType: 3 } : kind === 'pixel' ? { eventType: 4 } : {}),
    };
  const get =
    request || ((path: string, query: any, signal?: AbortSignal) => c.api.get(path, query, signal));
  const q = useFreshQuery(
    {
      queryKey: [
        'liekan-feature',
        'resource-analytics',
        request ? (request as any).shareCacheKey || (request as any).shareToken : c?.user?.id,
        id,
        kind,
        params,
        metrics,
        variant,
        allowGoals,
        boardId,
      ],
      meta: !request ? {
        cacheAggregate: true,
        cacheResources: [
          { type: kind, id },
          ...(boardId ? [{ type: 'board', id: boardId }] : []),
        ],
      } : { cacheAggregate: false },
      queryFn: ({ signal }) =>
        (async () => {
          const [stats, trend, aiTrend] = await Promise.all([
            metrics ? get(`/websites/${id}/stats`, params, signal) : null,
            get(`/websites/${id}/pageviews`, params, signal),
            kind === 'website'
              ? get(
                  `/websites/${id}/pageviews`,
                  { ...params, drill_channel: 'eq.AI 搜索引荐' },
                  signal,
                )
              : null,
          ]);
          const aiStats =
            metrics && variant && kind === 'website'
              ? await get(
                  `/websites/${id}/stats`,
                  { ...params, drill_channel: 'eq.AI 搜索引荐' },
                  signal,
                )
              : null;
          let appointment: any = null;
          if (metrics && variant && kind === 'website' && allowGoals) {
            const goals = await allSharedRows(get, `/websites/${id}/goals`, signal);
            const goal = goals.find((g: any) =>
              /预约|appointment|book.*demo|demo.*book/i.test(g.name || ''),
            );
            if (goal)
              appointment = await get(`/websites/${id}/goals/${goal.id}/stats`, params, signal);
          }
          return { stats, trend, aiTrend, aiStats, appointment };
        })(),
      staleTime: query => freshnessStaleTime(query),
      gcTime: 600000,
      structuralSharing: shareWithFreshness,
      enabled: !!id,
      retry: false,
      ...(request ? { gcTime: 600000 } : {}),
    },
    { aggregate: true, endAt: params.endAt, timezone: params.timezone },
  );
  const trend = q.data?.trend,
    points = trend?.pageviews || [],
    sessions = trend?.sessions || [];
  return (
    <QueryState query={q}>
      {metrics && (
        <Metrics
          loading={q.isPending}
          items={
            variant
              ? variant === 'board'
                ? [
                    [
                      i18n.text('访客'),
                      readable(q.data?.stats?.visitors, i18n.system),
                      i18n.text('当前期间'),
                    ],
                    [
                      i18n.text('AI 引荐'),
                      readable(q.data?.aiStats?.visitors, i18n.system),
                      i18n.text('已识别来源'),
                    ],
                    [
                      i18n.text('预约转化'),
                      q.data?.appointment
                        ? readable(q.data.appointment.conversions, i18n.system)
                        : i18n.text('未配置'),
                      i18n.text('所选预约目标的事件触发次数'),
                    ],
                    [
                      i18n.text('转化访客'),
                      q.data?.appointment
                        ? readable(q.data.appointment.num, i18n.system)
                        : i18n.text('未配置'),
                      i18n.text('独立转化访客'),
                    ],
                  ]
                : [
                    [
                      i18n.text('访客'),
                      readable(q.data?.stats?.visitors, i18n.system),
                      i18n.text('当前期间'),
                    ],
                    [
                      i18n.label('访问次数', 'pageviews'),
                      readable(q.data?.stats?.pageviews, i18n.system),
                      i18n.text('页面访问次数'),
                    ],
                    [
                      i18n.text('AI 引荐'),
                      readable(q.data?.aiStats?.visitors, i18n.system),
                      i18n.text('已识别来源'),
                    ],
                    [
                      i18n.text('预约演示'),
                      q.data?.appointment
                        ? readable(q.data.appointment.conversions, i18n.system)
                        : allowGoals
                          ? i18n.text('未配置')
                          : i18n.text('未授权'),
                      i18n.text('所选预约目标的事件触发次数'),
                    ],
                  ]
              : [
                  [
                    kind === 'link'
                      ? i18n.text('点击次数')
                      : kind === 'pixel'
                        ? i18n.text('请求次数')
                        : i18n.text('页面访问'),
                    readable(q.data?.stats?.pageviews, i18n.system),
                    i18n.text('当前期间'),
                  ],
                  [
                    i18n.text('独立访客'),
                    readable(q.data?.stats?.visitors, i18n.system),
                    kind === 'pixel' ? i18n.text('请求访问标识聚合') : i18n.text('访问标识聚合'),
                  ],
                  [
                    i18n.text('访问次数'),
                    readable(q.data?.stats?.visits, i18n.system),
                    i18n.text('当前期间'),
                  ],
                  [
                    i18n.text('统计口径'),
                    kind === 'pixel'
                      ? i18n.text('图片请求')
                      : kind === 'link'
                        ? i18n.text('链接点击')
                        : i18n.text('网站访问'),
                    kind === 'pixel'
                      ? i18n.text('包括代理与缓存影响')
                      : i18n.text('按采集记录统计'),
                  ],
                ]
          }
        />
      )}
      {chartEnabled && variant !== 'board' && (
        <Chart
          interactionKey={JSON.stringify([
            'resource',
            request ? (request as any).shareCacheKey : c?.user?.id,
            id,
            kind,
            params,
            metrics,
            variant,
            allowGoals,
            q.data,
          ])}
          title={i18n.system(title)}
          subtitle={i18n.text('所选日期范围')}
          labels={points.map((point: any) =>
            params.unit === 'day' ? String(point.x).slice(5, 10) : String(point.x),
          )}
          series={[
            {
              name:
                kind === 'link'
                  ? i18n.text('点击次数')
                  : kind === 'pixel'
                    ? i18n.text('请求次数')
                    : i18n.text('访客'),
              values: (kind === 'website' ? sessions : points).map((point: any) =>
                nativeMetric(point.y),
              ),
            },
            kind === 'website'
              ? {
                  name: i18n.text('AI 引荐'),
                  color: '#009D9A',
                  values: (q.data?.aiTrend?.sessions || []).map((point: any) =>
                    nativeMetric(point.y),
                  ),
                }
              : {
                  name: i18n.text('独立访客'),
                  values: sessions.map((point: any) => nativeMetric(point.y)),
                },
          ]}
        />
      )}
    </QueryState>
  );
}
function Boards() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    [page, setPage] = useListState('page', 1),
    [search, setSearch] = useListState('search', '');
  const entities = useWorkspaceEntities();
  const q = useData(['boards', c.route.teamId, page, search], signal =>
    c.api.get(
      c.route.teamId ? `/teams/${c.route.teamId}/boards` : '/boards',
      { page, pageSize: 20, search },
      signal,
    ),
  );
  const team = c.teams.find(team => team.id === c.route.teamId);
  return (
    <>
      <Panel
        title={i18n.text('自定义看板')}
        subtitle={i18n.text('按网站、链接、像素或多个资源组织分析。')}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            {canCreateResource(c.user, team) && (
              <LinkButton page="board-editor" primary>
                <Icon name="plus" />
                {i18n.fragment('创建看板', true, false)}
              </LinkButton>
            )}
          </>
        }
      >
        <QueryState query={q}>
          <Table
            mobile
            rowKeys={rowsOf<any>(q.data).map(board => board.id)}
            columns={['名称', '类型', '关联资源', '更新时间', '操作']}
            rows={rowsOf<any>(q.data).map(board => {
              const entity = boardEntity(board.parameters, board.type);
              const resources: any[] = (entities.data as any)?.[entity.entityType] || [];
              return [
                board.name,
                <Badge key="cell-badge-19">{labels[board.type] || board.type}</Badge>,
                <TableCell
                  sortValue={
                    entity.entityId
                      ? entities.data
                        ? resources.find(item => item.id === entity.entityId)?.name ||
                          i18n.source('资源不存在')
                        : entities.isPending
                          ? i18n.source('正在读取')
                          : '—'
                      : i18n.source('{v0} 个组件', [boardColumns(board.parameters).length])
                  }
                  searchValue={
                    entity.entityId
                      ? entities.data
                        ? resources.find(item => item.id === entity.entityId)?.name ||
                          i18n.english.text('资源不存在')
                        : entities.isPending
                          ? i18n.english.text('正在读取')
                          : '—'
                      : i18n.english.text('{v0} 个组件', [boardColumns(board.parameters).length])
                  }
                >
                  {entity.entityId
                    ? entities.data
                      ? resources.find(item => item.id === entity.entityId)?.name ||
                        i18n.text('资源不存在')
                      : entities.isPending
                        ? i18n.text('正在读取')
                        : '—'
                    : i18n.text('{v0} 个组件', [boardColumns(board.parameters).length])}
                </TableCell>,
                date(board.updatedAt),
                <TableCell sortValue={i18n.source('打开')} searchValue={i18n.english.text('打开')}>
                  <LinkButton key="cell-linkbutton-20" page="board-view" params={{ id: board.id }}>
                    {i18n.text('打开')}
                  </LinkButton>
                </TableCell>,
              ];
            })}
            page={page}
            pages={pagesOf(q.data)}
            onPage={setPage}
          />
        </QueryState>
      </Panel>
      <Notice>{i18n.text('看板包括基本信息、图表编排和只读分享。复制看板会保留布局。')}</Notice>
    </>
  );
}
function BoardEditor({ board }: { board?: any }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    entities = useWorkspaceEntities(),
    [type, setType] = useState(board?.type === 'open' ? 'mixed' : board?.type || 'website');
  const selected = boardEntity(board?.parameters, board?.type),
    allowed = board ? canManageResource(c.user, board, c.teams) : canCreateResource(c.user);
  return (
    <Panel
      title={i18n.text('看板信息')}
      subtitle={i18n.text('资源类型沿用上游网站、像素、链接与混合看板。')}
    >
      <Body>
        {!allowed && <ReadOnly />}
        <QueryState query={entities}>
          <Form
            busy={action.busy}
            disabled={!allowed}
            submitLabel={i18n.text('保存并编排')}
            cancel={<LinkButton page="boards">{i18n.text('取消')}</LinkButton>}
            onSubmit={async (values: any) => {
              if (
                !board &&
                !canCreateResource(
                  c.user,
                  values.owner ? c.teams.find(team => team.id === values.owner) : undefined,
                )
              )
                throw new Error('当前空间没有创建看板的权限');
              if (!board && values.owner && !c.teams.some(team => team.id === values.owner))
                throw new Error('请选择可访问的所属空间');
              if (type !== 'mixed' && !values.entity) throw new Error('请选择关联资源');
              const result = await action.run(() =>
                c.api.post(board ? `/boards/${board.id}` : '/boards', {
                  name: values.name,
                  description: values.description,
                  type,
                  parameters: boardParameters(board?.parameters, type, values.entity, board?.type),
                  ...(!board && values.owner ? { teamId: values.owner } : {}),
                }),
              );
              c.navigate('board-design', {
                id: result.id,
                teamId: result.teamId || values.owner || '',
              });
            }}
          >
            {board ? (
              <Definition
                items={[
                  [
                    i18n.text('所属空间'),
                    board.teamId
                      ? c.teams.find(team => team.id === board.teamId)?.name ||
                        i18n.text('团队空间')
                      : i18n.text('个人空间'),
                  ],
                ]}
              />
            ) : (
              <Select
                label={i18n.text('所属空间')}
                name="owner"
                defaultValue={c.route.teamId || ''}
                options={[
                  ['', i18n.text('个人空间')],
                  ...c.teams
                    .filter(team => canCreateResource(c.user, team))
                    .map(team => [team.id, team.name] as [string, string]),
                ]}
              />
            )}
            <Field
              label={i18n.text('看板名称')}
              name="name"
              defaultValue={board?.name || ''}
              required
              maxLength={board ? 200 : 100}
            />
            <Textarea
              label={i18n.text('说明')}
              name="description"
              defaultValue={board?.description || ''}
              maxLength={500}
            />
            <div className="form-grid">
              <Select
                label={i18n.text('看板类型')}
                name="type"
                value={type}
                onChange={e => setType(e.target.value)}
                options={types}
                localizeLabels
              />
              {type !== 'mixed' && (
                <Select
                  key={type}
                  label={i18n.text('关联资源')}
                  name="entity"
                  defaultValue={selected.entityType === type ? selected.entityId : ''}
                  required
                  options={[
                    ['', i18n.text('请选择资源')],
                    ...(entities.data?.[type] || []).map((entity: any) => [entity.id, entity.name]),
                  ]}
                />
              )}
            </div>
            <Notice>
              {i18n.text('网站、链接、像素看板需要选择对应资源。混合看板由各图表分别选择资源。')}
            </Notice>
          </Form>
        </QueryState>
      </Body>
    </Panel>
  );
}
const widgetTypes: [string, string][] = [
  ['WebsiteChart', '访客趋势'],
  ['MetricsTable', '访问来源'],
  ['EventsChart', '转化事件'],
  ['WebsiteMetricsBar', '指标摘要'],
];
function WidgetDrawer({
  board,
  column,
  onSave,
  onClose,
}: {
  board: any;
  column?: any;
  onSave: (component: WorkspaceComponent, full: boolean) => void;
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const entities = useWorkspaceEntities(),
    [type, setType] = useState(column?.component?.type || 'WebsiteChart'),
    [entityType, setEntityType] = useState(column?.component?.entityType || 'website');
  const boardResource = boardEntity(board.parameters, board.type),
    fixed = !!boardResource.entityType,
    actualType = fixed ? boardResource.entityType : entityType,
    eventOnly = type === 'EventsChart';
  return (
    <LiekanDialog
      size="wide"
      title={i18n.system(column ? i18n.text('编辑看板组件') : i18n.text('添加看板组件'))}
      onClose={onClose}
    >
      <QueryState query={entities}>
        <Form
          columns
          submitLabel={i18n.system(column ? i18n.text('保存组件') : i18n.text('添加组件'))}
          onSubmit={(values: any) => {
            const entityId = fixed ? boardResource.entityId : values.entityId;
            if (!entityId) throw new Error('请选择关联资源');
            if (eventOnly && actualType !== 'website') throw new Error('转化事件组件需要网站资源');
            onSave(
              bindBoardComponent(
                {
                  ...column?.component,
                  title: values.title,
                  type,
                  props: {
                    ...column?.component?.props,
                    ...(type === 'MetricsTable'
                      ? { type: values.dimension || 'channel', liekanDisplay: 'bar' }
                      : {}),
                  },
                },
                fixed ? undefined : actualType,
                fixed ? undefined : entityId,
              ),
              values.full === 'on',
            );
            onClose();
          }}
        >
          <Field
            label={i18n.text('组件标题')}
            name="title"
            defaultValue={column?.component?.title || ''}
            required
            maxLength={100}
          />
          <Select
            label={i18n.text('图表类型')}
            name="type"
            options={[
              ...widgetTypes.filter(
                ([value]) => actualType === 'website' || value !== 'EventsChart',
              ),
              ...(column?.component?.type &&
              !widgetTypes.some(([value]) => value === column.component.type)
                ? [[column.component.type, i18n.text('原有组件（保留配置）')] as [string, string]]
                : []),
            ]}
            localizeLabels
            value={type}
            onChange={e => setType(e.target.value)}
          />
          {!fixed && (
            <Select
              label={i18n.text('资源类型')}
              value={entityType}
              onChange={e => {
                setEntityType(e.target.value);
                if (e.target.value !== 'website' && type === 'EventsChart') setType('WebsiteChart');
              }}
              options={types.filter(([value]) => value !== 'mixed')}
              localizeLabels
            />
          )}
          {fixed ? (
            <Definition
              items={[
                [
                  i18n.text('关联资源'),
                  entities.data?.[actualType]?.find(
                    (entity: any) => entity.id === boardResource.entityId,
                  )?.name || boardResource.entityId,
                ],
              ]}
            />
          ) : (
            <Select
              key={actualType}
              label={i18n.text('关联资源')}
              name="entityId"
              required
              defaultValue={column?.component?.entityId || column?.component?.websiteId || ''}
              options={[
                ['', i18n.text('请选择资源')],
                ...(entities.data?.[actualType] || []).map((entity: any) => [
                  entity.id,
                  entity.name,
                ]),
              ]}
            />
          )}
          {type === 'MetricsTable' && (
            <Select
              label={i18n.text('访问维度')}
              name="dimension"
              options={[
                ['channel', i18n.text('访问渠道')],
                ['referrer', i18n.text('来源')],
                ['country', i18n.text('国家 / 地区')],
                ['browser', i18n.text('浏览器')],
                ['device', i18n.text('设备')],
                ['path', i18n.text('页面')],
              ]}
              localizeLabels
              defaultValue={column?.component?.props?.type || 'channel'}
            />
          )}
          <Notice>{i18n.text('组件保存后，请继续保存看板以保留本次配置。')}</Notice>
          <Check
            name="full"
            defaultChecked={
              column &&
              boardColumns(board.parameters).find(entry => entry.column.id === column.id)?.row
                .columns.length === 1 &&
              (column.size ?? 100) > 50
            }
          >
            {i18n.text('占据整行')}
          </Check>
        </Form>
      </QueryState>
    </LiekanDialog>
  );
}
function NativeWidget({
  board,
  component,
  request,
  range,
}: {
  board: any;
  component: WorkspaceComponent;
  request?: any;
  range?: any;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    resolved = boardEntity(board.parameters, board.type),
    id = resolved.entityId || component?.entityId || component?.websiteId,
    kind = resolved.entityType || component?.entityType || 'website';
  const get =
    request ||
    ((path: string, params: any, signal?: AbortSignal) => c.api.get(path, params, signal));
  const params = {
    ...(range || c?.range),
    ...(!request && kind === 'website' ? c?.filters : {}),
    ...(kind === 'link' ? { eventType: 3 } : kind === 'pixel' ? { eventType: 4 } : {}),
  };
  const dimension = component?.props?.type || 'referrer',
    table = ['MetricsTable', 'UTM', 'WorldMap'].includes(component?.type),
    events = component?.type === 'EventsChart',
    conversion = ['Goal', 'Funnel'].includes(component?.type),
    eventMetrics = component?.type === 'EventsMetricsBar',
    reportId = component?.props?.reportId;
  const pageDomain =
    kind === 'website' ? c?.sites?.find(site => site.id === id)?.domain : undefined;
  const q = useFreshQuery(
    {
      queryKey: [
        'liekan-feature',
        'board-widget',
        request ? request.shareCacheKey || request.shareToken : c?.user?.id,
        id,
        component,
        params,
        board.id,
      ],
      meta: !request ? {
        cacheAggregate: true,
        cacheResources: [{ type: kind, id }, { type: 'board', id: board.id }],
      } : { cacheAggregate: false },
      queryFn: ({ signal }) =>
        get(
          `/websites/${id}/${conversion ? `${component.type === 'Goal' ? 'goals' : 'funnels'}/${reportId}/stats` : eventMetrics ? 'events/stats' : events ? 'events/series' : component.type === 'UTM' ? 'utm/metrics' : 'metrics'}`,
          {
            ...params,
            type: events
              ? 'event'
              : component.type === 'UTM'
                ? component.props?.param || 'utm_source'
                : component.type === 'WorldMap'
                  ? 'country'
                  : dimension,
            limit: component.props?.limit || 10,
          },
          signal,
        ),
      enabled: !!id && (table || events || eventMetrics || (conversion && !!reportId)),
      retry: false,
      ...(request ? { gcTime: 600000 } : {}),
    },
    { aggregate: true, endAt: params.endAt, timezone: params.timezone },
  );
  if (!component) return <div className="state-box">{i18n.text('尚未配置组件')}</div>;
  if (component.type === 'TextBlock')
    return (
      <Body>
        <p style={{ whiteSpace: 'pre-wrap' }}>
          {component.props?.content || component.props?.text || ''}
        </p>
      </Body>
    );
  if (!id) return <Notice tone="amber">{i18n.text('组件尚未选择关联资源。')}</Notice>;
  if (conversion && !reportId)
    return (
      <Notice tone="amber">
        {i18n.fragment('此组件尚未选择已保存的', false, true)}
        {component.type === 'Goal' ? i18n.text('目标') : i18n.text('漏斗')}。
      </Notice>
    );
  if (conversion)
    return (
      <QueryState query={q}>
        {component.type === 'Goal' ? (
          <Metrics
            loading={q.isPending}
            items={[
              [i18n.text('转化访客'), readable(q.data?.num, i18n.system), i18n.text('独立访客')],
              [i18n.text('入组访客'), readable(q.data?.total, i18n.system), i18n.text('所选期间')],
              [
                i18n.text('转化率'),
                q.data?.total > 0
                  ? `${((q.data.num / q.data.total) * 100).toFixed(2)}%`
                  : q.data?.total === 0
                    ? i18n.text('无入组访客')
                    : i18n.text('未提供'),
                i18n.text('转化访客 / 入组访客'),
              ],
            ]}
          />
        ) : (
          <Chart
            interactionKey={JSON.stringify([
              'widget',
              request ? request.shareCacheKey : c?.user?.id,
              board.id,
              id,
              kind,
              component,
              params,
              q.data,
            ])}
            type="bar"
            labels={rowsOf<any>(q.data).map(
              (step, index) => step.value || i18n.text('步骤 {v0}', [index + 1]),
            )}
            series={[
              {
                name: i18n.text('转化访客'),
                values: rowsOf<any>(q.data).map(step => nativeMetric(step.visitors)),
              },
            ]}
          />
        )}
      </QueryState>
    );
  if (eventMetrics)
    return (
      <QueryState query={q}>
        <Metrics
          loading={q.isPending}
          items={[
            [
              i18n.text('事件次数'),
              readable(q.data?.data?.events, i18n.system),
              i18n.text('当前期间'),
            ],
            [
              i18n.text('触发访客'),
              readable(q.data?.data?.visitors, i18n.system),
              i18n.text('独立访客'),
            ],
            [
              i18n.text('触发访问'),
              readable(q.data?.data?.visits, i18n.system),
              i18n.text('当前期间'),
            ],
            [
              i18n.text('事件种类'),
              readable(q.data?.data?.uniqueEvents, i18n.system),
              i18n.text('当前期间'),
            ],
          ]}
        />
      </QueryState>
    );
  if (['WebsiteChart', 'WebsiteMetricsBar'].includes(component.type))
    return (
      <ResourceAnalytics
        id={id}
        boardId={board.id}
        kind={kind}
        title=""
        chartEnabled={component.type !== 'WebsiteMetricsBar'}
        metrics={component.type === 'WebsiteMetricsBar'}
        request={request}
        range={range}
      />
    );
  if (table || events)
    return (
      <QueryState query={q}>
        {events ? (
          <Chart
            interactionKey={JSON.stringify([
              'widget',
              request ? request.shareCacheKey : c?.user?.id,
              board.id,
              id,
              kind,
              component,
              params,
              q.data,
            ])}
            {...eventChartData(rowsOf<any>(q.data))}
            type="line"
          />
        ) : component?.props?.liekanDisplay === 'bar' ? (
          <Chart
            interactionKey={JSON.stringify([
              'widget',
              request ? request.shareCacheKey : c?.user?.id,
              board.id,
              id,
              kind,
              component,
              params,
              q.data,
            ])}
            type="bar"
            option={{
              grid: { left: 96, right: 56, top: 34, bottom: 26 },
              xAxis: {
                type: 'value',
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 10, color: '#9AA3B2' },
                splitLine: { lineStyle: { color: '#E9ECF1' } },
              },
              yAxis: {
                type: 'category',
                data: rowsOf<any>(q.data)
                  .map(row => row.utm ?? row.x ?? '直接访问')
                  .reverse(),
                axisLine: { show: false },
                axisTick: { show: false },
                axisLabel: { fontSize: 11, color: '#697386' },
              },
              series: [
                {
                  name: i18n.text('独立访客'),
                  type: 'bar',
                  data: rowsOf<any>(q.data)
                    .map(row => nativeMetric(row.views ?? row.y))
                    .reverse(),
                  barWidth: 14,
                  itemStyle: { borderRadius: [0, 3, 3, 0] },
                  label: { show: true, position: 'right', fontSize: 11, color: '#697386' },
                },
              ],
            }}
          />
        ) : (
          <Table
            columns={[
              component.type === 'WorldMap'
                ? '国家 / 地区'
                : component.type === 'UTM'
                  ? 'UTM 来源'
                  : '访问维度',
              '访客',
            ]}
            rows={rowsOf<any>(q.data).map(row => [
              <TableCell
                sortValue={
                  component.type === 'MetricsTable' && dimension === 'path'
                    ? pageLink(row.x, pageDomain, undefined, undefined, 'zh-CN')
                    : (row.utm ?? row.x ?? i18n.source('直接访问'))
                }
                searchValue={
                  component.type === 'MetricsTable' && dimension === 'path'
                    ? pageLink(row.x, pageDomain, undefined, undefined, 'en-US')
                    : (row.utm ?? row.x ?? i18n.english.text('直接访问'))
                }
              >
                {component.type === 'MetricsTable' && dimension === 'path'
                  ? pageLink(row.x, pageDomain, undefined, undefined, i18n.locale)
                  : (row.utm ?? row.x ?? i18n.text('直接访问'))}
              </TableCell>,
              <TableCell
                sortValue={readable(row.views ?? row.y, canonicalText => canonicalText)}
                searchValue={readable(row.views ?? row.y, i18n.english.system)}
              >
                {readable(row.views ?? row.y, i18n.system)}
              </TableCell>,
            ])}
            numeric={[1]}
          />
        )}
      </QueryState>
    );
  return (
    <Body>
      <Notice tone="amber">
        {i18n.fragment('此看板组件「', false, true)}
        {component.type}
        {i18n.fragment('」的统计展示尚未接入新界面。现有配置会保留。', true, false)}
      </Notice>
    </Body>
  );
}
function BoardCanvas({
  board,
  editing = false,
  request,
  range,
}: {
  board: any;
  editing?: boolean;
  request?: any;
  range?: any;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    [parameters, setParameters] = useState<WorkspaceParameters>(board.parameters || {}),
    [drawer, setDrawer] = useState<any>(null),
    [drag, setDrag] = useState(''),
    [confirm, setConfirm] = useState('');
  const previousBoard = useRef(board);
  if (previousBoard.current !== board) {
    const previous = previousBoard.current;
    const localChanges = JSON.stringify(parameters) !== JSON.stringify(previous.parameters || {});
    if (previous.id !== board.id || !editing || !localChanges)
      setParameters(board.parameters || {});
    previousBoard.current = board;
  }
  const allowed = !request && canManageResource(c?.user, board, c?.teams),
    entries = boardColumns(parameters),
    entity = boardEntity(parameters, board.type);
  const unsaved = editing && JSON.stringify(parameters) !== JSON.stringify(board.parameters || {});
  const add = (component: WorkspaceComponent, full: boolean, column?: any) => {
    if (column) {
      setParameters(current => {
        const updated = updateBoardColumn(current, column.id, { component });
        const entry = boardColumns(updated).find(item => item.column.id === column.id);
        const currentFull = entry?.row.columns.length === 1 && (entry.column.size ?? 100) > 50;
        return currentFull === full ? updated : setBoardColumnWidth(updated, column.id, full, uid);
      });
      return;
    }
    setParameters(current => {
      const rows = [...(current.rows || [])],
        newColumn = { id: uid(), size: full ? 100 : 50, component };
      const index = !full
        ? rows.findIndex(row => row.columns.length === 1 && (row.columns[0].size ?? 100) <= 50)
        : -1;
      if (index >= 0)
        rows[index] = { ...rows[index], columns: [...rows[index].columns, newColumn] };
      else rows.push({ id: uid(), columns: [newColumn] });
      return { ...current, rows };
    });
  };
  return (
    <>
      <div className="row between" data-unsaved={unsaved || undefined}>
        <div>
          <h2>{board.name}</h2>
          <p className="muted">{board.description || i18n.text('图表顺序与布局宽度均可调整。')}</p>
        </div>
        {!request && (
          <div className="actions">
            {editing ? (
              <>
                <Button disabled={!allowed || action.busy} onClick={() => setDrawer({})}>
                  <Icon name="plus" />
                  {i18n.fragment('添加组件', true, false)}
                </Button>
                <Button
                  primary
                  disabled={!allowed || action.busy}
                  onClick={() =>
                    action.run(
                      () =>
                        c.api.post(`/boards/${board.id}`, {
                          parameters: boardParameters(
                            parameters,
                            board.type,
                            entity.entityId,
                            board.type,
                          ),
                        }),
                      '编排已保存',
                    )
                  }
                >
                  {action.busy ? i18n.text('保存中…') : i18n.text('保存编排')}
                </Button>
                <LinkButton page="board-view" params={{ id: board.id }}>
                  {i18n.text('预览')}
                </LinkButton>
              </>
            ) : (
              <>
                <LinkButton page="board-editor" params={{ id: board.id }}>
                  {i18n.text('基本信息')}
                </LinkButton>
                <LinkButton page="board-design" params={{ id: board.id }}>
                  {i18n.text('编排')}
                </LinkButton>
                <LinkButton
                  page="sharing"
                  params={{ id: board.id, teamId: board.teamId || '', resource: 'board' }}
                >
                  {i18n.text('分享')}
                </LinkButton>
                {allowed && (
                  <>
                    <Button
                      disabled={action.busy}
                      onClick={async () => {
                        const result = await action.run(
                          () =>
                            c.api.post(`/boards/${board.id}/clone`, {
                              name: `${board.name}（副本）`,
                            }),
                          '看板已复制',
                        );
                        c.navigate('board-editor', { id: result.id });
                      }}
                    >
                      {i18n.text('复制')}
                    </Button>
                    <Button danger disabled={action.busy} onClick={() => setConfirm('delete')}>
                      {i18n.text('删除')}
                    </Button>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {editing && !allowed && <ReadOnly />}
      {!editing && entity.entityId && (
        <ResourceAnalytics
          id={entity.entityId}
          boardId={board.id}
          kind={entity.entityType}
          variant="board"
          allowGoals={board._shareGoalsAllowed !== false}
          request={request}
          range={range}
        />
      )}
      {entries.length ? (
        <div className="stack">
          {(parameters.rows || []).map(row => (
            <div
              className="board-grid"
              key={row.id}
              style={
                {
                  '--board-columns':
                    row.columns.length === 1
                      ? 'repeat(2,minmax(0,1fr))'
                      : row.columns.map(column => `minmax(0,${column.size || 1}fr)`).join(' '),
                } as CSSProperties
              }
            >
              {row.columns.map(column => {
                const index = entries.findIndex(entry => entry.column.id === column.id),
                  full = row.columns.length === 1 && (column.size ?? 100) > 50;
                return (
                  <section
                    key={column.id}
                    className={`panel board-widget${full ? ' full' : ''}`}
                    style={{ gridColumn: full ? '1 / -1' : undefined }}
                    draggable={editing && allowed && !action.busy}
                    onDragStart={e => {
                      setDrag(column.id);
                      e.dataTransfer.setData('text/plain', column.id);
                    }}
                    onDragOver={e => {
                      if (editing && allowed && !action.busy) e.preventDefault();
                    }}
                    onDrop={e => {
                      e.preventDefault();
                      if (editing && allowed && !action.busy)
                        setParameters(current =>
                          moveBoardColumn(
                            current,
                            e.dataTransfer.getData('text/plain') || drag,
                            column.id,
                          ),
                        );
                      setDrag('');
                    }}
                  >
                    {editing ? (
                      <div className="widget-tools">
                        <strong>{column.component?.title || i18n.text('未命名组件')}</strong>
                        <div className="actions" style={{ marginLeft: 'auto' }}>
                          <Button
                            disabled={!allowed || action.busy || index === 0}
                            onClick={() =>
                              setParameters(current =>
                                moveBoardColumn(current, column.id, entries[index - 1].column.id),
                              )
                            }
                          >
                            {i18n.text('上移')}
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            onClick={() =>
                              setParameters(current =>
                                setBoardColumnWidth(current, column.id, !full, uid),
                              )
                            }
                          >
                            {full ? i18n.text('半宽') : i18n.text('全宽')}
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            onClick={() => setDrawer({ column })}
                          >
                            {i18n.text('编辑')}
                          </Button>
                          <Button
                            disabled={!allowed || action.busy}
                            aria-label={i18n.text('移除组件 {v0}', [column.component?.title || ''])}
                            onClick={() =>
                              setParameters(current => removeBoardColumn(current, column.id))
                            }
                          >
                            <Icon name="close" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="panel-head">
                        <h2>{column.component?.title || i18n.text('统计组件')}</h2>
                      </div>
                    )}
                    <NativeWidget
                      board={{ ...board, parameters }}
                      component={column.component}
                      request={request}
                      range={range}
                    />
                  </section>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <Notice>{i18n.text('尚未添加看板组件。')}</Notice>
      )}
      {editing && <Notice>{i18n.text('保存后，图表顺序、组件配置和布局宽度会写入看板。')}</Notice>}
      {drawer && (
        <WidgetDrawer
          board={{ ...board, parameters }}
          column={drawer.column}
          onClose={() => setDrawer(null)}
          onSave={(component, full) => add(component, full, drawer.column)}
        />
      )}
      {confirm && (
        <Confirm
          title={i18n.text('删除看板')}
          onClose={() => setConfirm('')}
          message={i18n.source('「{v0}」已删除', [board.name])}
          navigateTo="boards"
          onConfirm={async () => {
            await c.api.del(`/boards/${board.id}`);
          }}
        >
          {i18n.text('看板及其分享链接会被删除，原始资源数据继续保留。')}
        </Confirm>
      )}
    </>
  );
}
function BoardPage({ page }: { page: string }) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    id = c.route.id,
    q = useData(
      ['board-record', id],
      signal => c.api.get(`/boards/${id}`, undefined, signal),
      !!id,
    );
  useResourceContext(q.data);
  if (!id)
    return page === 'board-editor' ? (
      <BoardEditor />
    ) : (
      <Notice>
        {i18n.fragment('请选择一个看板。', false, true)}
        <LinkButton page="boards">{i18n.text('看板列表')}</LinkButton>
      </Notice>
    );
  return (
    <QueryState query={q}>
      {q.data &&
        (page === 'board-editor' ? (
          <BoardEditor key={id} board={q.data} />
        ) : (
          <ManualReadDependencyBoundary ready={q.isSuccess && !q.isPlaceholderData}>
            <BoardCanvas key={id} board={q.data} editing={page === 'board-design'} />
          </ManualReadDependencyBoundary>
        ))}
    </QueryState>
  );
}

export function ShareDrawer({
  share,
  entity,
  onClose,
}: {
  share?: any;
  entity?: FeatureEntity & { kind?: string };
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    action = useAction(),
    entities = useWorkspaceEntities(),
    [kind, setKind] = useState(
      entity?.kind ||
        Object.keys(shareTypes).find(key => shareTypes[key] === share?.shareType) ||
        'website',
    );
  const parameters = share?.parameters || {},
    permitted = entity ? canManageResource(c.user, entity, c.teams) : true;
  return (
    <LiekanDialog
      title={i18n.system(share ? i18n.text('编辑分享链接') : i18n.text('创建分享链接'))}
      subtitle={i18n.text('设置分享资源、统计页面范围与访问保护。')}
      className="share-dialog"
      onClose={() => !action.busy && onClose()}
    >
      <QueryState query={entities}>
        <Form
          busy={action.busy}
          disabled={!permitted}
          submitLabel={i18n.system(share ? i18n.text('保存分享链接') : i18n.text('创建分享链接'))}
          cancel={
            <Button disabled={action.busy} onClick={onClose}>
              {i18n.text('取消')}
            </Button>
          }
          onSubmit={async (values: any) => {
            const id = share?.entityId || entity?.id || values.entityId;
            if (!id) throw new Error('请选择分享资源');
            const selected =
              entity || entities.data?.[kind]?.find((resource: any) => resource.id === id);
            if (selected && !canManageResource(c.user, selected, c.teams))
              throw new Error('此资源需要管理权限');
            if (values.password && new TextEncoder().encode(String(values.password)).length > 72)
              throw new Error('密码最多 72 个 UTF-8 字节');
            const body = {
              name: values.name,
              parameters: shareParameters(
                values,
                share
                  ? parameters
                  : { ...parameters, timezone: getFeaturePreferences().timezone, range: '0day' },
              ),
            };
            await action.run(
              () =>
                c.api.post(
                  share ? `/share/id/${share.id}` : '/share',
                  share
                    ? { ...body, slug: share.slug }
                    : { ...body, entityId: id, shareType: shareTypes[kind] },
                ),
              '分享链接已保存',
            );
            onClose();
          }}
        >
          <div className="share-settings-grid">
            <div className="share-settings-column">
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>{i18n.text('基本信息')}</h3>
                  <p className="muted">{i18n.text('选择要分享的资源，方便访客识别。')}</p>
                </div>
                <Field
                  label={i18n.text('分享名称')}
                  name="name"
                  defaultValue={share?.name || entity?.name || ''}
                  required
                  maxLength={200}
                />
                <Select
                  label={i18n.text('分享类型')}
                  value={kind}
                  onChange={e => setKind(e.target.value)}
                  disabled={!!share || !!entity}
                  options={Object.keys(shareTypes).map(key => [key, labels[key]])}
                  localizeLabels
                />
                {!share && !entity ? (
                  <Select
                    key={kind}
                    label={i18n.text('关联资源')}
                    name="entityId"
                    required
                    options={[
                      ['', i18n.text('请选择资源')],
                      ...(entities.data?.[kind] || [])
                        .filter((resource: any) => canManageResource(c.user, resource, c.teams))
                        .map((resource: any) => [resource.id, resource.name]),
                    ]}
                  />
                ) : (
                  <Field
                    label={i18n.text('关联资源')}
                    readOnly
                    value={
                      entity?.name ||
                      entities.data?.[kind]?.find(
                        (resource: any) => resource.id === share?.entityId,
                      )?.name ||
                      share?.entityId ||
                      ''
                    }
                  />
                )}
              </section>
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>{i18n.text('访问保护')}</h3>
                  <p className="muted">{i18n.text('按需设置密码，控制分享页面的访问。')}</p>
                </div>
                <Field
                  label={
                    parameters.hasPassword
                      ? i18n.text('修改分享密码（可选）')
                      : i18n.text('分享密码（可选）')
                  }
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  help={i18n.system(
                    parameters.hasPassword
                      ? i18n.text('留空保留当前密码。修改后访客需要重新验证。')
                      : i18n.text('设置后访客需要输入密码。'),
                  )}
                />
                {parameters.hasPassword && (
                  <Check name="removePassword">{i18n.text('取消密码保护')}</Check>
                )}
              </section>
            </div>
            <div className="share-settings-column">
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>{i18n.text('统计页面范围')}</h3>
                  <p className="muted">{i18n.text('访客只能查看已勾选的统计页面。')}</p>
                </div>
                <div className="share-page-options">
                  {shareSections.map(([key, label]) => (
                    <Check
                      key={key}
                      name={key}
                      defaultChecked={
                        typeof parameters[key] === 'boolean'
                          ? parameters[key]
                          : ['overview', 'events'].includes(key)
                      }
                    >
                      {i18n.system(label)}
                    </Check>
                  ))}
                </div>
              </section>
              <section className="share-settings-section">
                <div className="share-section-heading">
                  <h3>{i18n.text('浏览设置')}</h3>
                </div>
                <Switch
                  name="allowFilter"
                  label={i18n.text('允许访客调整筛选')}
                  help={i18n.text('访客可在分享范围内调整统计条件。')}
                  defaultChecked={parameters.allowFilter !== false}
                />
                <Select
                  label={i18n.text('主题')}
                  name="theme"
                  defaultValue="light"
                  help={i18n.text('分享页面当前使用浅色主题。')}
                  options={[
                    { value: 'light', label: '浅色' },
                    { value: 'dark', label: '深色（暂不支持）', disabled: true },
                    { value: 'system', label: '跟随系统（暂不支持）', disabled: true },
                  ]}
                  localizeLabels
                />
              </section>
            </div>
          </div>
        </Form>
      </QueryState>
    </LiekanDialog>
  );
}
export function WebsiteSharing() {
  const c = useFeature();
  return (
    <FeatureProvider
      value={{ ...c, route: { ...c.route, page: 'sharing', context: 'website', id: undefined } }}
    >
      <Sharing />
    </FeatureProvider>
  );
}
function Sharing() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    entities = useWorkspaceEntities(),
    action = useAction(),
    [edit, setEdit] = useState<any>(undefined),
    [search, setSearch] = useListState('search', ''),
    [page, setPage] = useListState('page', 1);
  const q = useData(
    ['shares', entities.data],
    async signal => {
      const resources = Object.entries(entities.data || {}).flatMap(([kind, rows]: any) =>
        rows.map((entity: any) => ({ ...entity, kind })),
      );
      const shares = await Promise.all(
        resources.map(async entity => {
          const rows = await getAllFeatureRows<any>(
            `/${entity.kind === 'website' ? 'websites' : entity.kind === 'board' ? 'boards' : entity.kind === 'link' ? 'links' : 'pixels'}/${entity.id}/shares`,
            {},
            signal,
          );
          return rows.map(share => ({ ...share, entity }));
        }),
      );
      return shares.flat();
    },
    !!entities.data,
  );
  const allEntities = Object.entries(entities.data || {}).flatMap(([kind, rows]: any) =>
    rows.map((entity: any) => ({ ...entity, kind })),
  );
  const selectedEntity =
    c.route.context === 'website' ? c.site : allEntities.find(entity => entity.id === c.route.id);
  const creatable = selectedEntity
    ? canManageResource(c.user, selectedEntity, c.teams)
    : allEntities.some(entity => canManageResource(c.user, entity, c.teams));
  const filtered = (q.data || []).filter(
      (share: any) =>
        (!c.route.id || share.entity?.id === c.route.id) &&
        (!search ||
          `${share.name} ${share.entity?.name}`.toLowerCase().includes(search.toLowerCase())),
    ),
    rows = filtered.slice((page - 1) * 20, page * 20);
  return (
    <>
      <Panel
        title={i18n.system(
          c.route.context === 'website' ? i18n.text('当前网站的分享链接') : i18n.text('分享链接'),
        )}
        subtitle={i18n.system(
          c.route.context === 'website'
            ? i18n.text('{v0} · 仅管理此网站的分享链接。', [c.site?.name || i18n.text('当前网站')])
            : i18n.text('网站、看板、链接和像素的分享范围与访问保护。'),
        )}
        actions={
          <>
            <Search
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
            />
            <Button primary disabled={!creatable} onClick={() => setEdit(null)}>
              <Icon name="plus" />
              {i18n.fragment('创建分享链接', true, false)}
            </Button>
          </>
        }
      >
        <QueryState query={entities}>
          <QueryState query={q}>
            <Table
              mobile
              rowKeys={rows.map((share: any) => share.id)}
              columns={['名称', '资源类型', '页面范围', '筛选权限', '状态', '操作', '分享链接']}
              rows={rows.map((share: any) => [
                <TableCell
                  sortValue={[
                    share.name,
                    [
                      share.entity.name,
                      ' \u00B7',
                      ' ',
                      share.entity.teamId
                        ? c.teams.find(team => team.id === share.entity.teamId)?.name ||
                          i18n.source('团队空间')
                        : i18n.source('个人空间'),
                    ],
                  ]}
                  searchValue={[
                    share.name,
                    [
                      share.entity.name,
                      ' \u00B7',
                      ' ',
                      share.entity.teamId
                        ? c.teams.find(team => team.id === share.entity.teamId)?.name ||
                          i18n.english.text('团队空间')
                        : i18n.english.text('个人空间'),
                    ],
                  ]}
                >
                  <div key="share-name">
                    {share.name}
                    <div className="muted">
                      {share.entity.name} ·{' '}
                      {share.entity.teamId
                        ? c.teams.find(team => team.id === share.entity.teamId)?.name ||
                          i18n.text('团队空间')
                        : i18n.text('个人空间')}
                    </div>
                  </div>
                </TableCell>,
                <TableCell
                  sortValue={labels[share.entity.kind]}
                  searchValue={i18n.english.system(labels[share.entity.kind])}
                >
                  {i18n.system(labels[share.entity.kind])}
                </TableCell>,
                <TableCell
                  sortValue={
                    allowedShareSections(share.parameters)
                      .map(([, label]) => label)
                      .join('、') || i18n.source('无统计页面')
                  }
                  searchValue={
                    allowedShareSections(share.parameters)
                      .map(([, label]) => i18n.english.system(label))
                      .join('、') || i18n.english.text('无统计页面')
                  }
                >
                  {allowedShareSections(share.parameters)
                    .map(([, label]) => i18n.system(label))
                    .join('、') || i18n.text('无统计页面')}
                </TableCell>,
                <TableCell
                  sortValue={
                    share.parameters?.allowFilter === false
                      ? i18n.source('禁止')
                      : i18n.source('允许')
                  }
                  searchValue={
                    share.parameters?.allowFilter === false
                      ? i18n.english.text('禁止')
                      : i18n.english.text('允许')
                  }
                >
                  {share.parameters?.allowFilter === false ? i18n.text('禁止') : i18n.text('允许')}
                </TableCell>,
                <TableCell
                  sortValue={
                    share.parameters?.enabled === false ? i18n.source('停用') : i18n.source('启用')
                  }
                  searchValue={i18n.english.system(
                    share.parameters?.enabled === false
                      ? i18n.english.text('停用')
                      : i18n.english.text('启用'),
                  )}
                >
                  <Badge
                    key="cell-badge-21"
                    tone={share.parameters?.enabled === false ? 'gray' : 'green'}
                  >
                    {share.parameters?.enabled === false ? i18n.text('停用') : i18n.text('启用')}
                  </Badge>
                </TableCell>,
                <TableCell
                  sortValue={[
                    i18n.source('预览'),
                    i18n.source('编辑'),
                    share.parameters?.enabled === false ? i18n.source('启用') : i18n.source('停用'),
                  ]}
                  searchValue={[
                    i18n.english.text('预览'),
                    i18n.english.text('编辑'),
                    share.parameters?.enabled === false
                      ? i18n.english.text('启用')
                      : i18n.english.text('停用'),
                  ]}
                >
                  <div key="cell-div-22" className="actions">
                    <LinkButton page="share-preview" params={{ id: share.id, slug: share.slug }}>
                      {i18n.text('预览')}
                    </LinkButton>
                    <Button
                      disabled={action.busy || !canManageResource(c.user, share.entity, c.teams)}
                      onClick={() => setEdit(share)}
                    >
                      {i18n.text('编辑')}
                    </Button>
                    <Button
                      disabled={action.busy || !canManageResource(c.user, share.entity, c.teams)}
                      onClick={() =>
                        action.run(
                          () =>
                            c.api.post(`/share/id/${share.id}`, {
                              name: share.name,
                              slug: share.slug,
                              parameters: {
                                ...share.parameters,
                                enabled: share.parameters?.enabled === false,
                              },
                            }),
                          '分享状态已更新',
                        )
                      }
                    >
                      {share.parameters?.enabled === false ? i18n.text('启用') : i18n.text('停用')}
                    </Button>
                  </div>
                </TableCell>,
                <TableCell
                  sortValue={
                    share.slug ? [i18n.source('访问分享链接'), ''] : i18n.source('链接未生成')
                  }
                  searchValue={
                    share.slug
                      ? [i18n.english.fragment('访问分享链接', false, true), '']
                      : i18n.english.text('链接未生成')
                  }
                >
                  {share.slug ? (
                    <a
                      key="share-visit"
                      className="btn share-visit"
                      href={`${process.env.basePath || ''}/share/${encodeURIComponent(share.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={i18n.text('访问分享链接：{v0}（新标签页）', [share.name])}
                    >
                      {i18n.fragment('访问分享链接', false, true)}
                      <Icon name="external" />
                    </a>
                  ) : (
                    <span key="share-unavailable" className="muted">
                      {i18n.text('链接未生成')}
                    </span>
                  )}
                </TableCell>,
              ])}
              page={page}
              pages={Math.max(1, Math.ceil(filtered.length / 20))}
              onPage={setPage}
            />
          </QueryState>
        </QueryState>
      </Panel>
      <Notice>{i18n.text('公开视角只显示分享配置允许的统计页面。')}</Notice>
      {edit !== undefined && (
        <ShareDrawer
          share={edit || undefined}
          entity={edit?.entity || selectedEntity}
          onClose={() => setEdit(undefined)}
        />
      )}
    </>
  );
}

async function allSharedRows(
  request: (path: string, params?: any, signal?: AbortSignal) => Promise<any>,
  path: string,
  signal?: AbortSignal,
) {
  const rows: any[] = [];
  for (let page = 1; page <= 1000; page++) {
    const data = await request(path, { page, pageSize: 100 }, signal);
    if (Array.isArray(data)) return data;
    const next = rowsOf<any>(data);
    rows.push(...next);
    if (
      !next.length ||
      rows.length >= Number(data?.count ?? Infinity) ||
      (!data?.count && next.length < 100)
    )
      return rows;
  }
  throw new Error('配置数量超过可加载范围，请缩小范围');
}
function PublicStats({
  share,
  active,
  range,
  filters,
  dateControls,
  onExpired,
}: {
  share: any;
  active: string;
  range: any;
  filters: any;
  dateControls?: ReactNode;
  onExpired: () => void;
}) {
  const i18n = useLiekanI18n();
  const id =
      share.websiteId ||
      share.linkId ||
      share.pixelId ||
      share.websiteIds?.[0] ||
      share.linkIds?.[0] ||
      share.pixelIds?.[0],
    kind = share.linkId ? 'link' : share.pixelId ? 'pixel' : 'website';
  const request = Object.assign(
    (path: string, params: any, signal?: AbortSignal) =>
      featureRequest('GET', path, params, signal, share.token, '').catch(error => {
        if ([401, 403, 404].includes(error.status)) onExpired();
        throw error;
      }),
    { shareToken: share.token, shareCacheKey: share.cacheKey },
  );
  const safeBoard = (board: any) => {
    const parameters: WorkspaceParameters = board.parameters || {},
      fixed = boardEntity(parameters, board.type);
    const allowedIds = new Set(
      [
        share.websiteId,
        share.linkId,
        share.pixelId,
        ...(share.websiteIds || []),
        ...(share.linkIds || []),
        ...(share.pixelIds || []),
      ].filter(Boolean),
    );
    const componentSection = (component: any) =>
      ['EventsChart', 'EventsMetricsBar'].includes(component?.type)
        ? 'events'
        : component?.type === 'Goal'
          ? 'goals'
          : component?.type === 'Funnel'
            ? 'funnels'
            : component?.type === 'UTM'
              ? 'utm'
              : 'overview';
    if (fixed.entityId && !allowedIds.has(fixed.entityId))
      return { ...board, parameters: { ...boardParameters(parameters, 'mixed'), rows: [] } };
    return {
      ...board,
      parameters: {
        ...parameters,
        rows: (parameters.rows || [])
          .map(row => ({
            ...row,
            columns: row.columns.filter(column => {
              const component = column.component,
                entityId = fixed.entityId || component?.entityId || component?.websiteId;
              return (
                hasShareSection(share.parameters, componentSection(component)) &&
                (!entityId || allowedIds.has(entityId))
              );
            }),
          }))
          .filter(row => row.columns.length),
      },
    };
  };
  const q = useFreshQuery(
    {
      queryKey: ['liekan-public', share.cacheKey, active, id, range, filters],
      queryFn: async ({ signal }) => {
        if (active === 'events')
          return request(
            `/websites/${id}/events/series`,
            { ...range, ...filters, limit: 100 },
            signal,
          );
        if (active === 'utm')
          return request(
            `/websites/${id}/utm/metrics`,
            { ...range, ...filters, type: 'utm_source' },
            signal,
          );
        if (active === 'goals') {
          const [goals, funnels] = await Promise.all([
            hasShareSection(share.parameters, 'goals')
              ? allSharedRows(request, `/websites/${id}/goals`, signal)
              : null,
            hasShareSection(share.parameters, 'funnels')
              ? allSharedRows(request, `/websites/${id}/funnels`, signal)
              : null,
          ]);
          const results = await Promise.all([
            ...rowsOf<any>(goals).map(async row => ({
              kind: '目标',
              ...row,
              stats: await request(
                `/websites/${id}/goals/${row.id}/stats`,
                { ...range, ...filters },
                signal,
              ),
            })),
            ...rowsOf<any>(funnels).map(async row => ({
              kind: '漏斗',
              ...row,
              stats: await request(
                `/websites/${id}/funnels/${row.id}/stats`,
                { ...range, ...filters },
                signal,
              ),
            })),
          ]);
          return { results, configurationOnly: results.length === 0 };
        }
        if (share.boardId) return request(`/boards/${share.boardId}`, undefined, signal);
        return null;
      },
      enabled: (!!id && active !== 'overview') || (active === 'overview' && !!share.boardId),
      retry: false,
      gcTime: 600000,
    },
    {
      aggregate: data => active !== 'overview' && !data?.configurationOnly,
      endAt: range.endAt,
      timezone: range.timezone,
    },
  );
  if (!id && !share.boardId) return <Notice>{i18n.text('分享资源尚未提供统计数据。')}</Notice>;
  if (active === 'overview' && share.websiteId && !share.boardId && !share.linkId && !share.pixelId)
    return (
      <SharedWebsiteOverview
        id={id}
        token={share.token}
        cacheKey={share.cacheKey}
        range={range}
        request={request}
        dateControls={dateControls}
      />
    );
  if (active === 'overview' && !share.boardId)
    return (
      <ResourceAnalytics
        id={id}
        kind={kind}
        variant="public"
        allowGoals={hasShareSection(share.parameters, 'goals')}
        request={request}
        range={range}
        filters={filters}
      />
    );
  return (
    <QueryState query={q}>
      {active === 'overview' ? (
        q.data && (
          <ManualReadDependencyBoundary ready={q.isSuccess && !q.isPlaceholderData}>
            <BoardCanvas
              key={share.boardId}
              board={{
                ...safeBoard(q.data),
                _shareGoalsAllowed: hasShareSection(share.parameters, 'goals'),
              }}
              request={request}
              range={{ ...range, ...filters }}
            />
          </ManualReadDependencyBoundary>
        )
      ) : active === 'goals' ? (
        <>
          <Chart
            interactionKey={JSON.stringify([
              'public',
              share.cacheKey,
              active,
              id,
              kind,
              range,
              filters,
              q.data,
            ])}
            title={i18n.text('目标转化')}
            labels={(q.data?.results?.find((r: any) => r.kind === '目标')?.stats?.series || []).map(
              (r: any) => r.x,
            )}
            series={[
              {
                name: i18n.text('转化次数'),
                values: (
                  q.data?.results?.find((r: any) => r.kind === '目标')?.stats?.series || []
                ).map((r: any) => Number(r.y)),
              },
            ]}
          />
          <Panel
            title={i18n.text('目标与漏斗')}
            subtitle={i18n.text('分享允许的已保存配置与转化访客。')}
          >
            <Table
              columns={['类型', '名称', '转化访客', '转化率']}
              numeric={[2, 3]}
              rows={(q.data?.results || []).map(row => {
                const first =
                    row.kind === '目标'
                      ? nativeMetric(row.stats?.total)
                      : nativeMetric(row.stats?.[0]?.visitors),
                  last =
                    row.kind === '目标'
                      ? nativeMetric(row.stats?.num)
                      : nativeMetric(row.stats?.at(-1)?.visitors);
                return [
                  <TableCell sortValue={row.kind} searchValue={i18n.english.system(row.kind)}>
                    {i18n.system(row.kind)}
                  </TableCell>,
                  row.name,
                  <TableCell
                    sortValue={readable(last, canonicalText => canonicalText)}
                    searchValue={readable(last, i18n.english.system)}
                  >
                    {readable(last, i18n.system)}
                  </TableCell>,
                  <TableCell
                    sortValue={
                      first != null && last != null && first > 0
                        ? `${((last / first) * 100).toFixed(2)}%`
                        : first === 0
                          ? i18n.source('无入组访客')
                          : i18n.source('未提供')
                    }
                    searchValue={
                      first != null && last != null && first > 0
                        ? `${((last / first) * 100).toFixed(2)}%`
                        : first === 0
                          ? i18n.english.text('无入组访客')
                          : i18n.english.text('未提供')
                    }
                  >
                    {first != null && last != null && first > 0
                      ? `${((last / first) * 100).toFixed(2)}%`
                      : first === 0
                        ? i18n.text('无入组访客')
                        : i18n.text('未提供')}
                  </TableCell>,
                ];
              })}
            />
          </Panel>
        </>
      ) : active === 'events' ? (
        <Chart
          interactionKey={JSON.stringify([
            'public',
            share.cacheKey,
            active,
            id,
            kind,
            range,
            filters,
            q.data,
          ])}
          title={i18n.text('事件趋势')}
          type="line"
          {...eventChartData(rowsOf<any>(q.data))}
        />
      ) : (
        <Chart
          interactionKey={JSON.stringify([
            'public',
            share.cacheKey,
            active,
            id,
            kind,
            range,
            filters,
            q.data,
          ])}
          title={i18n.text('UTM 来源')}
          type="bar"
          horizontal
          labels={rowsOf<any>(q.data).map(row => row.utm || i18n.text('未提供'))}
          series={[
            {
              name: i18n.text('页面访问'),
              values: rowsOf<any>(q.data).map(row => nativeMetric(row.views)),
            },
          ]}
        />
      )}
    </QueryState>
  );
}
export function ShareFeatureView({
  slug,
  initialPage = 'overview',
}: {
  slug: string;
  initialPage?: string;
}) {
  const i18n = useLiekanI18n();
  const client = useQueryClient();
  const verification = useRef<{
    slug: string;
    controller?: AbortController;
    generation: number;
    token?: string;
    cacheKey?: string;
  }>({ slug, generation: 0 });
  if (verification.current.slug !== slug) {
    verification.current.slug = slug;
    verification.current.token = undefined;
    verification.current.generation++;
  }
  const [verified, setVerified] = useState<any>(null),
    [passwordError, setPasswordError] = useState(''),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(initialPage),
    [filters, setFilters] = useState<any>({});
  const [authorization, setAuthorization] = useState<{
    slug: string;
    data: any;
    deadline: number;
  }>();
  const [calendarParameters, setCalendarParameters] = useState<{ slug: string; parameters: any }>();
  const parameters = calendarParameters?.slug === slug ? calendarParameters.parameters : {};
  const timezone = sharedTimezone(parameters);
  const search = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const dateParameter = search?.get('date') || search?.get('range') || undefined;
  const calendarKey = hashKey([
    timezone,
    dateParameter,
    parameters.range,
    parameters.date,
    parameters.startAt,
    parameters.endAt,
    parameters.unit,
  ]);
  const [selection, setSelection] = useState<{
    slug: string;
    calendarKey: string;
    presetDays: number | null;
    range: SharedDateRange;
  }>();
  const selectedRange =
    selection?.slug === slug && selection.calendarKey === calendarKey ? selection : undefined;
  const reading = useManualRefresh();
  const storedDate = dateParameter || parameters.range || parameters.date;
  const fixedRange = typeof storedDate === 'object' ||
    (typeof storedDate === 'string' && storedDate.startsWith('range:')) ||
    (parameters.startAt != null && parameters.endAt != null);
  const enteredAt = useDateRangeClock(
    timezone, selectedRange ? selectedRange.presetDays != null : !fixedRange,
  );
  const [selectedAt, setSelectedAt] = useState<{ epoch: string; now: number }>(null);
  const rangeEpoch = `${reading?.page.token}:${reading?.page.round}`;
  const rangeNow = selectedAt?.epoch === rangeEpoch ? Math.max(selectedAt.now, enteredAt) : enteredAt;
  const initialRange = resolveSharedDateRange(parameters, rangeNow, dateParameter);
  const presetDays = selectedRange
    ? selectedRange.presetDays
    : initialRange.chartPeriod === 'today'
      ? 0
      : initialRange.chartPeriod === '24h'
        ? 1
        : initialRange.chartPeriod === '30d'
          ? 30
          : null;
  const range = selectedRange
    ? presetDays != null
      ? sharedDateRange(presetDays, rangeNow, timezone)
      : selectedRange.range
    : initialRange;
  const chooseRange = (range: SharedDateRange, presetDays: number | null) =>
    setSelection({ slug, calendarKey, range, presetDays });
  const retryAt = useRef(0);
  const clearPublicQueries = () =>
    client.removeQueries({
      predicate: query =>
        (['liekan-public', 'liekan-shared-report'].includes(String(query.queryKey[0])) &&
          query.queryKey[1] === verification.current.cacheKey) ||
        (query.queryKey[0] === 'liekan-feature' &&
          ['board-widget', 'resource-analytics'].includes(String(query.queryKey[1])) &&
          query.queryKey[2] === verification.current.cacheKey),
    });
  const [scopeChangedAt, setScopeChangedAt] = useState<string>(null);
  const previousScope = useRef('');
  const scopeSlug = useRef(slug);
  if (scopeSlug.current !== slug) {
    previousScope.current = '';
    scopeSlug.current = slug;
  }
  const acceptAuthorization = (data: any) => {
    if (data.token) setCalendarParameters({ slug, parameters: data.parameters || {} });
    const parameters = Object.fromEntries(
      Object.entries(data.parameters || {}).filter(
        ([key]) => !['theme', 'hasPassword'].includes(key),
      ),
    );
    const scope = hashKey([
      data.shareId,
      data.shareType,
      data.websiteId,
      data.linkId,
      data.pixelId,
      data.boardId,
      data.boardLayoutHash,
      [...(data.websiteIds || [])].sort(),
      [...(data.linkIds || [])].sort(),
      [...(data.pixelIds || [])].sort(),
      parameters,
    ]);
    const cacheKey = hashKey([slug, scope]);
    if (data.token && previousScope.current && previousScope.current !== cacheKey) {
      clearPublicQueries();
      setScopeChangedAt(`${reading?.page.token}:${reading?.page.round}`);
    }
    previousScope.current = data.token ? cacheKey : '';
    verification.current.cacheKey = cacheKey;
    verification.current.token = data.token;
    setAuthorization({
      slug,
      data: { ...data, cacheKey },
      deadline: data.token ? monotonicNow() + 30000 : Infinity,
    });
  };
  const q = useQuery({
    queryKey: ['liekan-public-share', slug],
    meta: { readPurpose: 'authorization' },
    queryFn: async ({ signal }) => {
      const generation = verification.current.generation;
      try {
        const data = await featureRequest(
          'GET',
          `/share/${encodeURIComponent(slug)}`,
          undefined,
          signal,
          verification.current.token,
          '',
        );
        if (
          !signal.aborted &&
          verification.current.slug === slug &&
          verification.current.generation === generation &&
          document.visibilityState !== 'hidden'
        ) {
          retryAt.current = 0;
          acceptAuthorization(data);
          if (data.requiresPassword) setVerified(null);
          else if (verification.current.token) setVerified(data);
        }
        return data;
      } catch (error: any) {
        if (
          !signal.aborted &&
          verification.current.slug === slug &&
          verification.current.generation === generation
        ) {
          retryAt.current = monotonicNow() + Math.max(30000, Number(error.retryAfterMs) || 0);
          if ([401, 403, 404].includes(error.status)) {
            clearPublicQueries();
            verification.current.token = undefined;
            setVerified(null);
            setAuthorization(undefined);
          }
        }
        throw error;
      }
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchInterval: query =>
      typeof document === 'undefined' || document.visibilityState === 'hidden'
        ? false
        : Math.max(30000, Number((query.state.error as any)?.retryAfterMs) || 0),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    verification.current.controller?.abort();
    verification.current.token = undefined;
    setBusy(false);
    setVerified(null);
    setAuthorization(current => (current?.slug === slug ? current : undefined));
    setPasswordError('');
    setFilters({});
    setActive(initialPage);
    return () => {
      clearPublicQueries();
    };
  }, [slug, initialPage]);
  useEffect(() => () => verification.current.controller?.abort(), []);
  useEffect(() => {
    if (!authorization?.data?.token) return;
    const timer = setTimeout(
      () => setAuthorization(current => (current === authorization ? undefined : current)),
      Math.max(0, authorization.deadline - monotonicNow()),
    );
    return () => clearTimeout(timer);
  }, [authorization]);
  useEffect(() => {
    const resume = async () => {
      verification.current.generation++;
      setAuthorization(undefined);
      await client.cancelQueries({ queryKey: ['liekan-public-share', slug], exact: true });
      if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
      if (monotonicNow() < retryAt.current) return;
      void qRef.current.refetch({ cancelRefetch: false });
    };
    const focus = () => {
      if (document.visibilityState !== 'hidden') void resume();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
    };
  }, [slug, client]);
  const authorizedShare =
    authorization?.slug === slug && authorization.deadline > monotonicNow()
      ? authorization.data
      : undefined;
  const retainedShare = useRef<{ slug: string; data: any }>(null);
  if (authorizedShare) retainedShare.current = { slug, data: authorizedShare };
  if ([401, 403, 404].includes((q.error as any)?.status)) retainedShare.current = null;
  const share = retainedShare.current?.slug === slug ? retainedShare.current.data : undefined;
  const allowed = allowedShareSections(share?.parameters),
    selected = allowed.some(([id]) => id === active) ? active : allowed[0]?.[0];
  const authorizationError =
    q.error ||
    (!authorizedShare && navigator.onLine === false
      ? new Error('分享授权已过期，请恢复连接后重试。')
      : null);
  const authorizedQuery = {
    ...q,
    data: authorizedShare,
    error: authorizationError,
    isPending: !authorizedShare && !authorizationError,
  };
  const websiteOverview =
    selected === 'overview' &&
    !!share?.websiteId &&
    !share.boardId &&
    !share.linkId &&
    !share.pixelId;
  const dateControls = authorizedShare?.token && share.parameters?.allowFilter !== false && (
    <div className={sharedStyles.filters}>
      <div className="actions" aria-label={i18n.text('快捷日期范围')}>
        {(
          [
            [i18n.text('30 天'), 30],
            [i18n.text('7 天'), 7],
            [i18n.text('今天'), 0],
          ] as const
        ).map(([label, days]) => (
          <Button
            key={label}
            primary={presetDays === days}
            aria-pressed={presetDays === days}
            onClick={() => {
              const now = Date.now();
              setSelectedAt({ epoch: rangeEpoch, now });
              chooseRange(sharedDateRange(days, now, timezone), days);
            }}
          >
            {i18n.system(label)}
          </Button>
        ))}
      </div>
      <Field
        label={i18n.text('开始日期')}
        type="date"
        value={formatInTimeZone(range.startAt, range.timezone, 'yyyy-MM-dd')}
        onChange={e => {
          const time = +fromZonedTime(`${e.target.value}T00:00:00`, range.timezone);
          if (Number.isFinite(time)) {
            chooseRange({ ...range, startAt: time, chartPeriod: undefined }, null);
          }
        }}
      />
      <Field
        label={i18n.text('结束日期')}
        type="date"
        value={formatInTimeZone(range.endAt, range.timezone, 'yyyy-MM-dd')}
        onChange={e => {
          const time = +fromZonedTime(`${e.target.value}T23:59:59.999`, range.timezone);
          if (Number.isFinite(time)) {
            chooseRange({ ...range, endAt: time, chartPeriod: undefined }, null);
          }
        }}
      />
      {!websiteOverview && (
        <Field
          label={i18n.text('页面路径')}
          placeholder={i18n.text('输入路径筛选')}
          value={filters.path?.slice(3) || ''}
          onChange={e => setFilters(e.target.value ? { path: `eq.${e.target.value}` } : {})}
        />
      )}
    </div>
  );
  const closed = q.error && (q.error as any).status === 404;
  return (
    <main className="public-shell" id="main-content" data-share-theme="light">
      <header className="public-head">
        <div className="public-brand">
          <img src={`${process.env.basePath || ''}/liekan/features/logo.svg`} alt="" />
          <div>
            <strong>{liekanProduct.title}</strong>
            <small style={{ display: 'block' }}>
              {authorizedShare?.name || i18n.text('公开分享')}
              {i18n.fragment(' · 只读分享', true, false)}
            </small>
          </div>
        </div>
        <ManualRefreshControl beforeRefresh={() => q.refetch({ throwOnError: true })} />
        <Badge>{i18n.text('公开 · 只读')}</Badge>
      </header>
      <div className="public-body">
        {share?.parameters?.theme && share.parameters.theme !== 'light' && (
          <Notice tone="amber">
            {share.parameters.hasPassword
              ? i18n.text('此密码保护分享当前使用浅色界面。')
              : i18n.text('此分享原有主题需要兼容界面查看。当前预览使用浅色。')}
            {!share.parameters.hasPassword && (
              <a
                className="btn"
                href={`${process.env.basePath || ''}/share/${encodeURIComponent(slug)}?legacy=1`}
              >
                {i18n.text('打开兼容界面')}
              </a>
            )}
          </Notice>
        )}
        {closed ? (
          <div className="state-box">
            <h2>{i18n.text('分享已关闭')}</h2>
            <p>{i18n.text('此链接目前无法查看数据，请联系分享创建者。')}</p>
          </div>
        ) : (
          <QueryState
            query={{
              ...authorizedQuery,
              data: share,
              isPending: !share && !q.error,
              error:
                !share || [401, 403, 404].includes((q.error as any)?.status) ? q.error : undefined,
            }}
          >
            {(!authorizedQuery.data ||
              scopeChangedAt === `${reading?.page.token}:${reading?.page.round}`) && (
              <Notice>
                {i18n.fragment('正在核验分享权限，范围变更后请点击刷新读取。', false, true)}
                {q.error && i18n.text('权限暂时无法核验，请主动重试。')}
              </Notice>
            )}
            <ManualAuthorizationBoundary
              authorized={
                !!authorizedQuery.data &&
                scopeChangedAt !== `${reading?.page.token}:${reading?.page.round}`
              }
            >
              <div
                hidden={
                  !authorizedQuery.data ||
                  scopeChangedAt === `${reading?.page.token}:${reading?.page.round}`
                }
              >
                {share?.requiresPassword && !verified ? (
                  <Panel
                    title={i18n.text('输入分享密码')}
                    subtitle={i18n.text('验证后查看允许的统计页面。')}
                  >
                    <Body>
                      <Form
                        busy={busy}
                        error={passwordError}
                        submitLabel={i18n.text('验证并查看')}
                        onSubmit={async (values: any, form: HTMLFormElement) => {
                          const currentSlug = slug;
                          const controller = new AbortController();
                          verification.current.controller?.abort();
                          verification.current.controller = controller;
                          setBusy(true);
                          setPasswordError('');
                          try {
                            const result = await featureRequest(
                              'POST',
                              `/share/${encodeURIComponent(slug)}`,
                              { password: values.password },
                              controller.signal,
                              undefined,
                              '',
                            );
                            if (
                              controller.signal.aborted ||
                              verification.current.slug !== currentSlug
                            )
                              return;
                            setVerified(result);
                            acceptAuthorization(result);
                            form.reset();
                          } catch (e: any) {
                            if (
                              controller.signal.aborted ||
                              verification.current.slug !== currentSlug
                            )
                              return;
                            setPasswordError(e.message);
                            throw e;
                          } finally {
                            if (
                              !controller.signal.aborted &&
                              verification.current.slug === currentSlug
                            )
                              setBusy(false);
                          }
                        }}
                      >
                        <Field
                          label={i18n.text('分享密码')}
                          name="password"
                          type="password"
                          required
                          autoComplete="current-password"
                        />
                      </Form>
                    </Body>
                  </Panel>
                ) : share?.token ? (
                  <>
                    {allowed.length > 1 && (
                      <Tabs
                        items={allowed.map(([id, label]) => [id, i18n.system(label)])}
                        active={selected || ''}
                        onChange={section => {
                          if (section === selected) return;
                          setActive(section);
                          void reading?.refresh(undefined, false).catch(() => {});
                        }}
                      />
                    )}
                    {!websiteOverview && dateControls}
                    {selected ? (
                      <PublicStats
                        key={share.cacheKey}
                        share={share}
                        active={selected}
                        range={range}
                        filters={share.parameters?.allowFilter === false ? {} : filters}
                        dateControls={dateControls}
                        onExpired={() => {
                          setVerified(null);
                          clearPublicQueries();
                          verification.current.token = undefined;
                          setAuthorization(undefined);
                          void q.refetch();
                        }}
                      />
                    ) : (
                      <Notice>{i18n.text('此分享未开放统计页面。')}</Notice>
                    )}
                    <Button
                      onClick={async () => {
                        setVerified(null);
                        setAuthorization(undefined);
                        await q.refetch();
                      }}
                    >
                      {i18n.text('重新验证分享')}
                    </Button>
                  </>
                ) : (
                  <Notice>{i18n.text('分享数据未提供。')}</Notice>
                )}
              </div>
            </ManualAuthorizationBoundary>
          </QueryState>
        )}
      </div>
      <footer className="public-footer">
        <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">
          IP Geolocation by DB-IP
        </a>
        <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">
          {i18n.text('地名数据：GeoNames（已整理）')}
        </a>
      </footer>
    </main>
  );
}
function SharePreview() {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    q = useData(
      ['share-preview-record', c.route.id],
      signal => c.api.get(`/share/id/${c.route.id}`, undefined, signal),
      !!c.route.id,
    );
  const slug = c.query.slug || q.data?.slug;
  return slug ? (
    <ShareFeatureView slug={slug} />
  ) : (
    <QueryState query={q}>
      <Notice>
        {i18n.fragment('请选择一个分享。', false, true)}
        <LinkButton page="sharing">{i18n.text('分享管理')}</LinkButton>
      </Notice>
    </QueryState>
  );
}

export function WorkspacePages({ page }: { page: string }) {
  if (page === 'teams' || page === 'admin-teams') return <Teams admin={page === 'admin-teams'} />;
  if (page === 'team-detail') return <TeamDetail />;
  if (page === 'team-join') return <TeamJoin />;
  if (page === 'admin-users') return <AdminUsers />;
  if (page === 'admin-user') return <AdminUser />;
  if (page === 'admin-websites') return <AdminWebsites />;
  if (page === 'admin-security') return <AdminSecurity />;
  if (page === 'boards') return <Boards />;
  if (page.startsWith('board-')) return <BoardPage page={page} />;
  if (page === 'sharing') return <Sharing />;
  if (page === 'share-preview') return <SharePreview />;
  return null;
}
