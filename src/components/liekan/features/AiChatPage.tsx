'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { aiActionLabels, aiSpaceDisplayName } from '@/lib/liekan/contracts/ai-display';

import {
  useManualQuery as useQuery,
  useManualInfiniteQuery as useInfiniteQuery,
  useManualRefresh,
} from '@/lib/liekan/contracts/manual-refresh';
import { useQueryClient } from '@tanstack/react-query';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { CalendarDays, ChevronDown, Sparkles } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DataState } from '@/lib/liekan/contracts/report';
import {
  type AiCatalog,
  type AiConversation,
  type AiConnection,
  type AiMessage,
  type AiRun,
  aiClient,
} from '@/lib/liekan/upstream/ai-client';
import {
  AiButton,
  AiCatalogMore,
  AiModal,
  AiNotice,
  aiError,
  ModelWindow,
  ModuleNotice,
  record,
  styles,
  useAiCatalog,
  useAiRun,
  uuid,
} from './AiShared';
import home from '@/styles/liekan/AiChatHome.module.css';
import { ChatComposer, ChatHome, ChatWebsite, ChatWelcome } from './AiChatHome';
import { ChatActivity, ChatAssistantHeading, ChatCopy, ChatRunDetails } from './AiChatActivity';
import { ConnectionForm, ConnectionTest } from './AiConfigPage';
import { useFeature } from './context';

const dataStateLabels: Record<DataState | 'actual' | 'zero' | 'unknown', string> = {
  available: '实际数据',
  actual: '实际数据',
  empty: '暂无数据',
  zero: '实际值为 0',
  estimated: '估算数据',
  unavailable: '身份指标不可用',
  unsupported: '暂不支持',
  not_connected: '尚未接入',
  unknown: '未知',
};
const sourceLabels: Record<string, string> = {
  logs: 'AI日志',
  goals: '转化目标',
  human: '访客统计',
  catalog: '网站目录',
  aiReferrals: 'AI引荐',
};
function dataStateLabel(value: unknown) {
  const state =
    typeof value === 'string' && Object.hasOwn(dataStateLabels, value)
      ? (value as keyof typeof dataStateLabels)
      : 'unknown';
  return dataStateLabels[state];
}
function sourceLabel(value: string) {
  return Object.hasOwn(sourceLabels, value) ? sourceLabels[value] : '未知来源';
}
const conversationKey = (userId: string, siteId: string, conversationId: string) =>
  ['liekan-ai', userId, 'conversation', siteId, conversationId] as const;
export function AiChatPage() {
  const i18n = useLiekanI18n();
  const c = useFeature();
  const [siteId, setSiteId] = useState(c.query.aiSite || ''),
    [draft, setDraft] = useState(''),
    [selectionHint, setSelectionHint] = useState(false);
  const catalog = useAiCatalog(siteId);
  const reading = useManualRefresh();
  const chooseSite = () => {
    setSelectionHint(true);
    document.querySelector<HTMLSelectElement>('select[data-ai-site-selector]')?.focus();
  };
  useEffect(() => {
    const next = c.query.aiSite || '';
    if (next !== siteId) {
      void reading?.refresh(reading.page.token).catch(() => {});
      setSiteId(next);
    }
  }, [c.query.aiSite, c.query.aiConversation]);
  if (catalog.isPending)
    return (
      <div data-liekan-ai="ai-chat" className={`${styles.chatWorkspace} ${home.page}`}>
        <AiNotice>{i18n.text('正在读取 AI 能力与可访问网站…')}</AiNotice>
      </div>
    );
  if (catalog.error && !catalog.data)
    return (
      <div data-liekan-ai="ai-chat" className={`${styles.chatWorkspace} ${home.page}`}>
        <AiNotice error>{aiError(catalog.error)}</AiNotice>
        <AiButton onClick={() => void catalog.refetch()}>{i18n.text('重新读取')}</AiButton>
      </div>
    );
  const data = catalog.data;
  if (!data) return null;
  const site = data.websites.find(s => s.id === siteId),
    space = data.spaces.find(s => s.kind === site?.space.kind && s.id === site?.space.id);
  const changeSite = (id: string, conversationId?: string) => {
    if (id && id !== siteId) void reading?.refresh(reading.page.token).catch(() => {});
    if (site) setDraft('');
    setSelectionHint(false);
    setSiteId(id);
    c.navigate(
      'ai-chat',
      id ? { aiSite: id, ...(conversationId ? { aiConversation: conversationId } : {}) } : {},
    );
  };
  return (
    <div
      data-liekan-ai="ai-chat"
      className={`${styles.chatWorkspace} ${home.page}`}
      lang={i18n.locale}
    >
      <ModuleNotice catalog={data} />
      <AiCatalogMore query={catalog} />
      {site && space ? (
        <SiteConversation
          key={site.id}
          catalog={data}
          initialQuestion={draft}
          site={site}
          space={space}
          changeSite={changeSite}
        />
      ) : (
        <>
          {siteId && (
            <AiNotice error>{i18n.text('所选网站不可访问或归属已变更，请重新选择。')}</AiNotice>
          )}
          <ChatWelcome />
          <ChatComposer
            question={draft}
            onQuestion={setDraft}
            onSubmit={event => {
              event.preventDefault();
              chooseSite();
            }}
            maxLength={data.limits.maxQuestionCharacters}
            disabled={!data.module.enabled}
            scope={<ChatWebsite websites={data.websites} value="" onChange={changeSite} />}
          />
          <p className={home.hint} role="status">
            {selectionHint
              ? i18n.text('请先选择要分析的网站，问题会为你保留。')
              : i18n.text('选择一个网站，结合你的统计数据开始分析。')}
          </p>
          <ChatHome
            onPrompt={setDraft}
            onChooseSite={chooseSite}
            onHistory={chooseSite}
            disabled={!data.module.enabled}
          />
          {!data.websites.length && (
            <AiNotice>
              {i18n.text('当前账户没有可访问的网站。请先在网站管理添加网站或获取团队权限。')}
            </AiNotice>
          )}
        </>
      )}
    </div>
  );
}
function SiteConversation({
  catalog,
  initialQuestion,
  site,
  space,
  changeSite,
}: {
  catalog: AiCatalog;
  initialQuestion: string;
  site: AiCatalog['websites'][number];
  space: AiCatalog['spaces'][number];
  changeSite: (id: string, conversationId?: string) => void;
}) {
  const i18n = useLiekanI18n();
  const c = useFeature(),
    client = useQueryClient(),
    timezone = c.range.timezone || 'Asia/Taipei';
  const routeScope = c.query.aiSite === site.id;
  const routeConversation =
    routeScope && uuid.test(c.query.aiConversation || '') ? c.query.aiConversation : '';
  const [connectionId, setConnectionId] = useState(''),
    [question, setQuestion] = useState(initialQuestion),
    [setup, setSetup] = useState(false),
    [setupConnection, setSetupConnection] = useState<AiConnection | null>(null),
    [testing, setTesting] = useState(false),
    [sentQuestion, setSentQuestion] = useState(''),
    [conversationId, setConversationId] = useState(routeConversation),
    [observedRoute, setObservedRoute] = useState(routeConversation),
    [switching, setSwitching] = useState(false),
    [pendingConversation, setPendingConversation] = useState<string | null>(null),
    [error, setError] = useState(''),
    [creating, setCreating] = useState(false),
    [reference, setReference] = useState<string | null>(null),
    [deleting, setDeleting] = useState<string | null>(null);
  const [dates, setDates] = useState(() => {
    const now = new Date(),
      day = formatInTimeZone(now, timezone, 'yyyy-MM-dd'),
      start = new Date(`${day}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 6);
    return { start: start.toISOString().slice(0, 10), end: day };
  });
  const task = useAiRun(`liekan-ai:${c.user.id}:analysis:${site.id}`, () => {
    void client.invalidateQueries({ queryKey: ['liekan-ai', c.user.id, 'messages'] });
    void client.invalidateQueries({ queryKey: ['liekan-ai', c.user.id, 'history', site.id] });
  });
  const setupEpoch = useRef(0),
    alive = useRef(true),
    selectionEpoch = useRef(0),
    conversationRef = useRef(conversationId),
    routeRef = useRef(routeConversation),
    pendingSelection = useRef<{ id: string; busy: boolean } | null>(null),
    taskRef = useRef(task),
    contextRef = useRef(c);
  const openSetup = () => {
    setupEpoch.current++;
    setSetup(true);
  };
  const closeSetup = () => {
    setupEpoch.current++;
    setSetup(false);
    setTesting(false);
  };
  const startSetupTest = (connection?: AiConnection) => {
    setupEpoch.current++;
    if (connection) setSetupConnection(connection);
    setTesting(true);
  };
  taskRef.current = task;
  contextRef.current = c;
  routeRef.current = routeConversation;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selectionEpoch.current++;
    };
  }, []);
  const selectConversation = useCallback(
    async (id: string, source: 'internal' | 'route' | 'restore' = 'internal') => {
      if (pendingSelection.current?.id === id && pendingSelection.current.busy) return false;
      const currentTask = taskRef.current;
      const recoveredId = currentTask.metadata?.conversationId;
      if (
        source === 'route' &&
        !pendingSelection.current &&
        id === conversationRef.current &&
        (!recoveredId || recoveredId === id)
      ) {
        pendingSelection.current = null;
        setPendingConversation(null);
        return true;
      }
      // Adopt a restored task only when the URL has no explicit conversation.
      const restoring =
        source === 'restore' &&
        !routeRef.current &&
        !conversationRef.current &&
        !pendingSelection.current;
      closeSetup();
      const epoch = ++selectionEpoch.current;
      pendingSelection.current = { id, busy: true };
      setPendingConversation(id);
      setSwitching(true);
      if (!restoring) {
        const stopped = await currentTask.stop();
        if (!alive.current || epoch !== selectionEpoch.current) return false;
        if (!stopped || !taskRef.current.reset()) {
          pendingSelection.current = { id, busy: false };
          setSwitching(false);
          return false;
        }
      }
      if (!alive.current || epoch !== selectionEpoch.current) return false;
      conversationRef.current = id;
      setConversationId(id);
      setQuestion('');
      setSentQuestion('');
      setReference(null);
      setDeleting(null);
      setCreating(false);
      setError('');
      pendingSelection.current = null;
      setPendingConversation(null);
      setSwitching(false);
      if (source !== 'route')
        contextRef.current.navigate('ai-chat', {
          aiSite: site.id,
          ...(id ? { aiConversation: id } : {}),
        });
      return true;
    },
    [site.id],
  );
  useEffect(() => {
    if (!routeScope || observedRoute === routeConversation) return;
    setObservedRoute(routeConversation);
    void selectConversation(routeConversation, 'route');
  }, [routeScope, routeConversation, observedRoute, selectConversation]);
  const restoredConversation = task.metadata?.conversationId;
  useEffect(() => {
    if (!routeScope || !restoredConversation || !uuid.test(restoredConversation)) return;
    if (!routeRef.current && !conversationRef.current)
      void selectConversation(restoredConversation, 'restore');
    else if (conversationRef.current !== restoredConversation)
      void selectConversation(routeRef.current || conversationRef.current, 'route');
  }, [routeScope, restoredConversation, selectConversation]);
  const conversationInfo = useQuery({
    queryKey: conversationKey(c.user.id, site.id, conversationId),
    queryFn: ({ signal }) => aiClient.conversation(conversationId, signal),
    enabled: !!conversationId && catalog.module.enabled,
    staleTime: 30_000,
    retry: false,
  });
  const conversationVerified =
    !conversationId ||
    (conversationInfo.isSuccess &&
      conversationInfo.data.id === conversationId &&
      conversationInfo.data.websiteId === site.id);
  const realSite =
    conversationInfo.data?.id === conversationId
      ? catalog.websites.find(value => value.id === conversationInfo.data.websiteId)
      : undefined;
  const connections = useQuery({
    queryKey: ['liekan-ai', c.user.id, 'connections', space.kind, space.id],
    queryFn: ({ signal }) => aiClient.connections({ kind: space.kind, id: space.id }, signal),
    enabled: catalog.module.enabled,
    retry: false,
  });
  const usable = (connections.data?.items || []).filter(
    r =>
      r.enabled &&
      r.testState === 'connected' &&
      r.hasKey &&
      r.capabilities.keyVerified.text === true,
  );
  const selected =
    usable.find(r => r.id === connectionId) ||
    (!connectionId ? usable.find(r => r.isDefault) || usable[0] : undefined);
  const history = useInfiniteQuery({
    queryKey: ['liekan-ai', c.user.id, 'history', site.id],
    queryFn: ({ pageParam, signal }) => aiClient.conversations(site.id, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor || undefined,
    enabled: catalog.module.enabled && conversationVerified,
    retry: false,
  });
  const messages = useInfiniteQuery({
    queryKey: ['liekan-ai', c.user.id, 'messages', site.id, conversationId],
    queryFn: ({ pageParam, signal }) => aiClient.messages(conversationId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor || undefined,
    enabled: !!conversationId && catalog.module.enabled && conversationVerified,
    retry: false,
  });
  const allMessages = conversationVerified
    ? messages.data?.pages
        .flatMap(p => p.items)
        .slice()
        .reverse() || []
    : [];
  const routePending = pendingConversation !== null || routeConversation !== observedRoute;
  const busy = task.busy || creating || switching || routePending;
  const showCurrentTask =
    conversationVerified &&
    (!task.metadata?.conversationId || task.metadata.conversationId === conversationId);
  const blocked =
    !catalog.module.enabled ||
    !space.canUse ||
    connections.isPending ||
    !!connections.error ||
    !conversationVerified ||
    busy;
  const needsSetup = !selected && connectionId !== 'local';
  const isLanding =
    !allMessages.length &&
    !sentQuestion &&
    !task.run &&
    !task.preview &&
    !task.busy &&
    !task.recoverable;
  const currentTaskVisible =
    showCurrentTask &&
    !allMessages.some(message => message.runId === task.run?.id) &&
    !!(sentQuestion || task.run || task.preview || task.busy);
  const threadEnd = useRef<HTMLDivElement>(null),
    followAnswer = useRef(true);
  useEffect(() => {
    const check = () => {
      const dock = document.querySelector('[data-ai-composer-dock]')?.getBoundingClientRect();
      const end = threadEnd.current?.getBoundingClientRect();
      followAnswer.current = !!end && end.top <= (dock?.top ?? window.innerHeight) + 120;
    };
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, []);
  useEffect(() => {
    if (sentQuestion) followAnswer.current = true;
  }, [sentQuestion]);
  useEffect(() => {
    if (!isLanding && followAnswer.current) threadEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [task.preview, task.stage, sentQuestion, isLanding]);
  const refreshConnections = () =>
    client.invalidateQueries({
      queryKey: ['liekan-ai', c.user.id, 'connections', space.kind, space.id],
    });
  const finishSetup = async (run: AiRun) => {
    if (
      run.state !== 'completed' ||
      run.operation !== 'test' ||
      run.connectionId !== setupConnection?.id ||
      run.configVersion !== setupConnection.configVersion
    )
      return;
    const epoch = setupEpoch.current;
    await refreshConnections();
    const result = await connections.refetch();
    if (!alive.current || epoch !== setupEpoch.current) return;
    const ready = result.data?.items.find(
      row =>
        row.id === setupConnection?.id &&
        row.enabled &&
        row.hasKey &&
        row.testState === 'connected' &&
        row.configVersion === run.configVersion &&
        row.capabilities.keyVerified.text === true,
    );
    if (ready) {
      setConnectionId(ready.id);
      setTesting(false);
      setSetup(false);
      setSetupConnection(null);
      c.notify('AI 已配置并生效，可以发送刚才的问题。');
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    if (needsSetup) {
      openSetup();
      return;
    }
    setError('');
    const text = question.trim(),
      start = fromZonedTime(`${dates.start}T00:00:00.000`, timezone).getTime(),
      end = fromZonedTime(`${dates.end}T23:59:59.999`, timezone).getTime();
    if (!text || Array.from(text).length > catalog.limits.maxQuestionCharacters) {
      setError(`请填写 1 至 ${catalog.limits.maxQuestionCharacters} 字的问题。`);
      return;
    }
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      end - start + 1 > catalog.limits.maxDays * 86400000 ||
      start > Date.now()
    ) {
      setError(`请选择有效日期范围，上限 ${catalog.limits.maxDays} 天。`);
      return;
    }
    if (connectionId && connectionId !== 'local' && !selected) {
      setError('所选连接已更新，请重新选择当前可用连接。');
      return;
    }
    if (task.recoverable) {
      setError('请先回查原任务。确认任务结束后，可重新发起新调用。');
      return;
    }
    let id = conversationRef.current;
    const epoch = selectionEpoch.current,
      submittedRoute = routeRef.current;
    setCreating(true);
    try {
      if (!id) {
        const created = await aiClient.createConversation(site.id);
        if (created.websiteId !== site.id || !uuid.test(created.id)) throw { code: 'conflict' };
        id = created.id;
        if (
          !alive.current ||
          epoch !== selectionEpoch.current ||
          routeRef.current !== submittedRoute
        )
          return;
        client.setQueryData(conversationKey(c.user.id, site.id, id), created);
        conversationRef.current = id;
        setConversationId(id);
        c.navigate('ai-chat', { aiSite: site.id, aiConversation: id });
      }
      const verified = client
        .getQueriesData<AiConversation>({
          queryKey: conversationKey(c.user.id, site.id, id),
        })
        .map(([, value]) => value)
        .find(value => value?.id === id && value.websiteId === site.id);
      if (verified?.id !== id || verified.websiteId !== site.id) throw { code: 'conflict' };
      if (
        !alive.current ||
        epoch !== selectionEpoch.current ||
        routeRef.current !== submittedRoute ||
        !task.reset()
      )
        return;
      setSentQuestion(text);
      followAnswer.current = true;
      setQuestion('');
      void task.start(
        `/liekan/ai/conversations/${id}/messages`,
        {
          question: text,
          locale: i18n.locale,
          ...(selected ? { connectionId: selected.id } : { localOnly: true }),
          expectedConfigVersion: selected?.configVersion || 1,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          timezone,
        },
        { siteId: site.id, conversationId: id },
      );
    } catch (e) {
      if (alive.current && epoch === selectionEpoch.current) setError(aiError(e));
    } finally {
      if (alive.current && epoch === selectionEpoch.current) setCreating(false);
    }
  };
  return (
    <>
      {!space.canUse && (
        <AiNotice>
          {i18n.text(
            '当前网站所属空间为只读权限，无法执行 AI 分析或付费测试。可以查看你自己的可访问历史。',
          )}
        </AiNotice>
      )}
      {conversationId && catalog.module.enabled && !conversationVerified && (
        <>
          <AiNotice error={!conversationInfo.isPending}>
            {conversationInfo.isPending
              ? i18n.text('正在确认对话所属网站…')
              : conversationInfo.error
                ? aiError(conversationInfo.error)
                : conversationInfo.data?.id !== conversationId
                  ? i18n.text('对话信息与当前地址不匹配，读取与分析已暂停。请新建当前网站对话。')
                  : i18n.text(
                      '对话属于其他网站，当前网站已暂停读取与分析。请新建对话或切换到对话所属网站。',
                    )}
          </AiNotice>
          {!conversationInfo.isPending && (
            <div className={styles.actions}>
              <AiButton disabled={busy} onClick={() => void selectConversation('')}>
                {i18n.text('新建当前网站对话')}
              </AiButton>
              {conversationInfo.error && (
                <AiButton onClick={() => void conversationInfo.refetch()}>
                  {i18n.text('重新确认对话')}
                </AiButton>
              )}
              {realSite && realSite.id !== site.id && (
                <AiButton
                  disabled={busy}
                  onClick={async () => {
                    if (await task.stop()) changeSite(realSite.id, conversationId);
                  }}
                >
                  {i18n.fragment('切换到「', false, true)}
                  {realSite.name}」
                </AiButton>
              )}
            </div>
          )}
        </>
      )}
      {connections.error && (
        <>
          <AiNotice error>{aiError(connections.error)}</AiNotice>
          <AiButton onClick={() => void connections.refetch()}>
            {i18n.text('重新读取连接')}
          </AiButton>
        </>
      )}
      {routePending && (
        <AiNotice error={!switching}>
          {switching
            ? i18n.text('正在确认原任务状态并切换对话…')
            : i18n.text('对话切换未完成，提交已暂停。请确认原任务状态后重试。')}
          {!switching && (
            <AiButton
              onClick={() =>
                void selectConversation(pendingConversation ?? routeRef.current, 'route')
              }
            >
              {i18n.text('重试切换对话')}
            </AiButton>
          )}
        </AiNotice>
      )}
      <div
        className={`${styles.conversationTools} ${home.conversationTools} ${isLanding ? home.landingTools : ''}`}
      >
        <AiButton disabled={busy} onClick={() => void selectConversation('')}>
          {i18n.text('新建对话')}
        </AiButton>
        <details
          data-ai-history="true"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary')?.focus();
            }
          }}
        >
          <summary>{i18n.text('我的历史对话')}</summary>
          <div className={`${styles.history} ${home.historyPanel}`}>
            {!conversationVerified ? (
              <p>{i18n.text('请先确认对话所属网站后查看历史。')}</p>
            ) : history.error ? (
              <AiNotice error>{aiError(history.error)}</AiNotice>
            ) : history.isPending ? (
              <p>{i18n.text('正在读取历史…')}</p>
            ) : !history.data?.pages.some(p => p.items.length) ? (
              <p>{i18n.text('当前网站暂无本人历史对话。')}</p>
            ) : (
              history.data.pages
                .flatMap(p => p.items)
                .map(item => (
                  <div key={item.id}>
                    <AiButton disabled={busy} onClick={() => void selectConversation(item.id)}>
                      {item.title} · {formatInTimeZone(item.updatedAt, timezone, 'MM-dd HH:mm')}
                    </AiButton>
                    <AiButton
                      aria-label={i18n.text('删除对话 {v0}', [item.title])}
                      disabled={busy}
                      onClick={() => setDeleting(item.id)}
                    >
                      {i18n.text('删除')}
                    </AiButton>
                  </div>
                ))
            )}
            {conversationVerified && history.hasNextPage && (
              <AiButton
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                {i18n.text('加载更多对话')}
              </AiButton>
            )}
          </div>
        </details>
      </div>
      {isLanding && <ChatWelcome />}
      {conversationVerified && messages.error && (
        <>
          <AiNotice error>{aiError(messages.error)}</AiNotice>
          <AiButton onClick={() => void selectConversation('')}>{i18n.text('新建对话')}</AiButton>
        </>
      )}
      {conversationVerified && messages.hasNextPage && (
        <AiButton
          disabled={messages.isFetchingNextPage}
          onClick={() => void messages.fetchNextPage()}
        >
          {i18n.text('加载更早消息')}
        </AiButton>
      )}
      <div className={`${styles.conversation} ${home.thread}`} hidden={isLanding}>
        {allMessages.map(message => (
          <HistoryMessage
            key={message.id}
            message={message}
            siteId={site.id}
            onReference={setReference}
            error={message.runId === task.run?.id && task.run?.error ? aiError(task.run.error) : ''}
          />
        ))}
        {showCurrentTask &&
          !allMessages.some(m => m.runId === task.run?.id) &&
          (sentQuestion || task.run || task.preview || task.busy) && (
            <>
              <div className={styles.userMessage} data-ai-user-message>
                {sentQuestion || i18n.text('正在恢复原任务，问题内容从历史读取。')}
              </div>
              <div className={styles.assistantMessage} data-ai-assistant-message>
                <ChatAssistantHeading state={task.stage} />
                {task.run?.state === 'completed' ? (
                  <Answer
                    result={task.run.result}
                    origin={String(record(task.run.result).origin || '')}
                    siteId={site.id}
                    onReference={setReference}
                  />
                ) : (
                  <ChatActivity
                    stage={task.stage}
                    busy={task.busy}
                    preview={task.preview}
                    error={task.run?.error ? aiError(task.run.error) : task.error}
                  />
                )}
                {!task.busy && <ChatRunDetails run={task.run} />}
              </div>
            </>
          )}
      </div>
      <div ref={threadEnd} className={home.threadEnd} aria-hidden="true" />
      {task.error &&
        (!currentTaskVisible || task.busy) &&
        !allMessages.some(message => message.runId === task.run?.id && task.run?.error) && (
          <AiNotice error>{task.error}</AiNotice>
        )}
      {error && <AiNotice error>{i18n.system(error)}</AiNotice>}
      {(task.error || task.run?.error) && !task.recoverable && !task.busy && sentQuestion && (
        <div className={styles.actions}>
          <AiButton
            onClick={() => {
              setQuestion(sentQuestion);
              document.querySelector<HTMLTextAreaElement>('textarea[data-ai-question]')?.focus();
            }}
          >
            {i18n.text('重新填写问题')}
          </AiButton>
          <span className={styles.muted}>{i18n.text('重新发起会创建新调用，可能产生费用。')}</span>
        </div>
      )}
      {task.recoverable && (
        <div className={styles.actions}>
          <AiButton disabled={task.busy} onClick={() => void task.recover()}>
            {i18n.text('回查原任务')}
          </AiButton>
          <span className={styles.muted}>
            {i18n.text('刷新恢复仅查询原任务，不会重复调用模型。')}
          </span>
        </div>
      )}
      <div
        className={isLanding ? undefined : home.composerDock}
        data-ai-composer-dock={!isLanding || undefined}
      >
        <ChatComposer
          question={question}
          onQuestion={setQuestion}
          onSubmit={submit}
          maxLength={catalog.limits.maxQuestionCharacters}
          disabled={
            !catalog.module.enabled ||
            !space.canUse ||
            connections.isPending ||
            !!connections.error ||
            !conversationVerified ||
            creating ||
            switching ||
            routePending
          }
          submitDisabled={busy || (!needsSetup && !question.trim()) || task.recoverable}
          compact={!isLanding}
          busy={busy}
          onStop={() => void task.stop()}
          scope={
            <>
              <ChatWebsite
                websites={catalog.websites}
                value={site.id}
                disabled={creating || switching || routePending}
                onChange={async id => {
                  if (await task.stop()) changeSite(id);
                }}
              />
              <details className={home.datePicker}>
                <summary>
                  <CalendarDays size={15} aria-hidden="true" />
                  {dates.start.slice(5)}
                  {i18n.fragment(' 至 ', true, true)}
                  {dates.end.slice(5)}
                  <ChevronDown size={13} aria-hidden="true" />
                </summary>
                <div className={home.datePanel}>
                  <label>
                    {i18n.fragment('开始日期', false, true)}
                    <input
                      aria-label={i18n.text('分析开始日期')}
                      type="date"
                      value={dates.start}
                      disabled={busy}
                      onChange={e => setDates(d => ({ ...d, start: e.target.value }))}
                    />
                  </label>
                  <label>
                    {i18n.fragment('结束日期', false, true)}
                    <input
                      aria-label={i18n.text('分析结束日期')}
                      type="date"
                      value={dates.end}
                      disabled={busy}
                      onChange={e => setDates(d => ({ ...d, end: e.target.value }))}
                    />
                  </label>
                  <p>
                    {i18n.fragment('统计时区：', false, true)}
                    {timezone}
                    {i18n.fragment(' · 最长 ', true, true)}
                    {catalog.limits.maxDays}
                    {i18n.fragment(' 天', true, false)}
                  </p>
                </div>
              </details>
              <label className={home.scopeControl}>
                <Sparkles size={14} aria-hidden="true" />
                <select
                  aria-label={i18n.text('分析模型')}
                  value={connectionId || selected?.id || ''}
                  disabled={busy || !space.canUse || !catalog.module.enabled}
                  onChange={e => setConnectionId(e.target.value)}
                >
                  <option value="">{i18n.text('选择模型')}</option>
                  <option value="local">{i18n.text('本地接入指引 · 无模型调用')}</option>
                  {usable.map(row => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.model}
                      {row.isDefault ? i18n.text(' · 默认') : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
            </>
          }
          disclosure={
            needsSetup ? undefined : (
              <details className={home.callInfo}>
                <summary>
                  {selected
                    ? i18n.text('使用脱敏统计，模型调用可能产生费用')
                    : i18n.text('本地指引，0 次供应商调用')}
                  <span>{i18n.text('调用说明')}</span>
                </summary>
                <section className={styles.callDisclosure} aria-label={i18n.text('分析调用说明')}>
                  {selected ? (
                    <>
                      <p>
                        {i18n.fragment('供应商：', false, true)}
                        {catalog.templates.find(t => t.provider === selected.provider)?.name ||
                          i18n.text('自定义兼容接口')}{' '}
                        {i18n.fragment('· 模型：', true, true)}
                        {selected.model}
                      </p>
                      <p>
                        {i18n.fragment('应用上下文窗口：', false, true)}
                        <ModelWindow catalog={catalog} configuration={selected} />
                      </p>
                      <p>
                        {i18n.text(
                          '将外发脱敏汇总、有限样本、本次问题与最多 6 轮历史；调用可能产生供应商费用。',
                        )}
                      </p>
                    </>
                  ) : (
                    <p>
                      {i18n.text('本地统计指引 · 0 次供应商调用。统计依据与问题由当前实例处理。')}
                    </p>
                  )}
                  <p>{i18n.text('请勿输入凭据、密钥或个人资料。')}</p>
                </section>
              </details>
            )
          }
        />
        {!connections.isPending &&
          !connections.error &&
          catalog.module.enabled &&
          space.canUse &&
          needsSetup && (
            <p className={home.hint}>
              {i18n.fragment('配置 AI 后，就能结合网站数据获得分析。', false, true)}
              <button type="button" onClick={openSetup}>
                {i18n.text('去配置')}
              </button>
            </p>
          )}
      </div>
      {isLanding && (
        <ChatHome
          siteId={site.id}
          onPrompt={setQuestion}
          onHistory={() => {
            const history = document.querySelector<HTMLDetailsElement>('[data-ai-history]');
            if (history) {
              history.open = true;
              history.querySelector('summary')?.focus();
            }
          }}
          onChooseSite={() =>
            document.querySelector<HTMLSelectElement>('select[data-ai-site-selector]')?.focus()
          }
          disabled={blocked}
          range={{
            startAt: fromZonedTime(`${dates.start}T00:00:00.000`, timezone).getTime(),
            endAt: fromZonedTime(`${dates.end}T23:59:59.999`, timezone).getTime(),
            timezone,
          }}
        />
      )}
      {setup && !testing && (
        <AiModal
          title={i18n.text('配置 AI，开始分析')}
          subtitle={i18n.text('为「{v0}」连接模型，配置保存在{v1}', [
            site.name,
            aiSpaceDisplayName(space, c.user.id, i18n.system),
          ])}
          onClose={closeSetup}
          wide={space.canManage}
        >
          <div className={styles.modalBody}>
            {setupConnection ? (
              <>
                <h3>
                  {setupConnection.name}
                  {i18n.fragment(' 已保存', true, false)}
                </h3>
                <p>{i18n.text('完成一次连接测试后，模型会自动生效。刚才的问题已保留。')}</p>
                <p className={styles.muted}>
                  {i18n.text('测试会向供应商发送短文本，可能产生费用。')}
                </p>
                <div className={styles.actions}>
                  <AiButton primary onClick={() => startSetupTest()}>
                    {i18n.text('测试连接并启用')}
                  </AiButton>
                  <AiButton onClick={() => setSetupConnection(null)}>
                    {i18n.text('返回配置')}
                  </AiButton>
                </div>
              </>
            ) : space.canManage ? (
              <>
                {(connections.data?.items || [])
                  .filter(row => row.enabled && row.hasKey)
                  .map(row => (
                    <AiButton
                      key={row.id}
                      onClick={() => {
                        startSetupTest(row);
                      }}
                    >
                      {i18n.fragment('测试并使用 ', false, true)}
                      {row.name}
                    </AiButton>
                  ))}
                {(connections.data?.items.length || 0) < catalog.limits.connectionsPerSpace ? (
                  <ConnectionForm
                    currentUserId={c.user.id}
                    catalog={catalog}
                    space={space}
                    embedded
                    onClose={closeSetup}
                    onConflict={refreshConnections}
                    onSave={async row => {
                      setSetupConnection(row);
                      await refreshConnections();
                    }}
                  />
                ) : (
                  <p>{i18n.text('当前空间的 API 数量已达上限，请在 AI配置器管理现有连接。')}</p>
                )}
              </>
            ) : (
              <p>
                {i18n.fragment('请联系', false, true)}
                {space.name}
                {i18n.fragment(
                  '的管理员配置并测试模型，完成后请刷新页面读取可用连接。',
                  true,
                  false,
                )}
              </p>
            )}
          </div>
          <div className={styles.modalFooter}>
            <a className={styles.button} href={c.href('ai-config', { aiSite: site.id })}>
              {i18n.text('打开 AI配置器')}
            </a>
            <AiButton
              onClick={() => {
                closeSetup();
                setConnectionId('local');
              }}
            >
              {i18n.text('先查看本地接入指引')}
            </AiButton>
          </div>
        </AiModal>
      )}
      {setup && testing && setupConnection && (
        <ConnectionTest
          connection={setupConnection}
          catalog={catalog}
          onClose={() => {
            setupEpoch.current++;
            setTesting(false);
          }}
          onFinished={run => void finishSetup(run)}
          onTestStart={() => {
            setupEpoch.current++;
          }}
        />
      )}
      {reference && conversationId && conversationVerified && (
        <ContextSnapshot
          conversationId={conversationId}
          contextId={reference}
          onClose={() => setReference(null)}
        />
      )}
      {deleting && (
        <AiModal title={i18n.text('删除历史对话')} onClose={() => setDeleting(null)}>
          <div className={styles.modalBody}>
            <p>{i18n.text('确认删除该对话和生成时依据？删除后无法继续读取。')}</p>
            {error && <AiNotice error>{i18n.system(error)}</AiNotice>}
          </div>
          <div className={styles.modalFooter}>
            <AiButton onClick={() => setDeleting(null)}>{i18n.text('取消')}</AiButton>
            <AiButton
              primary
              onClick={async () => {
                try {
                  await aiClient.deleteConversation(deleting);
                  if (deleting === conversationId) await selectConversation('');
                  setDeleting(null);
                  await client.invalidateQueries({
                    queryKey: ['liekan-ai', c.user.id, 'history', site.id],
                  });
                } catch (e) {
                  setError(aiError(e));
                }
              }}
            >
              {i18n.text('删除对话')}
            </AiButton>
          </div>
        </AiModal>
      )}
    </>
  );
}
function HistoryMessage({
  message,
  siteId,
  onReference,
  error,
}: {
  message: AiMessage;
  siteId: string;
  onReference: (id: string) => void;
  error: string;
}) {
  const i18n = useLiekanI18n();
  return (
    <>
      <div className={styles.userMessage} data-ai-user-message>
        {message.question}
      </div>
      <div className={styles.assistantMessage} data-ai-assistant-message>
        <ChatAssistantHeading state={message.state === 'completed' ? undefined : message.state} />
        {message.state === 'completed' && message.result ? (
          <Answer
            result={message.result}
            origin={message.origin}
            siteId={siteId}
            onReference={onReference}
          />
        ) : (
          <ChatActivity
            stage={message.state || 'interrupted'}
            busy={false}
            preview=""
            error={
              error ||
              (message.state === 'failed'
                ? i18n.text('这次分析未完成，可重新填写问题后再试。')
                : '')
            }
          />
        )}
      </div>
    </>
  );
}
function safeAction(input: unknown, siteId: string) {
  const value = record(input),
    allowed = [
      'geo-ai',
      'geo-bots',
      'geo-ai-pages',
      'geo-logs',
      'geo-sources',
      'geo-content',
      'geo-conversions',
      'tracking',
    ];
  if (
    !allowed.includes(String(value.action)) ||
    typeof value.href !== 'string' ||
    typeof value.label !== 'string' ||
    !value.href.startsWith('/') ||
    value.href.startsWith('//') ||
    /[\\\p{Cc}]/u.test(value.href)
  )
    return null;
  try {
    const url = new URL(value.href, 'https://liekan.local');
    const sitePath = `/websites/${siteId}/geo`;
    const own =
      (url.pathname === `/liekan/tracking` && url.searchParams.get('websiteId') === siteId) ||
      url.pathname === sitePath ||
      url.pathname.startsWith(`${sitePath}/`);
    return own ? { href: value.href, label: value.label, action: String(value.action) } : null;
  } catch {
    return null;
  }
}
function Answer({
  result,
  origin,
  siteId,
  onReference,
}: {
  result: unknown;
  origin: string;
  siteId: string;
  onReference: (id: string) => void;
}) {
  const i18n = useLiekanI18n();
  const value = record(result);
  if (
    typeof value.summary !== 'string' ||
    !['observations', 'possibleCauses', 'suggestions', 'limitations'].every(k =>
      Array.isArray(value[k]),
    )
  )
    return <AiNotice error>{i18n.text('已完成任务的结果格式无法展示，请回查原任务。')}</AiNotice>;
  const refs = (input: unknown) =>
    Array.isArray(input)
      ? input.map((r, i) => {
          const ref = record(r);
          return typeof ref.contextId === 'string' && uuid.test(ref.contextId) ? (
            <AiButton
              key={`${ref.contextId}:${String(ref.factId)}:${i}`}
              onClick={() => onReference(String(ref.contextId))}
            >
              {ref.historical ? i18n.text('历史依据') : i18n.text('生成时依据')} ·{' '}
              {(
                {
                  summary: i18n.text('概况'),
                  bots: i18n.text('AI 爬虫'),
                  'log-errors': i18n.text('抓取日志'),
                  'ai-referrals': i18n.text('AI 引荐'),
                  pages: i18n.text('页面'),
                  goals: i18n.text('转化'),
                } as Record<string, string>
              )[String(ref.factId)] || i18n.text('统计')}
            </AiButton>
          ) : null;
        })
      : null;
  const items = (key: string, title: string) =>
    (value[key] as unknown[]).length > 0 && (
      <section className={styles.answerSection}>
        <h3>{i18n.system(title)}</h3>
        <ul>
          {(value[key] as unknown[]).map((input, i) => {
            const item = record(input);
            return typeof item.text === 'string' ? (
              <li key={i}>
                <p>{item.text}</p>
                <div className={styles.references}>{refs(item.refs)}</div>
              </li>
            ) : null;
          })}
        </ul>
      </section>
    );
  return (
    <div className={styles.answer}>
      <span className={`${styles.badge} ${origin === 'local' ? styles.neutral : ''}`}>
        {origin === 'local'
          ? i18n.text('本地规则指引 · 未调用模型')
          : origin === 'provider'
            ? i18n.text('AI 分析 · 已校验')
            : i18n.text('来源未知')}
      </span>
      <p className={styles.answerSummary}>{value.summary}</p>
      {Array.isArray(value.metrics) && (
        <div className={styles.metrics}>
          {value.metrics.map((input, i) => {
            const metric = record(input);
            return (
              <div key={i}>
                <small>
                  {typeof metric.label === 'string'
                    ? i18n.system(metric.label)
                    : i18n.text('统计指标')}
                </small>
                <strong>
                  {typeof metric.value === 'number'
                    ? metric.value.toLocaleString(i18n.locale)
                    : i18n.text('未知')}
                </strong>
                <small>{i18n.system(dataStateLabel(metric.state))}</small>
              </div>
            );
          })}
        </div>
      )}
      {items('observations', i18n.text('观察结果'))}
      {items('possibleCauses', i18n.text('可能原因，尚待验证'))}
      {items('suggestions', i18n.text('建议行动'))}
      <details className={home.answerNotes}>
        <summary>{i18n.text('限制与范围')}</summary>
        <ul>
          {(value.limitations as unknown[]).map((text, i) =>
            typeof text === 'string' ? <li key={i}>{text}</li> : null,
          )}
        </ul>
      </details>
      <div className={home.answerTools}>
        <ChatCopy
          text={[
            value.summary,
            ...['observations', 'possibleCauses', 'suggestions'].flatMap(key =>
              (value[key] as unknown[])
                .map(item => record(item).text)
                .filter(text => typeof text === 'string'),
            ),
            ...(value.limitations as unknown[]).filter(text => typeof text === 'string'),
          ].join('\n\n')}
        />
        {typeof value.contextId === 'string' && uuid.test(value.contextId) && (
          <AiButton onClick={() => onReference(String(value.contextId))}>
            {i18n.text('查看生成时依据')}
          </AiButton>
        )}
      </div>
      {Array.isArray(value.actions) && (
        <div className={styles.actions}>
          {value.actions.map((input, i) => {
            const action = safeAction(input, siteId);
            return action ? (
              <a className={styles.button} key={i} href={action.href}>
                {i18n.text(i18n.system(aiActionLabels[action.action]) || action.label)}
              </a>
            ) : null;
          })}
        </div>
      )}
      {typeof value.contextId === 'string' && uuid.test(value.contextId) && (
        <p className={home.answerCaution}>
          {i18n.text('回答基于生成时统计快照，请结合数据覆盖范围判断。')}
        </p>
      )}
    </div>
  );
}
function ContextSnapshot({
  conversationId,
  contextId,
  onClose,
}: {
  conversationId: string;
  contextId: string;
  onClose: () => void;
}) {
  const i18n = useLiekanI18n();
  const visit = useId();
  const c = useFeature(),
    snapshot = useQuery({
      queryKey: ['liekan-ai', c.user.id, 'context', conversationId, contextId, visit],
      queryFn: ({ signal }) => aiClient.context(conversationId, contextId, signal),
      retry: false,
    });
  const facts = snapshot.data?.facts,
    extra = record(facts),
    budget = record(extra.inputBudget),
    clipping = record(budget.trimmed),
    model = record(extra.modelConfiguration);
  return (
    <AiModal title={i18n.text('生成时依据')} onClose={onClose} wide>
      <div className={styles.modalBody}>
        {snapshot.isPending ? (
          <AiNotice>{i18n.text('正在读取本次生成保存的统计快照…')}</AiNotice>
        ) : snapshot.error ? (
          <>
            <AiNotice error>{aiError(snapshot.error)}</AiNotice>
            <AiButton onClick={() => void snapshot.refetch()}>{i18n.text('重新读取依据')}</AiButton>
          </>
        ) : facts ? (
          <>
            <dl className={styles.summary}>
              <dt>{i18n.text('网站')}</dt>
              <dd>{facts.website.name}</dd>
              <dt>{i18n.text('生成时间')}</dt>
              <dd>
                {new Date(facts.generatedAt).toLocaleString(i18n.locale, {
                  timeZone: facts.timeZone,
                })}
              </dd>
              <dt>{i18n.text('统计期间')}</dt>
              <dd>
                {new Date(facts.currentRange.startAt).toLocaleString(i18n.locale, {
                  timeZone: facts.timeZone,
                })}{' '}
                {i18n.fragment('至', true, true)}{' '}
                {new Date(facts.currentRange.endAt).toLocaleString(i18n.locale, {
                  timeZone: facts.timeZone,
                })}
              </dd>
              <dt>{i18n.text('时区')}</dt>
              <dd>{facts.timeZone}</dd>
              <dt>{i18n.text('日志覆盖')}</dt>
              <dd>{i18n.text('未经验证')}</dd>
              <dt>{i18n.text('输入裁剪')}</dt>
              <dd>
                {typeof clipping.historyTurns === 'number' &&
                typeof clipping.logSamples === 'number' &&
                typeof clipping.topRows === 'number'
                  ? i18n.text('历史轮次 {v0} · 日志样本 {v1} · 排名记录 {v2}', [
                      clipping.historyTurns,
                      clipping.logSamples,
                      clipping.topRows,
                    ])
                  : i18n.text('裁剪状态未记录')}
              </dd>
              {typeof model.model === 'string' && (
                <>
                  <dt>{i18n.text('分析模型')}</dt>
                  <dd>
                    {model.model}
                    {i18n.fragment(' · 配置版本 ', true, true)}
                    {String(model.configVersion || i18n.text('未知'))}
                  </dd>
                </>
              )}
              <dt>{i18n.text('快照到期')}</dt>
              <dd>
                {new Date(snapshot.data.expiresAt).toLocaleString(i18n.locale, {
                  timeZone: facts.timeZone,
                })}
              </dd>
            </dl>
            <AiNotice>
              {i18n.fragment('这里展示生成时保存的依据。当前统计页会随新数据变化。', false, true)}
              {facts.rangeNotes.currentDayIncomplete ? i18n.text('当前日期数据尚未完整。') : ''}
              {facts.rangeNotes.endClamped ? i18n.text('结束时间已收束到生成时刻。') : ''}
            </AiNotice>
            {Object.entries(facts.sourceStates).map(([source, state]) => (
              <span key={source} className={styles.badge}>
                {i18n.system(sourceLabel(source))} · {i18n.system(dataStateLabel(state))}
              </span>
            ))}
            <div className={styles.factList}>
              {facts.facts.map(fact => (
                <details key={fact.id}>
                  <summary>
                    {i18n.system(fact.label)} · {i18n.system(dataStateLabel(fact.state))}
                  </summary>
                  <pre>{JSON.stringify(fact.data, null, 2)}</pre>
                </details>
              ))}
            </div>
          </>
        ) : null}
      </div>
      <div className={styles.modalFooter}>
        <AiButton onClick={onClose}>{i18n.text('关闭依据')}</AiButton>
      </div>
    </AiModal>
  );
}
