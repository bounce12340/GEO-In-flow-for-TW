'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  HistoryRepairDetail,
  HistoryRepairEvidenceInput,
  HistoryRepairEvidenceResult,
  HistoryRepairList,
  HistoryRepairRun,
} from '@/lib/liekan/contracts/history-repair';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { storageLiekanLocale } from '@/lib/liekan/i18n/locale';
import { useManualQuery, useManualRefresh } from '@/lib/liekan/contracts/manual-refresh';
import { downloadHistoryRepair } from '@/lib/liekan/upstream/history-repair-client';
import { useFeature } from './context';
import { HistoryRepairPreview } from './HistoryRepairPreview';
import {
  Badge,
  Body,
  Button,
  Check,
  Definition,
  DialogActions,
  Field,
  LiekanDialog,
  LinkButton,
  Metrics,
  Notice,
  Panel,
  Select,
  Table,
  Tabs,
} from './ui';
import {
  historyEvidenceRecords,
  createHistoryManifest,
  forgetHistoryUpload,
  repairEvidenceErrorLabels,
  repairActionId,
  repairCount,
  repairDifference,
  repairStatusLabels,
  repairLimitationLabels,
  repairErrorLabels,
  repairAuditLabels,
  runningRepairStatuses,
} from './historyRepairUi';

const endpoint = '/liekan/history-repair';
type Bookmark = {
  uploadId: string;
  generation: string;
  name: string;
  size: number;
  modified: number;
  source: string;
  steps: Record<string, number>;
};
type BatchPreview = { websiteId: string; name: string; run: HistoryRepairRun };

export function HistoryRepairPage() {
  const c = useFeature(),
    i18n = useLiekanI18n();
  const reading = useManualRefresh();
  const listingRead = useManualQuery<HistoryRepairList>({
    queryKey: ['history-repair-list', c.user.id],
    queryFn: ({ signal }) => c.api.get<HistoryRepairList>(endpoint, undefined, signal),
  });
  const [list, setList] = useState<HistoryRepairList>();
  const [batch, setBatch] = useState<BatchPreview[]>();
  const [batchResults, setBatchResults] = useState<
    { id: string; name: string; message: string; ok: boolean }[]
  >([]);
  const [batchPartial, setBatchPartial] = useState(false);
  const [siteLoading, setSiteLoading] = useState(false);
  const [siteId, setSiteId] = useState(c.query.websiteId || '');
  const [detail, setDetail] = useState<HistoryRepairDetail>();
  const [days, setDays] = useState<HistoryRepairDetail['days']>();
  const pageCursors = useRef<{ days: (string | undefined)[]; actions: (string | undefined)[] }>({
    days: [undefined],
    actions: [undefined],
  });
  const [audit, setAudit] = useState<HistoryRepairDetail['actions']>();
  const [tab, setTab] = useState(c.query.tab === 'history' ? 'history' : 'pending');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false),
    [partial, setPartial] = useState(false);
  const [fileInputVersion, setFileInputVersion] = useState(0);
  const [file, setFile] = useState<File>(),
    [source, setSource] = useState('');
  const [uploadErrors, setUploadErrors] = useState<{ line: number; code: string }[]>([]);
  const [uploadId, setUploadId] = useState(''),
    [uploaded, setUploaded] = useState(0);
  const controller = useRef<AbortController>(null),
    mutation = useRef(false);
  const currentSite = useRef(siteId);
  currentSite.current = siteId;
  const actor = useRef(c.user.id);
  actor.current = c.user.id;
  const manualEpoch = `${reading?.page.token}:${reading?.page.round}`;
  const lastManualRead = useRef({ epoch: manualEpoch, siteId, actorId: c.user.id });
  const run = detail?.run,
    preview = run?.preview;
  const site = list?.websites.find(item => item.id === siteId);
  const n = (value: unknown) => i18n.system(repairCount(value, i18n.locale));
  const date = (value: string) =>
    value
      ? new Date(value).toLocaleString(i18n.locale, { timeZone: c.range.timezone })
      : i18n.text('未提供');
  const scoped = (id = siteId) => `/liekan/websites/${id}/history-repair`;

  useEffect(() => {
    setSiteId(c.query.websiteId || '');
  }, [c.query.websiteId]);
  const selectSite = (id: string) => {
    setSiteId(id);
    c.navigate('history-repair', {
      websiteId: id || undefined,
      tab: tab === 'history' ? 'history' : undefined,
    });
  };

  async function loadList(signal?: AbortSignal) {
    const result = await c.api.get<HistoryRepairList>(endpoint, undefined, signal);
    if (!signal?.aborted) setList(result);
    return result;
  }
  async function loadSite(
    view = 'status',
    params: Record<string, unknown> = {},
    signal = controller.current?.signal,
  ) {
    const id = siteId;
    if (!id) return;
    const result = await c.api.get<HistoryRepairDetail>(
      scoped(id),
      { view, pageSize: 50, ...params },
      signal,
    );
    if (signal?.aborted || currentSite.current !== id) return;
    setDetail(result);
    if (view === 'days') {
      const index = Number(params.page || 1) - 1;
      pageCursors.current.days[index] = params.cursor as string | undefined;
      setDays(result.days);
    }
    if (view === 'actions') {
      const index = Number(params.page || 1) - 1;
      pageCursors.current.actions[index] = params.cursor as string | undefined;
      setAudit(result.actions);
    }
    return result;
  }
  useEffect(() => {
    setSelected([]);
    setBatch(undefined);
    setBatchResults([]);
  }, [c.user.id]);
  useEffect(() => {
    setList(listingRead.data);
    setLoading(listingRead.isPending);
    if (listingRead.error) setError(listingRead.error.message);
  }, [listingRead.data, listingRead.error, listingRead.isPending]);
  useEffect(() => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setDetail(undefined);
    setDays(undefined);
    setAudit(undefined);
    pageCursors.current = { days: [undefined], actions: [undefined] };
    setError('');
    setMessage('');
    setConfirming(false);
    setPartial(false);
    setFile(undefined);
    setSource('');
    setUploadId('');
    setUploaded(0);
    setUploadErrors([]);
    setSiteLoading(!!siteId);
    if (siteId)
      void loadSite('status', {}, abort.signal)
        .catch(e => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setSiteLoading(false);
        });
    return () => abort.abort();
  }, [siteId, c.user.id]);
  useEffect(() => {
    const previous = lastManualRead.current;
    const current = { epoch: manualEpoch, siteId, actorId: c.user.id };
    if (previous.siteId !== siteId || previous.actorId !== c.user.id) {
      lastManualRead.current = current;
      return;
    }
    if (previous.epoch === manualEpoch || busy || mutation.current) return;
    lastManualRead.current = current;
    void loadSite().catch(e => {
      if (e.name !== 'AbortError' && currentSite.current === siteId && actor.current === c.user.id)
        setError(e.message);
    });
  }, [siteId, c.user.id, manualEpoch, busy]);
  useEffect(() => {
    if (!run || !runningRepairStatuses.has(run.status)) return;
    let fetching = false;
    const refresh = async () => {
      if (document.hidden || fetching || mutation.current || controller.current?.signal.aborted)
        return;
      fetching = true;
      try {
        await loadSite();
      } catch (e: any) {
        if (e.name !== 'AbortError') setError(e.message);
      } finally {
        fetching = false;
      }
    };
    const timer = setInterval(refresh, 3000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [siteId, run?.status, c.user.id]);
  useEffect(() => {
    setConfirming(false);
    setPartial(false);
    setDays(undefined);
    setAudit(undefined);
    pageCursors.current = { days: [undefined], actions: [undefined] };
  }, [run?.generation]);

  async function act(work: () => Promise<unknown>, refresh = true) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      if (refresh) {
        await loadSite();
        await loadList();
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || i18n.text('操作失败'));
        if ([401, 403, 404, 409].includes(e.status)) {
          setConfirming(false);
          setDetail(undefined);
        }
        await loadList().catch(() => {});
        await loadSite().catch(() => {});
      }
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const post = (path: string, body: object, id = siteId) => {
    if (
      actor.current !== c.user.id ||
      currentSite.current !== siteId ||
      controller.current?.signal.aborted
    )
      throw new DOMException('Cancelled', 'AbortError');
    return c.api.post(
      scoped(id) + path,
      { ...('expectedRevision' in body && id === siteId && run ? { runId: run.id } : {}), ...body },
      controller.current?.signal,
    );
  };
  async function action(action: string) {
    if (!run) return;
    await act(async () => {
      await post('/action', {
        action,
        actionId: crypto.randomUUID(),
        expectedRevision: run.revision,
      });
      setMessage(i18n.text('操作已提交，后台状态已更新。'));
    });
  }
  async function discardUpload(id: string) {
    if (!run) return;
    await post('/evidence', {
      action: 'discard',
      actionId: crypto.randomUUID(),
      uploadId: id,
      expectedRevision: run.revision,
    });
    forgetHistoryUpload(localStorage, `liekan.history-upload:${c.user.id}:${siteId}:${run.id}`, id);
    if (uploadId === id) setUploadId('');
    setFile(undefined);
    setUploadErrors([]);
    setFileInputVersion(value => value + 1);
  }
  async function upload() {
    if (!file || !run || !source.trim()) return;
    const id = siteId,
      owner = c.user.id,
      generation = run.generation;
    const key = `liekan.history-upload:${owner}:${id}:${run.id}`;
    let bookmark: Bookmark | undefined;
    try {
      bookmark = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      /* No request data is persisted. */
    }
    if (
      !bookmark ||
      bookmark.generation !== generation ||
      bookmark.name !== file.name ||
      bookmark.size !== file.size ||
      bookmark.modified !== file.lastModified ||
      bookmark.source !== source.trim() ||
      !bookmark.steps
    )
      bookmark = {
        uploadId: crypto.randomUUID(),
        generation,
        name: file.name,
        size: file.size,
        modified: file.lastModified,
        source: source.trim(),
        steps: {},
      };
    const saveBookmark = () => {
      try {
        localStorage.setItem(key, JSON.stringify(bookmark));
      } catch {
        /* Only upload metadata is retained. */
      }
    };
    saveBookmark();
    setUploadId(bookmark.uploadId);
    let revision = run.revision,
      sequence = 0,
      total = 0,
      bytes = 0;
    setUploadErrors([]);
    let lines: number[] = [];
    let records: Extract<HistoryRepairEvidenceInput, { action: 'append' }>['records'] = [];
    const manifestHash = createHistoryManifest(),
      encoder = new TextEncoder();
    const flush = async () => {
      if (!records.length) return;
      if (
        controller.current?.signal.aborted ||
        currentSite.current !== id ||
        actor.current !== owner
      )
        throw new DOMException('Cancelled', 'AbortError');
      const step = `append:${sequence}`;
      bookmark.steps[step] ??= revision;
      saveBookmark();
      const response = await c.api.post<HistoryRepairEvidenceResult>(
        scoped(id) + '/evidence',
        {
          action: 'append',
          runId: run.id,
          actionId: await repairActionId(`${bookmark.uploadId}:append:${sequence}`),
          uploadId: bookmark.uploadId,
          sequence,
          expectedRevision: bookmark.steps[step],
          source: bookmark.source,
          records,
        },
        controller.current?.signal,
      );
      revision = Math.max(revision, response.revision);
      if (response.errors?.length)
        setUploadErrors(
          response.errors
            .slice(0, 100)
            .map(item => ({ line: lines[item.row - 1] || total + item.row, code: item.code })),
        );
      if (response.rejected || !response.hash)
        throw new Error(i18n.text('证据文件存在无效记录，请修正或撤下该文件。'));
      manifestHash.append(response.hash);
      total += records.length;
      sequence++;
      records = [];
      lines = [];
      bytes = 0;
      setUploaded(total);
    };
    for await (const { record: row, line } of historyEvidenceRecords(file)) {
      const length = encoder.encode(JSON.stringify(row)).byteLength + 2;
      if (records.length >= 1000 || bytes + length > 900 * 1024) await flush();
      records.push(row);
      lines.push(line);
      bytes += length;
    }
    await flush();
    if (!total) throw new Error(i18n.text('文件中没有有效证据记录。'));
    bookmark.steps.finalize ??= revision;
    saveBookmark();
    await c.api.post(
      scoped(id) + '/evidence',
      {
        action: 'finalize',
        runId: run.id,
        actionId: await repairActionId(`${bookmark.uploadId}:finalize`),
        uploadId: bookmark.uploadId,
        expectedRevision: bookmark.steps.finalize,
        chunks: sequence,
        rows: total,
        manifestDigest: manifestHash.finish(),
      },
      controller.current?.signal,
    );
    try {
      localStorage.removeItem(key);
    } catch {
      /* The stored marker contains no visitor evidence. */
    }
    setMessage(i18n.text('证据已接收，请重新生成预览。'));
    setFile(undefined);
    setFileInputVersion(value => value + 1);
  }
  const candidates =
    list?.websites.filter(item => (tab === 'history' ? !!item.run : item.eligible)) || [];
  const active = run && runningRepairStatuses.has(run.status);
  const editable =
    run &&
    !active &&
    !run.activeGeneration &&
    !['invalidated', 'expired', 'cancelled'].includes(run.status);
  const heartbeatStale =
    active &&
    !['queued', 'ready'].includes(run.status) &&
    Date.now() - +new Date(run.updatedAt) > 60000;

  return (
    <>
      <Notice>
        {i18n.text(
          '本次升级专项：先扫描和预览，再确认生效。原始数据与采集时判定保留，关闭页面后后台任务继续运行。',
        )}
      </Notice>
      {error && <Notice tone="red">{i18n.system(error)}</Notice>}
      {message && <Notice>{i18n.system(message)}</Notice>}
      <Tabs
        items={[
          ['pending', i18n.text('待修复网站')],
          ['history', i18n.text('修复记录')],
        ]}
        active={tab}
        onChange={setTab}
      />
      <Panel
        title={i18n.text('选择网站')}
        actions={
          <Button disabled={busy || loading} onClick={() => act(() => loadList())}>
            {i18n.text('刷新')}
          </Button>
        }
      >
        <Body>
          {loading ? (
            <p role="status">{i18n.text('正在读取修复任务')}</p>
          ) : !list ? (
            <Notice>{i18n.text('未能读取网站列表，请重新读取。')}</Notice>
          ) : !list.supported ? (
            <Notice>{i18n.text('历史数据修复当前支持 PostgreSQL')}</Notice>
          ) : (
            <>
              <Select
                label={i18n.text('网站')}
                value={siteId}
                disabled={busy}
                onChange={e => selectSite(e.target.value)}
                options={[
                  ['', i18n.text('请选择网站')],
                  ...(list?.websites || []).map(
                    item => [item.id, `${item.name} · ${item.domain}`] as [string, string],
                  ),
                ]}
              />
              <Table
                mobile
                columns={['网站', '状态', '操作']}
                rowKeys={candidates.map(item => item.id)}
                rows={candidates.map(item => [
                  <Check
                    checked={selected.includes(item.id)}
                    disabled={busy || !item.eligible || !!item.run?.activeGeneration}
                    onChange={e =>
                      setSelected(
                        e.target.checked
                          ? [...selected, item.id]
                          : selected.filter(id => id !== item.id),
                      )
                    }
                  >
                    {item.name}
                  </Check>,
                  <Badge>{i18n.system(repairStatusLabels[item.status])}</Badge>,
                  <Button disabled={busy} onClick={() => selectSite(item.id)}>
                    {i18n.text('查看详情')}
                  </Button>,
                ])}
                empty={i18n.text(
                  '没有可管理且符合本次升级条件的网站。示例站和升级后新增的网站无需专项修复。',
                )}
              />
              <div className="form-actions">
                <Button
                  disabled={busy || !selected.length}
                  onClick={() =>
                    act(async () => {
                      const results = [];
                      for (const id of selected) {
                        const name = list.websites.find(item => item.id === id)?.name || id;
                        try {
                          await post(
                            '/scan',
                            {
                              actionId: crypto.randomUUID(),
                              timezone: c.range.timezone,
                              locale: storageLiekanLocale(i18n.locale),
                            },
                            id,
                          );
                          results.push({
                            id,
                            name,
                            message: i18n.text('扫描任务已提交'),
                            ok: true,
                          });
                        } catch (e: any) {
                          results.push({
                            id,
                            name,
                            message: e.message || i18n.text('操作失败'),
                            ok: false,
                          });
                        }
                        setBatchResults([...results]);
                      }
                      setMessage(i18n.text('所选网站已分别处理，请查看各站回执。'));
                      setSelected([]);
                    })
                  }
                >
                  {i18n.text('扫描所选网站')}
                </Button>
                <Button
                  disabled={busy || !selected.length}
                  onClick={() =>
                    act(async () => {
                      const previews: BatchPreview[] = [],
                        results = [];
                      for (const id of selected) {
                        const name = list.websites.find(item => item.id === id)?.name || id;
                        try {
                          const value = await c.api.get<HistoryRepairDetail>(
                            scoped(id),
                            { view: 'preview' },
                            controller.current?.signal,
                          );
                          if (value.run?.status !== 'ready' || !value.run.preview?.complete)
                            throw new Error(i18n.text('该网站的预览尚未准备完成。'));
                          previews.push({ websiteId: id, name, run: value.run });
                        } catch (e: any) {
                          results.push({
                            id,
                            name,
                            message: e.message || i18n.text('操作失败'),
                            ok: false,
                          });
                        }
                      }
                      setBatchResults(results);
                      setBatchPartial(false);
                      if (previews.length) setBatch(previews);
                    })
                  }
                >
                  {i18n.text('预览并确认所选网站')}
                </Button>
                {(list as HistoryRepairList & { nextCursor?: string })?.nextCursor && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        const value = await c.api.get<HistoryRepairList & { nextCursor?: string }>(
                          endpoint,
                          { cursor: (list as any).nextCursor },
                          controller.current?.signal,
                        );
                        setList({
                          ...value,
                          websites: [
                            ...list.websites,
                            ...value.websites.filter(
                              item => !list.websites.some(old => old.id === item.id),
                            ),
                          ],
                        });
                      }, false)
                    }
                  >
                    {i18n.text('加载更多网站')}
                  </Button>
                )}
              </div>
              {batchResults.length > 0 && (
                <Table
                  columns={['网站', '处理回执']}
                  rows={batchResults.map(result => [
                    result.name,
                    <span role={result.ok ? 'status' : 'alert'}>
                      {i18n.system(result.message)}
                    </span>,
                  ])}
                />
              )}
            </>
          )}
        </Body>
      </Panel>
      {siteId && (
        <Panel
          title={site?.name || i18n.text('网站修复详情')}
          subtitle={site?.domain}
          actions={
            <Button disabled={busy} onClick={() => act(() => loadSite())}>
              {i18n.text('重新读取')}
            </Button>
          }
        >
          <Body>
            {!detail ? (
              <p role="status">
                {i18n.text(siteLoading ? '正在读取修复任务' : '未能读取任务，请重新读取。')}
              </p>
            ) : (
              <>
                <Notice tone="amber">
                  {i18n.text(
                    '历史 UA 缺失且无法精确关联原事件时，不能准确重新识别浏览访客。证据不足会单列，不会按日志请求数扣减访客。',
                  )}
                </Notice>
                {!detail.eligible && (
                  <Notice>{i18n.text('该网站不属于本次升级专项的可执行范围。')}</Notice>
                )}
                {run && (
                  <>
                    <Definition
                      items={[
                        [i18n.text('状态'), i18n.system(repairStatusLabels[run.status])],
                        [i18n.text('冻结时间'), date(run.frozenAt)],
                        [i18n.text('最近更新'), date(run.updatedAt)],
                        [i18n.text('固定任务时区'), run.preview?.timezone || i18n.text('准备中')],
                      ]}
                    />
                    {active && (
                      <div aria-live="polite">
                        <label>
                          {run.status === 'scanning'
                            ? i18n.text('正在扫描历史范围')
                            : i18n.text('后台处理进度')}{' '}
                          {run.status !== 'scanning' && `${run.progress}%`}
                        </label>
                        {run.status !== 'scanning' && (
                          <progress
                            aria-label={i18n.text('后台处理进度')}
                            max={100}
                            value={run.progress}
                            style={{ width: '100%', accentColor: '#0f62fe' }}
                          />
                        )}
                        <p>{i18n.text('已处理 {v0} 条', [n(run.counts.processed)])}</p>
                      </div>
                    )}
                    {heartbeatStale && (
                      <Notice tone="amber">
                        {i18n.text('正在等待后台恢复，已提交的进度会保留。')}
                      </Notice>
                    )}
                    {run.scopeChanged && (
                      <Notice tone="amber">
                        {i18n.text('历史范围出现变化，需要重新生成预览。已生效结果仍然保留。')}
                      </Notice>
                    )}
                    {run.errorCode && (
                      <Notice tone="amber">
                        {i18n.system(
                          repairErrorLabels[run.errorCode] ||
                            '任务需要处理，请重新读取并按提示重试。',
                        )}
                      </Notice>
                    )}
                    {preview && <HistoryRepairPreview preview={preview} />}
                  </>
                )}
                <div className="form-actions">
                  {detail.eligible && !run?.activeGeneration && !active && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          post('/scan', {
                            actionId: crypto.randomUUID(),
                            timezone: c.range.timezone,
                            locale: storageLiekanLocale(i18n.locale),
                          }),
                        )
                      }
                    >
                      {i18n.text('扫描历史数据')}
                    </Button>
                  )}
                  {editable && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          post('/preview', {
                            actionId: crypto.randomUUID(),
                            expectedRevision: run.revision,
                          }),
                        )
                      }
                    >
                      {i18n.text('重新生成预览')}
                    </Button>
                  )}
                  {run?.status === 'ready' && preview?.complete && (
                    <Button
                      primary
                      disabled={busy}
                      onClick={() => {
                        setPartial(false);
                        setConfirming(true);
                      }}
                    >
                      {i18n.text('确认并生效')}
                    </Button>
                  )}
                  {active && (
                    <Button disabled={busy} onClick={() => action('pause')}>
                      {i18n.text('暂停')}
                    </Button>
                  )}
                  {['paused', 'failed'].includes(run?.status) &&
                    run.errorCode !== 'evidence-changed' && (
                      <Button
                        disabled={busy}
                        onClick={() => action(run.status === 'paused' ? 'resume' : 'retry')}
                      >
                        {i18n.text('继续处理')}
                      </Button>
                    )}
                  {run &&
                    !run.activeGeneration &&
                    ![
                      'completed',
                      'completed_limited',
                      'cancelled',
                      'rolled_back',
                      'invalidated',
                    ].includes(run.status) && (
                      <Button disabled={busy} onClick={() => action('cancel')}>
                        {i18n.text('取消任务')}
                      </Button>
                    )}
                  {run?.activeGeneration && (
                    <Button danger disabled={busy} onClick={() => setConfirming(true)}>
                      {i18n.text('回退本次修复')}
                    </Button>
                  )}
                  {preview && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          const result = await downloadHistoryRepair(
                            siteId,
                            run.generation,
                            i18n.locale,
                            controller.current.signal,
                          );
                          const url = URL.createObjectURL(
                            new Blob([result.csv], { type: 'text/csv;charset=utf-8' }),
                          );
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = result.filename;
                          link.click();
                          setTimeout(() => URL.revokeObjectURL(url), 1000);
                        })
                      }
                    >
                      {i18n.text('导出修复记录')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </Body>
        </Panel>
      )}
      {editable && (
        <Panel
          title={i18n.text('补充历史证据（可选）')}
          subtitle={i18n.text('仅接受能对应浏览采集事件的 JSONL，不接受按时间或路径猜测关联。')}
        >
          <Body>
            {uploadErrors.length > 0 && (
              <Table
                columns={['文件行号', '校验说明']}
                rows={uploadErrors.map(item => [
                  String(item.line),
                  i18n.system(repairEvidenceErrorLabels[item.code] || '该行证据无法用于本次修复。'),
                ])}
              />
            )}
            <Field
              label={i18n.text('来源说明')}
              value={source}
              maxLength={500}
              disabled={busy}
              onChange={e => setSource(e.target.value)}
            />
            <Field
              key={`${siteId}:${run?.generation}:${fileInputVersion}`}
              label={i18n.text('JSONL 证据文件')}
              type="file"
              accept=".jsonl,.ndjson,application/x-ndjson"
              disabled={busy}
              onChange={e => {
                const chosen = e.target.files?.[0];
                setFile(chosen);
                if (chosen && !source) setSource(chosen.name);
              }}
              help={i18n.text(
                '每行包含 eventId 或 clientEventId，以及 requestUserAgent。UA 只在内存中识别，不保存在修复表。',
              )}
            />
            {detail?.uploads?.length > 0 && (
              <Table
                columns={['来源说明', '状态', '已接收', '无效记录', '操作']}
                rows={detail.uploads.map(upload => [
                  upload.source,
                  i18n.text(
                    upload.discarded ? '已撤下' : upload.finalized ? '已校验' : '上传未完成',
                  ),
                  n(upload.accepted),
                  n(upload.rejected),
                  <Button
                    disabled={busy || upload.discarded}
                    onClick={() =>
                      act(async () => {
                        await discardUpload(upload.id);
                      })
                    }
                  >
                    {i18n.text('撤下该文件')}
                  </Button>,
                ])}
              />
            )}
            {detail?.uploads
              ?.filter(upload => upload.errors?.length > 0)
              .map(upload => (
                <div key={upload.id}>
                  <p>{upload.source}</p>
                  <Table
                    columns={['分块', '记录位置', '校验说明']}
                    rows={upload.errors.map(item => [
                      String(item.sequence + 1),
                      String(item.row),
                      i18n.system(
                        repairEvidenceErrorLabels[item.code] || '该行证据无法用于本次修复。',
                      ),
                    ])}
                  />
                  {upload.moreErrors && (
                    <p>{i18n.text('仅显示前 100 条错误，请修正原文件后重新提交。')}</p>
                  )}
                </div>
              ))}
            {uploaded > 0 && <p role="status">{i18n.text('已接收 {v0} 条', [n(uploaded)])}</p>}
            <div className="form-actions">
              <Button disabled={busy || !file || !source.trim()} onClick={() => act(upload)}>
                {i18n.text('上传并校验证据')}
              </Button>
              {uploadId && !detail?.uploads?.some(item => item.id === uploadId) && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await discardUpload(uploadId);
                    })
                  }
                >
                  {i18n.text('撤下该文件')}
                </Button>
              )}
            </div>
            <p className="metric-note">
              {i18n.text(
                '上传尚未完成时关闭页面，请重新选择原文件续传。规则变化后须重新提供原文件；任务提交后的后台处理可以独立运行。',
              )}
            </p>
          </Body>
        </Panel>
      )}
      {run && (
        <Panel
          title={i18n.text('每日结果与操作记录')}
          actions={
            <>
              <Button disabled={busy} onClick={() => act(() => loadSite('days'))}>
                {i18n.text('查看每日结果')}
              </Button>
              <Button disabled={busy} onClick={() => act(() => loadSite('actions'))}>
                {i18n.text('查看操作记录')}
              </Button>
            </>
          }
        >
          {days && (
            <>
              <Table
                columns={['日期', '修复前 PV', '修复后 PV', '修复前 UV', '修复后 UV']}
                numeric={[1, 2, 3, 4]}
                rows={days.items.map(day => [
                  day.date,
                  n(day.beforePV),
                  n(day.afterPV),
                  n(day.beforeUV),
                  n(day.afterUV),
                ])}
              />
              <div className="form-actions">
                <Button
                  disabled={busy || days.page <= 1}
                  onClick={() =>
                    act(() =>
                      loadSite('days', {
                        page: days.page - 1,
                        cursor: pageCursors.current.days[days.page - 2],
                      }),
                    )
                  }
                >
                  {i18n.text('上一页')}
                </Button>
                <Button
                  disabled={busy || !days.nextCursor}
                  onClick={() =>
                    act(() => loadSite('days', { cursor: days.nextCursor, page: days.page + 1 }))
                  }
                >
                  {i18n.text('下一页')}
                </Button>
              </div>
            </>
          )}
          {audit && (
            <>
              <Table
                columns={['时间', '操作']}
                rows={audit.items.map(item => [
                  date(item.createdAt),
                  i18n.system(repairAuditLabels[item.action] || '后台处理记录'),
                ])}
              />
              <div className="form-actions">
                <Button
                  disabled={busy || audit.page <= 1}
                  onClick={() =>
                    act(() =>
                      loadSite('actions', {
                        page: audit.page - 1,
                        cursor: pageCursors.current.actions[audit.page - 2],
                      }),
                    )
                  }
                >
                  {i18n.text('上一页')}
                </Button>
                <Button
                  disabled={busy || !audit.nextCursor}
                  onClick={() =>
                    act(() =>
                      loadSite('actions', { cursor: audit.nextCursor, page: audit.page + 1 }),
                    )
                  }
                >
                  {i18n.text('下一页')}
                </Button>
              </div>
            </>
          )}
        </Panel>
      )}
      {batch && (
        <LiekanDialog
          title={i18n.text('确认所选网站的修复')}
          size="wide"
          protectUnsaved={false}
          onClose={() => {
            if (!busy) setBatch(undefined);
          }}
        >
          <Notice>{i18n.text('每个网站按下列预览独立确认，失败的网站会保留回执。')}</Notice>
          <Table
            columns={['网站', '修复前 PV', '修复后 PV', '修复前 UV', '修复后 UV', '证据覆盖']}
            numeric={[1, 2, 3, 4]}
            rows={batch.map(item => [
              item.name,
              n(item.run.preview.counts.beforePV),
              n(item.run.preview.counts.afterPV),
              n(item.run.preview.counts.beforeUV),
              n(item.run.preview.counts.afterUV),
              i18n.text(item.run.preview.partial ? '部分覆盖' : '完整覆盖'),
            ])}
          />
          {batch.map(item => (
            <div key={item.websiteId}>
              <p>
                {item.name} · {item.run.preview.timezone}
              </p>
              {item.run.preview.limitations.map(reason => (
                <Notice tone="amber" key={reason}>
                  {i18n.system(
                    repairLimitationLabels[reason] ||
                      '该部分历史证据不足，详细范围请查看修复记录。',
                  )}
                </Notice>
              ))}
            </div>
          ))}
          {batch.some(item => item.run.preview.partial) && (
            <Check checked={batchPartial} onChange={e => setBatchPartial(e.target.checked)}>
              {i18n.text('我已逐站查看预览，确认这些网站存在证据不足的历史范围。')}
            </Check>
          )}
          <DialogActions>
            <Button disabled={busy} onClick={() => setBatch(undefined)}>
              {i18n.text('取消')}
            </Button>
            <Button
              primary
              disabled={busy || (batch.some(item => item.run.preview.partial) && !batchPartial)}
              onClick={() =>
                act(async () => {
                  const results = [];
                  for (const item of batch) {
                    try {
                      await post(
                        '/confirm',
                        {
                          actionId: crypto.randomUUID(),
                          expectedRevision: item.run.revision,
                          runId: item.run.id,
                          generation: item.run.generation,
                          previewDigest: item.run.preview.digest,
                          partialConfirmed: batchPartial,
                        },
                        item.websiteId,
                      );
                      results.push({
                        id: item.websiteId,
                        name: item.name,
                        message: i18n.text('已确认，等待后台校验并生效'),
                        ok: true,
                      });
                    } catch (e: any) {
                      results.push({
                        id: item.websiteId,
                        name: item.name,
                        message: e.message || i18n.text('操作失败'),
                        ok: false,
                      });
                    }
                    setBatchResults([...results]);
                  }
                  setBatch(undefined);
                  setSelected([]);
                })
              }
            >
              {i18n.text('确认并生效')}
            </Button>
          </DialogActions>
        </LiekanDialog>
      )}
      {confirming && run && (
        <LiekanDialog
          title={i18n.text(run.activeGeneration ? '回退本次修复' : '确认历史数据修复')}
          protectUnsaved={false}
          onClose={() => {
            if (!busy) setConfirming(false);
          }}
        >
          <p>{site?.name}</p>
          <Notice tone="amber">
            {i18n.text(
              run.activeGeneration
                ? '回退后恢复本次修复前的统计判定，原始数据和审计记录保留。升级基础过滤继续有效。'
                : '确认后后台校验并统一生效。原始数据保留，证据不足的历史不会被补造或推断。',
            )}
          </Notice>
          {preview?.partial && !run.activeGeneration && (
            <Check checked={partial} onChange={e => setPartial(e.target.checked)}>
              {i18n.text('我已核对证据不足和未处理批次的范围。')}
            </Check>
          )}
          <DialogActions>
            <Button disabled={busy} onClick={() => setConfirming(false)}>
              {i18n.text('取消')}
            </Button>
            <Button
              primary
              disabled={
                busy ||
                (!run.activeGeneration && (!preview?.complete || (preview.partial && !partial)))
              }
              onClick={() =>
                act(async () => {
                  if (run.activeGeneration)
                    await post('/action', {
                      action: 'rollback',
                      actionId: crypto.randomUUID(),
                      expectedRevision: run.revision,
                    });
                  else
                    await post('/confirm', {
                      actionId: crypto.randomUUID(),
                      expectedRevision: run.revision,
                      generation: run.generation,
                      previewDigest: preview.digest,
                      partialConfirmed: partial,
                    });
                  setConfirming(false);
                  setMessage(i18n.text('操作已提交，后台状态已更新。'));
                })
              }
            >
              {i18n.text(run.activeGeneration ? '确认回退' : '确认并生效')}
            </Button>
          </DialogActions>
        </LiekanDialog>
      )}
      <LinkButton page="websites">{i18n.text('返回网站管理')}</LinkButton>
    </>
  );
}
