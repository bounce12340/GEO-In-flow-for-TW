import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBoardEntityIds } from '@/lib/boards';
import {
  allowedShareSections,
  boardColumns,
  boardParameters,
  canManageMember,
  canManageResource,
  moveBoardColumn,
  nativeMetric,
  setBoardColumnWidth,
  shareParameters,
} from '@/lib/liekan/contracts/workspace';
import { FeatureProvider } from './context';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { ManualRefreshControl } from '../ManualRefreshControl';
import { freshAggregateFixture } from '@/test/liekan-freshness';
import { clientRequestOptions } from '@/lib/liekan/upstream/client-freshness';
import { ResourceAnalytics, ShareFeatureView, WorkspacePages } from './WorkspacePages';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { setTestUrl } from '@/test/navigation';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  request: vi.fn(),
  all: vi.fn(),
  navigate: vi.fn(),
  notify: vi.fn(),
  refresh: vi.fn(),
  preferences: vi.fn(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./Chart', () => ({
  Chart: ({ title, labels, series, type, horizontal }: any) => {
    const chart = (
      <div role="img" aria-label={title || '统计图表'}>
        {JSON.stringify({ labels, series, type, horizontal })}
      </div>
    );
    return title ? (
      <section className="panel">
        <h2>{title}</h2>
        {chart}
      </section>
    ) : (
      chart
    );
  },
}));
vi.mock('../ReportComponents', async importOriginal => ({
  ...(await importOriginal<typeof import('../ReportComponents')>()),
  ReferenceChart: ({ id }: any) => <div role="img" aria-label={`分享图表 ${id}`} />,
}));
vi.mock('@/lib/liekan/upstream/features-client', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/liekan/upstream/features-client')>();
  const { freshAggregateFixture } = await import('@/test/liekan-freshness');
  return {
    ...original,
    featureRequest: async (...args: Parameters<typeof original.featureRequest>) => {
      const value = await mocks.request(...args);
      return original.isAggregateRequest(args[1], args[2])
        ? freshAggregateFixture(value, args[3])
        : value;
    },
    getAllFeatureRows: mocks.all,
    getFeaturePreferences: mocks.preferences,
  };
});

const owner = { id: 'user-1', username: 'owner', role: 'user' };
const team = {
  id: 'team-1',
  name: '增长团队',
  members: [
    { userId: 'user-1', role: 'team-owner' },
    { userId: 'user-2', role: 'team-manager' },
  ],
  _count: { websites: 2, members: 2 },
};
const site = { id: 'site-1', name: '产品网站', domain: 'example.com', userId: 'user-1' };
const nativeBoard = {
  id: 'board-1',
  name: '观察看板',
  type: 'website',
  userId: 'user-1',
  parameters: {
    websiteId: 'site-1',
    extension: { retain: true },
    rows: [
      {
        id: 'row-1',
        size: 360,
        extension: 'row',
        columns: [
          {
            id: 'column-1',
            size: 50,
            extension: 'one',
            component: { type: 'WebsiteChart', title: '访问趋势', props: { retain: 'one' } },
          },
          {
            id: 'column-2',
            size: 50,
            extension: 'two',
            component: { type: 'MetricsTable', title: '来源构成', props: { type: 'referrer' } },
          },
        ],
      },
    ],
  },
};
let context: any;
function expectHiddenText(text: string | RegExp) {
  const element = screen.queryByText(text);
  expect(!element || !!element.closest('[hidden]')).toBe(true);
}
it('stores a canonical team notification when language changes during completion', async () => {
  const user = userEvent.setup();
  context.route = { page: 'team-detail', teamId: 'team-1' };
  let finish: (value: unknown) => void;
  mocks.del.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = mount(<WorkspacePages page="team-detail" />, true, 'en-US');
  await user.click(await screen.findByRole('tab', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: 'Delete team' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Delete team' }));
  await user.type(dialog.getByRole('textbox'), 'DELETE');
  await user.click(dialog.getByRole('button', { name: 'Delete team' }));
  await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
  view.changeLanguage('zh-CN');
  await act(async () => finish({}));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('「增长团队」已删除'));
});

it('preserves canonical role sorting when the interface language changes', async () => {
  context.user = { ...owner, isAdmin: true };
  context.query = { sort: '系统角色', direction: 'asc' };
  const users = [
    { id: 'ordinary', username: 'Ordinary', role: 'user' },
    { id: 'readonly', username: 'Readonly', role: 'view-only' },
  ];
  mocks.get.mockImplementation(async (path: string) =>
    path === '/admin/users' ? { data: users, count: 2 } : { isEnabled: false },
  );
  const view = mount(<WorkspacePages page="admin-users" />);
  await screen.findByText('Ordinary');
  const order = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map(
        row =>
          within(row)
            .getAllByRole('cell')[0]
            .textContent.match(/^(Ordinary|Readonly)/)?.[0],
      );
  expect(order()).toEqual(['Ordinary', 'Readonly']);
  view.changeLanguage('en-US');
  expect(order()).toEqual(['Ordinary', 'Readonly']);
  expect(context.query.sort).toBe('系统角色');
});

it('keeps team and website owner roles tied when sorting the actual administrator resource table', async () => {
  context.user = { ...owner, isAdmin: true };
  context.route = { page: 'admin-user', id: 'target' };
  context.query = { sort: '角色', direction: 'desc' };
  mocks.get.mockImplementation(async (path: string) =>
    path === '/users/target'
      ? { id: 'target', username: 'Target', role: 'user' }
      : { isEnabled: false },
  );
  mocks.all.mockImplementation(async (path: string) =>
    path.endsWith('/teams')
      ? [{ id: 'team', name: 'TeamResource', members: [{ userId: 'target', role: 'team-owner' }] }]
      : [{ id: 'site', name: 'SiteResource', userId: 'target' }],
  );
  const view = mount(<WorkspacePages page="admin-user" />);
  await screen.findByText('TeamResource');
  const order = () =>
    within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .map(
        row =>
          within(row)
            .getAllByRole('cell')[1]
            .textContent.match(/^(TeamResource|SiteResource)/)?.[0],
      );
  expect(order()).toEqual(['TeamResource', 'SiteResource']);
  view.changeLanguage('en-US');
  expect(order()).toEqual(['TeamResource', 'SiteResource']);
});

function mount(children: ReactNode, provide = true, locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const value = () => (
    <QueryClientProvider client={client}>
      <LiekanLocaleContext.Provider value={locale}>
        {provide ? (
          <FeatureProvider value={context}>{children}</FeatureProvider>
        ) : (
          <ManualRefreshProvider>{children}</ManualRefreshProvider>
        )}
      </LiekanLocaleContext.Provider>
    </QueryClientProvider>
  );
  const view = render(value());
  return {
    ...view,
    client,
    changeLanguage(language: 'zh-CN' | 'en-US') {
      locale = language;
      view.rerender(value());
    },
    updateContext(next: any) {
      context = next;
      view.rerender(value());
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.preferences.mockReturnValue({ timezone: 'America/New_York' });
  context = {
    user: owner,
    route: { page: 'boards' },
    sites: [site],
    teams: [team],
    siteId: site.id,
    site,
    range: { startAt: 1, endAt: 10, unit: 'day', timezone: 'UTC' },
    filters: {},
    query: {},
    api: {
      get: async (path: string, params?: any, signal?: AbortSignal) =>
        freshAggregateFixture(await mocks.get(path, params, signal), signal),
      post: mocks.post,
      del: mocks.del,
    },
    href: (page: string, params: any = {}) => `/${page}${params.id ? `/${params.id}` : ''}`,
    navigate: mocks.navigate,
    notify: mocks.notify,
    refresh: mocks.refresh,
  };
  mocks.get.mockImplementation(async (path: string) => {
    if (path === '/boards/board-1') return nativeBoard;
    if (path === '/teams/team-1')
      return { ...team, accessCode: 'team_code', twoFactorRequired: false };
    if (path === '/teams/team-1/users')
      return {
        data: [
          { userId: 'user-1', role: 'team-owner', user: { username: 'owner' } },
          { userId: 'user-2', role: 'team-manager', user: { username: 'manager' } },
        ],
        count: 2,
      };
    if (path === '/2fa/status') return { isConfigured: true, globalRequired: false };
    if (path.endsWith('/stats'))
      return {
        visitors: 4,
        pageviews: 8,
        visits: 5,
        comparison: { visitors: 3, pageviews: 6, visits: 4 },
      };
    if (path.endsWith('/pageviews'))
      return { pageviews: [{ x: '2026-10-01', y: 8 }], sessions: [{ x: '2026-10-01', y: 4 }] };
    if (path.endsWith('/metrics')) return [{ x: 'llm', y: 2 }];
    return { data: [], count: 0 };
  });
  mocks.all.mockImplementation(async (path: string) =>
    path === '/teams' ? [team] : path === '/admin/users' ? [owner] : [],
  );
  mocks.post.mockImplementation(async (path: string, body: any) => ({
    id: path.startsWith('/boards/') ? 'board-1' : 'new-id',
    ...body,
    teamId: 'team-1',
  }));
  mocks.del.mockResolvedValue({ ok: true });
  mocks.refresh.mockResolvedValue(undefined);
  mocks.request.mockResolvedValue({});
});
it('keeps team account creation exclusive to system administrators', async () => {
  context.route = { page: 'team-detail', teamId: team.id };
  mount(<WorkspacePages page="team-detail" />);
  await screen.findByRole('button', { name: '添加已有用户' });
  expect(screen.queryByRole('button', { name: '新建用户' })).not.toBeInTheDocument();
});
it('keeps the creation result when refresh fails and highlights a member on page two', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  context.user = { ...owner, isAdmin: true };
  context.route = { page: 'team-detail', teamId: id };
  context.siteId = undefined;
  let result: any;
  mocks.get.mockImplementation(async path => {
    if (path === `/teams/${id}`) return { ...team, id };
    if (path === `/teams/${id}/users`)
      return {
        data: result ? [{ ...result.member, user: result.user }] : [],
        count: 21,
        pageSize: 20,
      };
    return {};
  });
  mocks.post.mockImplementation(async (_path, body) => {
    result = {
      state: 'created',
      user: { id: body.userId, username: body.username, role: 'user' },
      member: {
        id: body.userId,
        userId: body.userId,
        teamId: id,
        role: body.teamRole,
        createdAt: new Date(0).toISOString(),
      },
      page: 2,
    };
    return result;
  });
  mocks.refresh.mockRejectedValue(new Error('read failed'));
  mount(<WorkspacePages page="team-detail" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '新建用户' }));
  await user.type(screen.getByLabelText(/^用户名/), 'created-user');
  await user.type(screen.getByLabelText(/^初始密码/), 'test-pass-1');
  await user.type(screen.getByLabelText(/^确认密码/), 'test-pass-1');
  await user.click(screen.getByRole('button', { name: '创建并加入团队' }));
  expect(await screen.findByText(/用户“created-user”已创建并加入团队/)).toBeInTheDocument();
  expect(await screen.findByText(/创建已完成，成员列表读取失败/)).toBeInTheDocument();
  await waitFor(() =>
    expect(document.querySelector('tr[data-highlighted="true"]')).toHaveTextContent('created-user'),
  );
  expect(mocks.get).toHaveBeenCalledWith(
    `/teams/${id}/users`,
    expect.objectContaining({ page: 2 }),
    expect.any(AbortSignal),
  );
  expect(mocks.post).toHaveBeenCalledTimes(1);
});
it('rereads the public overview when explicitly returning from events without renewal reads', async () => {
  const forces: boolean[] = [];
  mocks.request.mockImplementation(
    async (_method: string, path: string, _params: any, signal: AbortSignal) => {
      if (path.endsWith('/shared-report') || path.endsWith('/events/series'))
        forces.push(!!clientRequestOptions(signal)?.refresh);
      if (path === '/share/section-share')
        return {
          token: 'section-token',
          websiteId: 'site-1',
          parameters: { overview: true, events: true },
        };
      if (path === '/liekan/websites/site-1/shared-report')
        return {
          website: { id: 'site-1', name: '分区验收站' },
          states: {},
          cards: [],
          charts: {},
          tables: {},
          insights: [],
          meta: {},
          capabilities: { goals: false },
        };
      if (path === '/websites/site-1/events/series') return [];
      throw new Error(`Unexpected public request ${path}`);
    },
  );
  const view = mount(<ShareFeatureView slug="section-share" />, false, 'en-US');
  await screen.findByRole('heading', { name: '分区验收站' });
  const reports = () => mocks.request.mock.calls.filter(call => call[1].endsWith('/shared-report'));
  expect(reports()).toHaveLength(1);
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await userEvent.click(screen.getByRole('tab', { name: 'Event' }));
  view.changeLanguage('zh-CN');
  expect(screen.getByRole('tab', { name: '事件' })).toHaveAttribute('aria-selected', 'true');
  await screen.findByRole('heading', { name: '事件趋势' });
  await userEvent.click(screen.getByRole('tab', { name: '总览' }));
  await screen.findByRole('heading', { name: '分区验收站' });
  await waitFor(() => expect(reports()).toHaveLength(2));
  await userEvent.click(screen.getByRole('tab', { name: '事件' }));
  await screen.findByRole('heading', { name: '事件趋势' });
  await userEvent.click(screen.getByRole('tab', { name: '总览' }));
  await screen.findByRole('heading', { name: '分区验收站' });
  await waitFor(() => expect(reports()).toHaveLength(3));
  expect(forces).toHaveLength(5);
  expect(forces.every(force => !force)).toBe(true);
});

describe('workspace permissions and native board persistence', () => {
  it('shows daily resource trend dates without the ISO time suffix', async () => {
    context.range.timezone = 'Asia/Shanghai';
    const trend = {
      pageviews: [
        { x: '2026-10-01T00:00:00Z', y: 8 },
        { x: '2026-10-02T00:00:00Z', y: 12 },
        { x: '2026-10-03', y: 6 },
      ],
      sessions: [
        { x: '2026-10-01T00:00:00Z', y: 4 },
        { x: '2026-10-02T00:00:00Z', y: 7 },
        { x: '2026-10-03', y: 3 },
      ],
    };
    const original = structuredClone(trend);
    mocks.get.mockResolvedValue(trend);
    mount(<ResourceAnalytics id="site-1" metrics={false} title="" />);
    await waitFor(() => {
      const chart = JSON.parse(screen.getByRole('img', { name: '统计图表' }).textContent);
      expect(chart.labels).toEqual(['10-01', '10-02', '10-03']);
      expect(chart.series.map(series => series.values)).toEqual([
        [4, 7, 3],
        [4, 7, 3],
      ]);
    });
    expect(trend).toEqual(original);
  });
  it('keeps distinct time buckets for hourly resource trends', async () => {
    context.range.unit = 'hour';
    const points = [
      { x: '2026-10-01T01:00:00Z', y: 4 },
      { x: '2026-10-01T02:00:00Z', y: 7 },
    ];
    mocks.get.mockResolvedValue({ pageviews: points, sessions: points });
    mount(<ResourceAnalytics id="site-1" metrics={false} title="" />);
    await waitFor(() => {
      const chart = JSON.parse(screen.getByRole('img', { name: '统计图表' }).textContent);
      expect(chart.labels).toEqual(points.map(point => point.x));
    });
  });
  it('keeps the boards resource cell neutral while workspace entities load', async () => {
    let releaseEntities: (rows: any[]) => void = () => {};
    const pendingEntities = new Promise<any[]>(resolve => {
      releaseEntities = resolve;
    });
    mocks.get.mockImplementation(async (path: string) =>
      path === '/boards'
        ? {
            data: [
              {
                id: 'board-linked',
                name: '链接看板',
                type: 'link',
                parameters: { linkId: 'link-1' },
                updatedAt: '2026-10-01T00:00:00Z',
              },
            ],
            count: 1,
          }
        : { data: [], count: 0 },
    );
    mocks.all.mockImplementation(async (path: string) =>
      path === '/teams' ? [team] : path === '/admin/users' ? [owner] : pendingEntities,
    );
    mount(<WorkspacePages page="boards" />);
    expect(await screen.findByText('链接看板')).toBeInTheDocument();
    expect(screen.getByText('正在读取')).toBeInTheDocument();
    expect(screen.queryByText('资源不存在')).not.toBeInTheDocument();
    act(() => releaseEntities([{ id: 'link-1', name: '落地页链接' }]));
    expect(await screen.findByText('落地页链接')).toBeInTheDocument();
  });
  it('allows a read-only team entry to create a board in personal space', async () => {
    const viewer = { ...owner, id: 'viewer' };
    const readTeam = { ...team, members: [{ userId: viewer.id, role: 'team-view-only' }] };
    context = {
      ...context,
      user: viewer,
      teams: [readTeam],
      route: { page: 'board-editor', teamId: team.id },
    };
    mocks.post.mockImplementation(async (_path: string, body: any) => ({
      id: 'personal-board',
      ...body,
    }));
    mount(<WorkspacePages page="board-editor" />);
    const space = await screen.findByRole('combobox', { name: '所属空间' });
    expect(space).toBeEnabled();
    expect(screen.queryByRole('option', { name: team.name })).not.toBeInTheDocument();
    await userEvent.selectOptions(space, '');
    await userEvent.type(screen.getByRole('textbox', { name: /^看板名称/ }), '个人观察看板');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '关联资源' }), site.id);
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/boards',
        expect.objectContaining({ name: '个人观察看板' }),
      ),
    );
    expect(mocks.post.mock.calls[0][1].teamId).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledWith('board-design', {
      id: 'personal-board',
      teamId: '',
    });
  });
  it('keeps member editing below the actor rank and grants read-only no resource writes', () => {
    expect(canManageMember(owner, team, { role: 'team-manager' })).toBe(true);
    expect(canManageMember({ ...owner, id: 'user-2' }, team, { role: 'team-manager' })).toBe(false);
    expect(canManageMember(owner, team, { role: 'team-owner' })).toBe(false);
    const readTeam = { ...team, members: [{ userId: 'viewer', role: 'team-view-only' }] };
    expect(
      canManageResource(
        { ...owner, id: 'viewer' },
        { id: 'resource', name: '资源', teamId: team.id },
        [readTeam],
      ),
    ).toBe(false);
  });
  it('changing board resources and ordering retains unknown metadata and original component configuration', () => {
    const next = boardParameters(nativeBoard.parameters, 'link', 'link-1');
    expect(next.websiteId).toBeUndefined();
    expect(next.linkId).toBe('link-1');
    expect(next.extension).toEqual({ retain: true });
    const reordered = moveBoardColumn(next, 'column-2', 'column-1');
    expect(boardColumns(reordered).map(entry => entry.column.id)).toEqual(['column-2', 'column-1']);
    expect(reordered.rows[0].size).toBe(360);
    expect(reordered.rows[0].extension).toBe('row');
    expect(reordered.rows[0].columns[1].component.props).toEqual({ retain: 'one' });
    const widened = setBoardColumnWidth(reordered, 'column-2', true, () => 'new-row');
    expect(boardColumns(widened).map(entry => entry.column.id)).toEqual(['column-2', 'column-1']);
    expect(widened.rows[0].columns[0].size).toBe(100);
    expect(widened.rows[0].size).toBe(360);
  });
  it('joins the real team and navigates using the returned membership team ID', async () => {
    mount(<WorkspacePages page="team-join" />);
    await userEvent.type(screen.getByLabelText(/访问码/), 'team_access_code');
    await userEvent.click(screen.getByRole('button', { name: '验证并加入' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/teams/join', { accessCode: 'team_access_code' }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('team-detail', { id: 'team-1', teamId: 'team-1' });
  });
  it('a team viewer can read members and cannot open mutation drawers', async () => {
    context.user = { ...owner, id: 'viewer' };
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mocks.get.mockImplementation(async (path: string) =>
      path === '/teams/team-1'
        ? { ...team, members: [{ userId: 'viewer', role: 'team-view-only' }] }
        : {
            data: [{ userId: 'user-2', role: 'team-manager', user: { username: 'manager' } }],
            count: 1,
          },
    );
    mount(<WorkspacePages page="team-detail" />);
    expect(await screen.findByRole('button', { name: '添加已有用户' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: '编辑角色' })).toBeDisabled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each([
    ['member', 'team-member', false],
    ['viewer', 'team-view-only', false],
    ['administrator member', 'team-member', true],
  ])(
    '%s can leave its team, and deletion follows administrative authority',
    async (_label, teamRole, isAdmin) => {
      context.user = { ...owner, isAdmin };
      context.route = { page: 'team-detail', teamId: 'team-1' };
      const original = mocks.get.getMockImplementation();
      mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
        path === '/teams/team-1'
          ? { ...team, members: [{ userId: owner.id, role: teamRole }] }
          : original(path, ...args),
      );
      mount(<WorkspacePages page="team-detail" />);
      await userEvent.click(await screen.findByRole('tab', { name: '设置' }));
      expect(screen.getByRole('button', { name: '退出团队' })).toBeEnabled();
      if (isAdmin) expect(screen.getByRole('button', { name: '删除团队' })).toBeEnabled();
      else expect(screen.getByRole('button', { name: '删除团队' })).toBeDisabled();
    },
  );
  it('an actual owner must transfer ownership before leaving', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mount(<WorkspacePages page="team-detail" />);
    await userEvent.click(await screen.findByRole('tab', { name: '设置' }));
    expect(screen.getByRole('button', { name: '退出团队' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '删除团队' })).toBeEnabled();
  });
  it('member timestamps use the configured time zone across calendar boundaries', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    const timestamp = '2026-10-01T00:00:00.000Z';
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/teams/team-1/users'
        ? {
            data: [
              {
                userId: owner.id,
                role: 'team-owner',
                user: { username: owner.username },
                createdAt: timestamp,
              },
            ],
            count: 1,
          }
        : original(path, ...args),
    );
    mount(<WorkspacePages page="team-detail" />);
    const preferred = new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'America/New_York' });
    expect(await screen.findByText(preferred)).toBeInTheDocument();
    expect(preferred).not.toBe(new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'UTC' }));
  });
  it('native link board widgets retain event type and omit foreign website conditions', async () => {
    context.route = { page: 'board-view', id: 'board-1' };
    context.filters = {
      segment: 'foreign-site-segment',
      cohort: 'foreign-site-cohort',
      spf: 'secret=eq.x',
      epf: 'plan=eq.y',
    };
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/boards/board-1'
        ? {
            ...nativeBoard,
            type: 'link',
            parameters: { ...nativeBoard.parameters, websiteId: undefined, linkId: 'link-1' },
          }
        : original(path, ...args),
    );
    mount(<WorkspacePages page="board-view" />);
    await waitFor(() =>
      expect(mocks.get.mock.calls.some(call => call[0] === '/websites/link-1/metrics')).toBe(true),
    );
    const calls = mocks.get.mock.calls.filter(call => call[0].startsWith('/websites/link-1/'));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, params] of calls) {
      expect(params).toMatchObject({ startAt: 1, endAt: 10, eventType: 3 });
      for (const key of ['segment', 'cohort', 'spf', 'epf']) expect(params).not.toHaveProperty(key);
    }
  });
  it('board summary renders its four approved fields with actual goal values and no duplicate trend', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({
      id: `goal-${i}`,
      name: `其他目标 ${i}`,
    }));
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, params: any, signal: any) => {
      if (path === '/websites/site-1/goals')
        return {
          data: params.page === 1 ? firstPage : [{ id: 'appointment', name: '预约演示' }],
          count: 101,
        };
      if (path === '/websites/site-1/goals/appointment/stats')
        return { conversions: 11, num: 7, total: 20 };
      if (path === '/websites/site-1/stats')
        return params.drill_channel ? { visitors: 12 } : { visitors: 91, pageviews: 123 };
      return original(path, params, signal);
    });
    const { container } = mount(<ResourceAnalytics id="site-1" variant="board" />);
    await screen.findByText('11');
    expect(
      Array.from(container.querySelectorAll('.metric-label'), node => node.textContent),
    ).toEqual(['访客', 'AI 引荐', '预约转化', '转化访客']);
    expect(
      Array.from(container.querySelectorAll('.metric-value'), node => node.textContent),
    ).toEqual(['91', '12', '11', '7']);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith(
      '/websites/site-1/goals',
      { page: 2, pageSize: 100 },
      expect.any(AbortSignal),
    );
  });
  it('native metrics-only and trend widgets keep one outer panel per widget', async () => {
    context.route = { page: 'board-view', id: 'board-1' };
    const original = mocks.get.getMockImplementation();
    mocks.get.mockImplementation(async (path: string, ...args: any[]) =>
      path === '/boards/board-1'
        ? {
            ...nativeBoard,
            parameters: {
              ...nativeBoard.parameters,
              rows: [
                {
                  id: 'row',
                  columns: [
                    { id: 'metrics', component: { type: 'WebsiteMetricsBar', title: '统计摘要' } },
                    nativeBoard.parameters.rows[0].columns[0],
                  ],
                },
              ],
            },
          }
        : original(path, ...args),
    );
    const { container } = mount(<WorkspacePages page="board-view" />);
    expect(await screen.findByRole('heading', { name: '统计摘要' })).toBeInTheDocument();
    await screen.findByRole('img');
    expect(screen.getAllByRole('heading', { name: '访问趋势' })).toHaveLength(1);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(container.querySelector('.board-widget .panel')).toBeNull();
  });
  it('team owners see that the native safety policy is administered by the system administrator', async () => {
    context.route = { page: 'team-detail', teamId: 'team-1' };
    mount(<WorkspacePages page="team-detail" />);
    await userEvent.click(await screen.findByRole('tab', { name: '安全' }));
    expect(await screen.findByText('团队安全策略由系统管理员设置。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存团队策略' })).toBeDisabled();
  });
  it('saves reordered and edited board components in rows/columns without losing extension fields', async () => {
    context.route = { page: 'board-design', id: 'board-1' };
    mount(<WorkspacePages page="board-design" />);
    const up = await screen.findAllByRole('button', { name: '上移' });
    await userEvent.click(up[1]);
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [path, body] = mocks.post.mock.calls[0];
    expect(path).toBe('/boards/board-1');
    expect(body.parameters.extension).toEqual({ retain: true });
    expect(body.parameters.rows[0].columns.map((column: any) => column.id)).toEqual([
      'column-2',
      'column-1',
    ]);
    expect(body.parameters.rows[0].columns[1].component.props).toEqual({ retain: 'one' });
  });
  it('protects unsaved board layout changes from the page refresh control', async () => {
    const user = userEvent.setup();
    context.route = { page: 'board-design', id: 'board-1' };
    mount(
      <ManualRefreshProvider>
        <ManualRefreshControl />
        <WorkspacePages page="board-design" />
      </ManualRefreshProvider>,
    );
    const up = await screen.findAllByRole('button', { name: '上移' });
    await user.click(up[1]);
    const before = mocks.get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('当前有未保存的输入');
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(mocks.get).toHaveBeenCalledTimes(before);
    await user.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(
      mocks.post.mock.calls[0][1].parameters.rows[0].columns.map((column: any) => column.id),
    ).toEqual(['column-2', 'column-1']);
  });
  it('preserves board edits made while a manual board read is pending', async () => {
    context.route = { page: 'board-design', id: 'board-1' };
    const originalGet = mocks.get.getMockImplementation();
    let reads = 0;
    let finish!: (board: any) => void;
    mocks.get.mockImplementation((path: string, ...args: any[]) => {
      if (path !== '/boards/board-1') return originalGet(path, ...args);
      return ++reads === 1
        ? structuredClone(nativeBoard)
        : new Promise(resolve => (finish = resolve));
    });
    const { container } = mount(
      <ManualRefreshProvider>
        <ManualRefreshControl />
        <WorkspacePages page="board-design" />
      </ManualRefreshProvider>,
    );
    await screen.findAllByRole('button', { name: '上移' });
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(reads).toBe(2));
    await userEvent.click(screen.getAllByRole('button', { name: '上移' })[1]);
    expect(container.querySelector('[data-unsaved="true"]')).not.toBeNull();
    await act(async () => finish(structuredClone(nativeBoard)));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
    expect(container.querySelector('[data-unsaved="true"]')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(
      mocks.post.mock.calls[0][1].parameters.rows[0].columns.map((column: any) => column.id),
    ).toEqual(['column-2', 'column-1']);
  });
  it('reads widgets only for the refreshed board source after its definition arrives', async () => {
    context.route = { page: 'board-view', id: 'board-1' };
    const originalGet = mocks.get.getMockImplementation();
    let reads = 0;
    let finish!: (board: any) => void;
    mocks.get.mockImplementation((path: string, ...args: any[]) => {
      if (path !== '/boards/board-1') return originalGet(path, ...args);
      return ++reads === 1
        ? structuredClone(nativeBoard)
        : new Promise(resolve => (finish = resolve));
    });
    mount(
      <ManualRefreshProvider>
        <ManualRefreshControl />
        <WorkspacePages page="board-view" />
      </ManualRefreshProvider>,
    );
    await screen.findAllByRole('img');
    await userEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(reads).toBe(2));
    const before = mocks.get.mock.calls.length;
    const board = structuredClone(nativeBoard);
    board.parameters.websiteId = 'site-2';
    await act(async () => finish(board));
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled());
    const paths = mocks.get.mock.calls.slice(before).map(call => call[0]);
    expect(paths.some(path => path.startsWith('/websites/site-2/'))).toBe(true);
    expect(paths.some(path => path.startsWith('/websites/site-1/'))).toBe(false);
  });
  it('fixed-source widget edits inherit the board source and remove legacy resource fields on save', async () => {
    context.route = { page: 'board-design', id: 'board-1' };
    const board = structuredClone(nativeBoard);
    Object.assign(board.parameters.rows[0].columns[0].component, {
      entityType: 'website',
      entityId: 'former-site',
      websiteId: 'former-site',
    });
    const originalGet = mocks.get.getMockImplementation();
    mocks.get.mockImplementation((path: string, ...args: any[]) =>
      path === '/boards/board-1' ? board : originalGet(path, ...args),
    );
    mount(<WorkspacePages page="board-design" />);
    const edit = await screen.findAllByRole('button', { name: '编辑' });
    await userEvent.click(edit[0]);
    await userEvent.click(await screen.findByRole('button', { name: '保存组件' }));
    await userEvent.click(screen.getByRole('button', { name: '保存编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(parameters.rows[0].columns[0].component).toEqual(
      nativeBoard.parameters.rows[0].columns[0].component,
    );
    expect(getBoardEntityIds({ type: 'website', parameters })).toEqual({
      websiteIds: [site.id],
      pixelIds: [],
      linkIds: [],
    });
  });
  it('changing a fixed board source keeps only the selected source in saved layout', async () => {
    context.route = { page: 'board-editor', id: 'board-1' };
    const other = { ...site, id: 'site-2', name: '新网站' };
    context.sites = [site, other];
    const board = structuredClone(nativeBoard);
    Object.assign(board.parameters.rows[0].columns[0].component, {
      entityType: 'website',
      entityId: site.id,
      websiteId: site.id,
    });
    mocks.get.mockResolvedValue(board);
    mount(<WorkspacePages page="board-editor" />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: '关联资源' }),
      other.id,
    );
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(getBoardEntityIds({ type: 'website', parameters })).toEqual({
      websiteIds: [other.id],
      pixelIds: [],
      linkIds: [],
    });
    expect(parameters.rows[0].columns[0].component.props).toEqual({ retain: 'one' });
  });
  it('changing a fixed board to mixed preserves the original visible widget source', async () => {
    context.route = { page: 'board-editor', id: 'board-1' };
    mount(<WorkspacePages page="board-editor" />);
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: '看板类型' }),
      'mixed',
    );
    await userEvent.click(screen.getByRole('button', { name: '保存并编排' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const parameters = mocks.post.mock.calls[0][1].parameters;
    expect(parameters.websiteId).toBeUndefined();
    expect(
      parameters.rows[0].columns.every(
        (column: any) =>
          column.component.entityType === 'website' && column.component.entityId === site.id,
      ),
    ).toBe(true);
    expect(getBoardEntityIds({ type: 'mixed', parameters }).websiteIds).toEqual([site.id]);
  });
  it('loads delayed workspace sites and team resources and keeps renamed site choices current', async () => {
    context = { ...context, sites: [], teams: [], route: { page: 'board-editor' } };
    const teamLink = { id: 'team-link', name: '团队推广链接', teamId: team.id };
    mocks.all.mockImplementation(async (path: string) =>
      path === `/teams/${team.id}/links` ? [teamLink] : [],
    );
    const view = mount(<WorkspacePages page="board-editor" />);
    await screen.findByRole('combobox', { name: '关联资源' });
    expect(screen.queryByRole('option', { name: site.name })).not.toBeInTheDocument();

    view.updateContext({ ...context, sites: [site], teams: [team] });
    expect(await screen.findByRole('option', { name: site.name })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'link');
    expect(await screen.findByRole('option', { name: teamLink.name })).toBeInTheDocument();
    expect(mocks.all).toHaveBeenCalledWith(`/teams/${team.id}/links`, {}, expect.any(AbortSignal));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'website');
    view.updateContext({ ...context, sites: [{ ...site, name: '网站新名称' }] });
    expect(await screen.findByRole('option', { name: '网站新名称' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: site.name })).not.toBeInTheDocument();

    view.updateContext({ ...context, teams: [] });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '看板类型' }), 'link');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: teamLink.name })).not.toBeInTheDocument(),
    );
  });
  it('distinguishes absent analytics from a measured zero', () => {
    expect(nativeMetric(undefined)).toBeNull();
    expect(nativeMetric(null)).toBeNull();
    expect(nativeMetric(0)).toBe(0);
    expect(nativeMetric({ value: 0 })).toBe(0);
  });
});

describe('share settings and public access from the list', () => {
  const share = {
    id: 'share-1',
    entityId: site.id,
    shareType: 1,
    name: '客户分享',
    slug: 'customer/share',
    parameters: {
      overview: true,
      events: false,
      utm: true,
      goals: true,
      funnels: true,
      allowFilter: false,
      hasPassword: true,
      enabled: false,
      extension: 'retained',
    },
  };
  beforeEach(() => {
    context.route = { page: 'sharing' };
    mocks.all.mockImplementation(async (path: string) =>
      path === `/websites/${site.id}/shares` ? [share] : [],
    );
  });

  it('creates a share with the selected resource and submitted viewing permissions', async () => {
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '创建分享链接' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '创建分享链接' });
    expect(dialog).toHaveAccessibleDescription('设置分享资源、统计页面范围与访问保护。');
    await userEvent.type(within(dialog).getByLabelText(/分享名称/), '销售统计');
    await userEvent.selectOptions(within(dialog).getByLabelText('关联资源'), site.id);
    await userEvent.click(within(dialog).getByLabelText('总览'));
    await userEvent.click(within(dialog).getByLabelText('UTM'));
    await userEvent.click(within(dialog).getByLabelText('允许访客调整筛选'));
    await userEvent.click(within(dialog).getByRole('button', { name: '创建分享链接' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledWith('/share', {
      name: '销售统计',
      entityId: site.id,
      shareType: 1,
      parameters: {
        timezone: 'America/New_York',
        range: '0day',
        enabled: true,
        allowFilter: false,
        theme: 'light',
        overview: false,
        events: true,
        utm: true,
        goals: false,
        funnels: false,
      },
    });
  });

  it('edits a share while preserving its slug, disabled state, password and extra parameters', async () => {
    mount(<WorkspacePages page="sharing" />);
    await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    expect(within(dialog).getByLabelText('关联资源')).toHaveValue(site.name);
    expect(within(dialog).getByLabelText('分享类型')).toBeDisabled();
    expect(within(dialog).getByLabelText(/修改分享密码/)).toHaveValue('');
    const name = within(dialog).getByLabelText(/分享名称/);
    await userEvent.clear(name);
    await userEvent.type(name, '客户周报');
    await userEvent.click(within(dialog).getByLabelText('事件'));
    await userEvent.click(within(dialog).getByRole('button', { name: '保存分享链接' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.post).toHaveBeenCalledWith('/share/id/share-1', {
      name: '客户周报',
      slug: share.slug,
      parameters: { ...share.parameters, events: true, theme: 'light' },
    });
  });

  it('keeps failed edits open and restores the trigger focus when cancelled', async () => {
    mocks.post.mockRejectedValue(new Error('保存失败，请重试'));
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '编辑' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    await userEvent.click(within(dialog).getByRole('button', { name: '保存分享链接' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('保存失败，请重试');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('traps keyboard focus in the dialog and closes on Escape without saving', async () => {
    mount(<WorkspacePages page="sharing" />);
    const trigger = await screen.findByRole('button', { name: '编辑' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '编辑分享链接' });
    const close = within(dialog).getByRole('button', { name: '关闭弹窗' });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    close.focus();
    await userEvent.tab({ shift: true });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '保存分享链接' })).toHaveFocus(),
    );
    await userEvent.tab();
    await waitFor(() => expect(close).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('opens the actual public share in a new tab even for a viewer without edit access', async () => {
    context.user = { id: 'viewer', username: 'viewer', role: 'user' };
    mount(<WorkspacePages page="sharing" />);
    const link = await screen.findByRole('link', { name: /访问分享链接：客户分享/ });
    expect(link).toHaveAttribute('href', '/share/customer%2Fshare');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '启用' })).toBeDisabled();
  });
});

describe('public share restrictions and password lifecycle', () => {
  it.each([
    ['2026-03-08T12:00:00Z', '2026-03-08T05:00:00Z', '2026-03-09T03:59:59.999Z'],
    ['2026-11-01T12:00:00Z', '2026-11-01T04:00:00Z', '2026-11-02T04:59:59.999Z'],
  ])('pins public Today to the publisher calendar on %s and preserves its selected button', async (now, start, end) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
    const slug = `calendar-report-${Date.parse(now)}`;
    setTestUrl(`/share/${slug}`);
    mocks.preferences.mockReturnValue({ timezone: 'Asia/Tokyo', range: '30day' });
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === `/share/${slug}`) return {
        token: 'calendar-proof', websiteId: 'site-1', parameters: {
          timezone: 'America/New_York', range: '0day', overview: true, events: false,
          goals: false, utm: false, allowFilter: true,
        },
      };
      return {
        website: { id: 'site-1', name: '日历分享', domain: 'example.com' },
        states: { human: 'available', logs: 'not_connected' }, cards: [], charts: {},
        tables: { envGrid: [], cityBody: [] }, insights: [], meta: { demo: false },
        capabilities: { goals: false },
      };
    });
    mount(<ShareFeatureView slug={slug} />, false);
    await screen.findByRole('heading', { name: '日历分享' });
    const reportCalls = () => mocks.request.mock.calls.filter(call => call[1].endsWith('/shared-report'));
    expect(reportCalls()).toHaveLength(1);
    expect(reportCalls()[0][2]).toEqual({
      startAt: Date.parse(start), endAt: Date.parse(end), timezone: 'America/New_York', chartPeriod: 'today',
    });
    expect(screen.getByRole('button', { name: '今天' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '7 天' }));
    await waitFor(() => expect(reportCalls()).toHaveLength(2));
    expect(screen.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: '今天' }));
    expect(screen.getByRole('button', { name: '今天' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: '24h' })).not.toBeInTheDocument();
  });

  it.each(['24hour', '24h'])('keeps an explicit legacy %s URL rolling when a share defaults to Today', async token => {
    setTestUrl(`/share/rolling-report?date=${token}`);
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === '/share/rolling-report') return {
        token: 'rolling-proof', websiteId: 'site-1', parameters: {
          timezone: 'America/New_York', range: '0day', overview: false, events: true,
          goals: false, utm: false, allowFilter: false,
        },
      };
      return [];
    });
    mount(<ShareFeatureView slug="rolling-report" />, false);
    await screen.findByRole('heading', { name: '事件趋势' });
    const request = mocks.request.mock.calls.find(call => call[1].endsWith('/events/series'));
    expect(request[2].endAt - request[2].startAt).toBe(86400000);
    expect(request[2].timezone).toBe('America/New_York');
  });

  it('does not carry returned password material into an update, and explicitly removes protection with null', () => {
    const unchanged = shareParameters(
      { overview: 'on', allowFilter: 'on', theme: 'light' },
      { passwordHash: 'hash', password: 'old', hasPassword: true, extension: 'retain' },
    );
    expect(unchanged).not.toHaveProperty('passwordHash');
    expect(unchanged).not.toHaveProperty('password');
    expect(unchanged.extension).toBe('retain');
    expect(shareParameters({ removePassword: 'on' }, { hasPassword: true }).password).toBeNull();
    expect(
      allowedShareSections({ overview: false, events: true, utm: false, goals: false }),
    ).toEqual([['events', '事件']]);
  });
  it('requires the public password before statistics, sends the password only on submission, and uses the share token for allowed events', async () => {
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (path === '/share/password-share')
        return method === 'GET'
          ? { requiresPassword: true, name: '受保护分享' }
          : {
              token: 'public-token',
              websiteId: 'site-1',
              parameters: {
                overview: false,
                events: true,
                utm: false,
                goals: false,
                allowFilter: false,
              },
            };
      if (path === '/websites/site-1/events/series')
        return [{ x: 'register', t: '2026-10-01', y: 0 }];
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="password-share" />, false);
    await screen.findByRole('heading', { name: '输入分享密码' });
    expect(mocks.request.mock.calls.every(call => call[1] === '/share/password-share')).toBe(true);
    await userEvent.type(screen.getByLabelText(/分享密码/), 'visitor-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    expect(await screen.findByRole('heading', { name: '事件趋势' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '总览' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('页面路径')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith(
        'GET',
        '/websites/site-1/events/series',
        expect.any(Object),
        expect.any(AbortSignal),
        'public-token',
        '',
      ),
    );
    expect(mocks.request).toHaveBeenCalledWith(
      'POST',
      '/share/password-share',
      { password: 'visitor-password' },
      expect.any(AbortSignal),
      undefined,
      '',
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('a pending password response for a previous slug never renders its verified statistics', async () => {
    let finishPrevious: (value: any) => void;
    mocks.request.mockImplementation((method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/share/'))
        return Promise.resolve({
          requiresPassword: true,
          name: path.endsWith('old-share') ? '旧分享' : '新分享',
        });
      if (method === 'POST' && path === '/share/old-share')
        return new Promise(resolve => {
          finishPrevious = resolve;
        });
      throw new Error(`Unexpected request ${path}`);
    });
    const { rerender, client } = mount(<ShareFeatureView slug="old-share" />, false);
    await userEvent.type(await screen.findByLabelText(/分享密码/), 'old-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    const submitted = mocks.request.mock.calls.find(call => call[0] === 'POST');
    expect(submitted).toBeDefined();
    const signal = submitted[3] as AbortSignal;
    rerender(
      <QueryClientProvider client={client}>
        <ShareFeatureView slug="new-share" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('新分享 · 只读分享')).toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      finishPrevious({
        token: 'obsolete-token',
        websiteId: 'old-site',
        parameters: { overview: true, allowFilter: false },
      }),
    );
    expect(screen.getByRole('heading', { name: '输入分享密码' })).toBeInTheDocument();
    expect(mocks.request.mock.calls.filter(call => call[1].startsWith('/websites/'))).toHaveLength(
      0,
    );
    expect(screen.getByRole('button', { name: '验证并查看' })).toBeEnabled();
  });
  it('the legacy public analytics component preserves truthful appointment conversions', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string, params: any) => {
      if (path === '/share/overview-share')
        return {
          token: 'overview-token',
          websiteId: 'site-1',
          parameters: {
            overview: true,
            goals: true,
            events: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/websites/site-1/goals')
        return { data: [{ id: 'appointment', name: '预约演示' }], count: 1 };
      if (path === '/websites/site-1/goals/appointment/stats')
        return { conversions: 11, num: 7, total: 20 };
      if (path.endsWith('/stats'))
        return params.drill_channel ? { visitors: 12 } : { visitors: 91, pageviews: 123 };
      if (path.endsWith('/pageviews'))
        return { pageviews: [{ x: '2026-10-01', y: 123 }], sessions: [{ x: '2026-10-01', y: 91 }] };
      throw new Error(`Unexpected public request ${path}`);
    });
    const { container } = mount(
      <ResourceAnalytics
        id="site-1"
        kind="website"
        variant="public"
        title="访问趋势"
        request={async (path, params, signal) =>
          freshAggregateFixture(
            await mocks.request('GET', path, params, signal, 'overview-token', ''),
            signal,
          )
        }
      />,
    );
    await screen.findByText('11');
    expect(
      Array.from(container.querySelectorAll('.metric-label'), node => node.textContent),
    ).toEqual(['访客', '访问次数', 'AI 引荐', '预约演示']);
    expect(
      Array.from(container.querySelectorAll('.metric-value'), node => node.textContent),
    ).toEqual(['91', '123', '12', '11']);
    expect(screen.getByRole('img', { name: '访问趋势' })).toBeInTheDocument();
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'overview-token' && call[5] === ''),
    ).toBe(true);
  });
  it('preserves the shared report structure during loading and removes it on access denial', async () => {
    let metadataCalls = 0;
    let rejectReport: (reason: unknown) => void = () => {};
    const pending = new Promise((_, reject) => {
      rejectReport = reject;
    });
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === '/share/pending-report') {
        if (++metadataCalls > 1)
          throw Object.assign(new Error('Share access revoked'), { status: 403 });
        return {
          token: 'pending-report-token',
          websiteId: 'site-1',
          parameters: { overview: true },
        };
      }
      if (path === '/liekan/websites/site-1/shared-report') return pending;
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="pending-report" />, false);
    for (const name of ['访客概览', 'AI 与来源', '地域分布'])
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /分享图表/ })).toHaveLength(8);
    expect(screen.queryAllByText('当前范围暂无数据')).toHaveLength(0);
    await act(async () => rejectReport({ status: 403 }));
    await screen.findByRole('heading', { name: '没有访问权限' });
    expect(screen.queryByRole('heading', { name: '访客概览' })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])(
    'hides a revoked shared report and date controls while authorization is rechecked after %s',
    async status => {
      let metadataCalls = 0;
      let reportCalls = 0;
      mocks.request.mockImplementation(async (_method: string, path: string) => {
        if (path === '/share/revoked-report') {
          if (++metadataCalls > 1) return new Promise(() => {});
          return {
            token: 'revoked-report-token',
            websiteId: 'site-1',
            parameters: { overview: true, allowFilter: true },
          };
        }
        if (path === '/liekan/websites/site-1/shared-report') {
          if (++reportCalls === 2)
            throw Object.assign(new Error('Share access revoked'), { status });
          if (reportCalls > 2) return new Promise(() => {});
          return {
            website: { id: 'site-1', name: '已撤销网站', domain: 'revoked.example' },
            states: { human: 'available', logs: 'not_connected' },
            cards: [],
            charts: {},
            tables: { envGrid: [], cityBody: [] },
            insights: [],
            meta: { demo: true },
            capabilities: { goals: false },
          };
        }
        throw new Error(`Unexpected public request ${path}`);
      });
      const { client } = mount(<ShareFeatureView slug="revoked-report" />, false);
      await screen.findByRole('heading', { name: '已撤销网站' });
      expect(screen.getByText('revoked.example')).toBeInTheDocument();
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['liekan-shared-report'] });
      });
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: '已撤销网站' })).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: '7 天' })).not.toBeInTheDocument();
      expect(metadataCalls).toBe(2);
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['liekan-shared-report'] })
          .filter(query => query.state.data !== undefined),
      ).toHaveLength(0);
      expect(screen.queryByRole('heading', { name: '已撤销网站' })).not.toBeInTheDocument();
      expectHiddenText('revoked.example');
      expectHiddenText(/以下为隔离的示例数据/);
    },
  );
  it.each([401, 403, 404])(
    'discards other cached shared report ranges when access returns %s',
    async status => {
      let metadataCalls = 0;
      let reportCalls = 0;
      mocks.request.mockImplementation(async (_method: string, path: string) => {
        if (path === '/share/cached-revoked-report') {
          if (++metadataCalls > 1) return new Promise(() => {});
          return {
            token: 'cached-revoked-report-token',
            websiteId: 'site-1',
            parameters: { overview: true, allowFilter: true },
          };
        }
        if (path === '/liekan/websites/site-1/shared-report') {
          if (++reportCalls === 4)
            throw Object.assign(new Error('Share access revoked'), { status });
          if (reportCalls > 4) return new Promise(() => {});
          return {
            website: { id: 'site-1', name: '缓存网站', domain: 'cached.example' },
            states: { human: 'available', logs: 'not_connected' },
            cards: [{ label: '访客数 UV', value: reportCalls === 2 ? 17 : 91, state: 'available' }],
            charts: {},
            tables: { envGrid: [], cityBody: [] },
            insights: [],
            meta: { demo: true },
            capabilities: { goals: false },
          };
        }
        throw new Error(`Unexpected public request ${path}`);
      });
      const { client } = mount(<ShareFeatureView slug="cached-revoked-report" />, false);
      await screen.findByRole('heading', { name: '缓存网站' });
      await userEvent.click(screen.getByRole('button', { name: '7 天' }));
      await screen.findByText('17');
      await userEvent.click(screen.getByRole('button', { name: '30 天' }));
      await screen.findByText('91');
      expect(reportCalls).toBe(3);
      await act(async () => {
        await client.invalidateQueries({ queryKey: ['liekan-shared-report'] });
      });
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: '缓存网站' })).not.toBeInTheDocument(),
      );
      expect(screen.queryByRole('button', { name: '7 天' })).not.toBeInTheDocument();
      expect(reportCalls).toBe(4);
      expect(
        client
          .getQueryCache()
          .findAll({ queryKey: ['liekan-shared-report'] })
          .filter(query => query.state.data !== undefined),
      ).toHaveLength(0);
      expect(screen.queryByRole('heading', { name: '缓存网站' })).not.toBeInTheDocument();
      expectHiddenText('cached.example');
      expect(screen.queryByText('17')).not.toBeInTheDocument();
    },
  );
  it('website shares render every requested module and update all dates together with the share token', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string, params: any) => {
      if (path === '/share/website-report')
        return {
          token: 'report-token',
          websiteId: 'site-1',
          parameters: {
            overview: true,
            goals: false,
            events: false,
            utm: false,
            allowFilter: true,
          },
        };
      if (path === '/liekan/websites/site-1/shared-report') {
        if (params.endAt < params.startAt)
          throw Object.assign(new Error('结束日期须晚于开始日期'), { status: 400 });
        return {
          website: { id: 'site-1', name: '测试网站', domain: 'example.com' },
          states: { human: 'available', logs: 'not_connected' },
          cards: [{ label: '访客数 UV', value: 91, state: 'available', detail: '所选统计范围' }],
          charts: {},
          tables: {
            envGrid: [{ category: 'browser', name: 'chrome', share: 100 }],
            cityBody: [
              {
                city: '上海',
                sessions: 20,
                share: 30,
                duration: 120,
                bounceRate: 10,
                conversionRate: null,
              },
            ],
          },
          insights: ['接入服务器日志后可计算 AI 抓取统计。'],
          meta: { demo: true },
          capabilities: { goals: false },
        };
      }
      throw new Error(`Unexpected public request ${path}`);
    });
    const view = mount(<ShareFeatureView slug="website-report" />, false);
    await screen.findByRole('heading', { name: '测试网站' });
    const attribution = screen.getByRole('link', { name: 'IP Geolocation by DB-IP' });
    expect(attribution).toHaveAttribute('href', 'https://db-ip.com');
    expect(attribution).toHaveAttribute('rel', 'noopener noreferrer');
    for (const title of [
      '访客趋势（UV / PV / 跳出率）',
      '访问时段热力',
      '设备构成',
      '浏览器 / OS TOP5',
      'AI 蜘蛛与浏览访问趋势',
      'AI 蜘蛛构成',
      '访客来源渠道',
      'GEO 关键发现',
      '国内省份分布 TOP10',
      '海外国家/地区 TOP8',
      '城市明细 TOP12',
    ])
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /分享图表/ })).toHaveLength(8);
    expect(screen.getByText(/以下为隔离的示例数据/)).toBeInTheDocument();
    expect(screen.getByText('上海')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '转化率' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('页面路径')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7 天' }));
    await waitFor(() => {
      const calls = mocks.request.mock.calls.filter(call => call[1].includes('/shared-report'));
      expect(calls).toHaveLength(2);
      expect(calls[1][2]).toMatchObject({ timezone: 'Asia/Taipei', chartPeriod: '7d' });
      expect(calls[1][2].endAt - calls[1][2].startAt).toBe(7 * 86400000 - 1);
      expect(calls.every(call => call[4] === 'report-token' && call[5] === '')).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-09-06' } });
    await waitFor(() => {
      const active = view.client
        .getQueryCache()
        .getAll()
        .find(query => query.queryKey[0] === 'liekan-shared-report' && query.isActive());
      expect((active?.queryKey[3] as any)?.startAt).toBe(Date.parse('2026-09-05T16:00:00Z'));
    });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-09-05' } });
    await screen.findByRole('heading', { name: '读取失败' });
    expect(screen.getByLabelText('结束日期')).toBeEnabled();
    expect(screen.getByRole('heading', { name: '测试网站' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-05' } });
    await screen.findByRole('heading', { name: '访客趋势（UV / PV / 跳出率）' });
    expect(screen.getAllByRole('img', { name: /分享图表/ })).toHaveLength(8);
  });
  it('public goals and funnels fetch every page with the share token and chart conversion count', async () => {
    const configurations = (kind: string) =>
      Array.from({ length: 101 }, (_, i) => ({
        id: `${kind}-${i}`,
        name: `${kind === 'goal' ? '目标' : '漏斗'} ${i}`,
      }));
    mocks.request.mockImplementation(async (_method: string, path: string, params: any) => {
      if (path === '/share/many-goals')
        return {
          token: 'many-goals-token',
          websiteId: 'site-1',
          parameters: {
            overview: false,
            goals: true,
            funnels: true,
            events: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/websites/site-1/goals' || path === '/websites/site-1/funnels') {
        const rows = configurations(path.endsWith('/goals') ? 'goal' : 'funnel');
        return { data: rows.slice((params.page - 1) * 100, params.page * 100), count: rows.length };
      }
      if (path.includes('/goals/') && path.endsWith('/stats'))
        return { num: 2, total: 4, conversions: 19, series: [{ x: '2026-10-01', y: 19 }] };
      if (path.includes('/funnels/') && path.endsWith('/stats'))
        return [{ visitors: 10 }, { visitors: 3 }];
      throw new Error(`Unexpected public request ${path}`);
    });
    mount(<ShareFeatureView slug="many-goals" />, false);
    expect(await screen.findByText('目标 100')).toBeInTheDocument();
    expect(screen.getByText('漏斗 100')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '目标转化' })).toHaveTextContent(
      '"name":"转化次数","values":[19]',
    );
    for (const kind of ['goals', 'funnels'])
      expect(mocks.request).toHaveBeenCalledWith(
        'GET',
        `/websites/site-1/${kind}`,
        { page: 2, pageSize: 100 },
        expect.any(AbortSignal),
        'many-goals-token',
        '',
      );
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'many-goals-token' && call[5] === ''),
    ).toBe(true);
  });
  it('an expired old password token returns the visitor to the password gate', async () => {
    let calls = 0;
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (path === '/share/changing-password')
        return method === 'POST'
          ? {
              token: 'old-token',
              websiteId: 'site-1',
              parameters: {
                overview: true,
                events: false,
                utm: false,
                goals: false,
                allowFilter: false,
              },
            }
          : { requiresPassword: true };
      calls++;
      throw Object.assign(new Error('Share authentication expired'), { status: 401 });
    });
    mount(<ShareFeatureView slug="changing-password" />, false);
    await userEvent.type(await screen.findByLabelText(/分享密码/), 'previous-password');
    await userEvent.click(screen.getByRole('button', { name: '验证并查看' }));
    await waitFor(() => expect(calls).toBeGreaterThan(0));
    expect(await screen.findByRole('heading', { name: '输入分享密码' })).toBeInTheDocument();
  });
  it('a disabled share displays the closed state without requesting statistics', async () => {
    mocks.request.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
    mount(<ShareFeatureView slug="closed-share" />, false);
    expect(await screen.findByRole('heading', { name: '分享已关闭' })).toBeInTheDocument();
    expect(mocks.request.mock.calls.every(call => call[1] === '/share/closed-share')).toBe(true);
  });
  it('a public board excludes components whose statistic sections are not licensed', async () => {
    const board = {
      ...nativeBoard,
      parameters: {
        ...nativeBoard.parameters,
        rows: [
          {
            id: 'public-row',
            columns: [
              nativeBoard.parameters.rows[0].columns[0],
              { id: 'private-events', component: { type: 'EventsChart', title: '受限的事件图表' } },
            ],
          },
        ],
      },
    };
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path === '/share/board-share')
        return {
          token: 'board-share-token',
          boardId: 'board-1',
          websiteIds: ['site-1'],
          parameters: {
            overview: true,
            events: false,
            goals: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/boards/board-1') return board;
      if (path.endsWith('/stats')) return { visitors: 0, pageviews: 0, visits: 0 };
      if (path.endsWith('/pageviews')) return { pageviews: [], sessions: [] };
      throw new Error(`Unlicensed request: ${path}`);
    });
    mount(<ShareFeatureView slug="board-share" />, false);
    expect(await screen.findByRole('heading', { name: '观察看板' })).toBeInTheDocument();
    expect(screen.queryByText('受限的事件图表')).not.toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[1].endsWith('/events/series'))).toBe(false);
    expect(
      mocks.request.mock.calls
        .filter(call => call[1].startsWith('/websites/'))
        .every(call => call[4] === 'board-share-token' && call[5] === ''),
    ).toBe(true);
  });
  it('a public text-only board renders without requesting website statistics', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string) => {
      if (path.startsWith('/share/'))
        return {
          token: 'text-board-token',
          boardId: 'text-board',
          parameters: {
            overview: true,
            events: false,
            goals: false,
            utm: false,
            allowFilter: false,
          },
        };
      if (path === '/boards/text-board')
        return {
          id: 'text-board',
          name: '说明看板',
          type: 'mixed',
          parameters: {
            rows: [
              {
                id: 'row',
                columns: [
                  {
                    id: 'text',
                    component: { type: 'TextBlock', props: { content: '已保存的说明文字' } },
                  },
                ],
              },
            ],
          },
        };
      throw new Error(`Unexpected request: ${path}`);
    });
    mount(<ShareFeatureView slug="text-board" />, false);
    expect(await screen.findByText('已保存的说明文字')).toBeInTheDocument();
    expect(mocks.request.mock.calls.some(call => call[1].startsWith('/websites/'))).toBe(false);
  });
  it('a second share of the same website issues a fresh request with its own token', async () => {
    mocks.request.mockImplementation(async (_method: string, path: string) =>
      path.startsWith('/share/')
        ? {
            token: path.endsWith('one') ? 'token-one' : 'token-two',
            websiteId: 'site-1',
            parameters: {
              overview: true,
              events: false,
              goals: false,
              utm: false,
              allowFilter: false,
            },
          }
        : {
            website: { name: '同一网站', domain: 'example.com' },
            cards: [],
            charts: {},
            tables: { envGrid: [], cityBody: [] },
            insights: [],
            meta: { demo: false },
            states: { human: 'empty' },
            capabilities: { goals: false },
          },
    );
    const { rerender, client } = mount(<ShareFeatureView slug="one" />, false);
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(
          call => call[1] === '/liekan/websites/site-1/shared-report' && call[4] === 'token-one',
        ),
      ).toBe(true),
    );
    rerender(
      <QueryClientProvider client={client}>
        <ShareFeatureView slug="two" />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(
          call => call[1] === '/liekan/websites/site-1/shared-report' && call[4] === 'token-two',
        ),
      ).toBe(true),
    );
  });
});

describe('member dialog completion', () => {
  async function removingMember() {
    context.route = { page: 'team-detail', id: team.id, teamId: team.id };
    mount(<WorkspacePages page="team-detail" />);
    const row = (await screen.findAllByText('manager'))[0].closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: '编辑角色' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '移除成员' }),
    );
    await userEvent.type(screen.getByLabelText(/输入 REMOVE 确认/), 'REMOVE');
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '移除成员' }),
    );
  }
  it('completes member removal even if the subsequent identity refresh fails', async () => {
    mocks.refresh.mockRejectedValue(new Error('刷新暂时不可用'));
    await removingMember();
    await waitFor(() => expect(mocks.del).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.notify).toHaveBeenCalledWith('成员已移除，页面状态刷新失败，请重新读取。');
  });
  it('keeps the dialog open while the post-removal identity refresh is pending', async () => {
    let finish!: () => void;
    mocks.refresh.mockImplementation(() => new Promise<void>(resolve => (finish = resolve)));
    await removingMember();
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: '关闭弹窗' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

it('keeps team creation pending until identity refresh finishes', async () => {
  context.route = { page: 'teams' };
  context.siteId = '';
  let finish!: () => void;
  mocks.refresh.mockImplementation(() => new Promise<void>(resolve => (finish = resolve)));
  const user = userEvent.setup();
  mount(<WorkspacePages page="teams" />);
  const opener = await screen.findByRole('button', { name: '创建团队' });
  await user.click(opener);
  await user.type(screen.getByLabelText(/团队名称/), '已保存的团队');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建团队' }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  try {
    expect(mocks.post).toHaveBeenCalledWith('/teams', { name: '已保存的团队' });
    expect(screen.getByRole('button', { name: '正在创建团队…' })).toBeDisabled();
    await user.keyboard('{Escape}');
    const discard = screen.queryByRole('button', { name: '放弃修改并关闭' });
    if (discard) await user.click(discard);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭弹窗' }));
    const closeDiscard = screen.queryByRole('button', { name: '放弃修改并关闭' });
    if (closeDiscard) await user.click(closeDiscard);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  } finally {
    finish();
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(opener);
  await user.type(screen.getByLabelText(/团队名称/), '新的团队草稿');
  expect(screen.getByLabelText(/团队名称/)).toHaveValue('新的团队草稿');
  expect(mocks.post).toHaveBeenCalledTimes(1);
});

it('reports team creation as saved when the subsequent identity refresh fails', async () => {
  context.route = { page: 'teams' };
  context.siteId = '';
  mocks.refresh.mockRejectedValue(new Error('刷新暂时不可用'));
  const user = userEvent.setup();
  mount(<WorkspacePages page="teams" />);
  await user.click(await screen.findByRole('button', { name: '创建团队' }));
  await user.type(screen.getByLabelText(/团队名称/), '已经创建');
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '创建团队' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mocks.post).toHaveBeenCalledTimes(1);
  expect(mocks.notify).toHaveBeenCalledWith('团队已创建，页面状态刷新失败，请重新读取。');
});
