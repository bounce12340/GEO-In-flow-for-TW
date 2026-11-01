import { analysisCapacity, analysisTransaction } from './analysis-rollups-db';
import type { AnalysisTx } from './analysis-rollups-model';
import { analysisQueryState, requestAnalysisQuery } from './analysis-queries';
import {
  analysisDigest,
  analysisQueryParameters,
  liveAnalysisTargets,
  decodeAnalysisEnvelope,
} from './analysis-query-model';
import {
  dashboardWindow,
  canonicalDashboardParameters,
  dashboardWarmRanges,
  DASHBOARD_FORMAT,
  dashboardInterval,
} from './dashboard-snapshot-model';
import type { CrawlerActor } from './crawler-access';
import { noteBrowserPopulation } from './cache-context';
import { pageReportParts } from '../contracts/page-report';
import { withPublishedRegistry } from './crawler-registry-context';
import { LiekanError } from './errors';
import {
  analysisForegroundDemandSql,
  coldDashboardPrewarmSql,
  foregroundAnalysisQueuedSql,
  pauseIdleDashboardRetries,
} from './dashboard-demand';

type MaintenancePass = { coldRegistered: boolean };
const refreshJob = Symbol('dashboard-refresh-job');

/** Only server-created projections can carry a committed producer to the HTTP handoff. */
export function dashboardRefreshJobId(value: object): string | undefined {
  return (value as { [refreshJob]?: string })[refreshJob];
}

async function lockSnapshotCapacity(tx: AnalysisTx, websiteId: string) {
  // Capacity writers serialize independently of the shared authority held by bounded builds.
  await tx.$queryRawUnsafe(
    'SELECT 1 FROM pg_advisory_xact_lock(1277339413,hashtext($1::text))',
    websiteId,
  );
  // Preserve the mode/epoch fence while allowing other authority readers to keep working.
  await tx.$queryRawUnsafe(
    'SELECT website_id FROM liekan_analysis_site WHERE website_id=$1::uuid FOR SHARE',
    websiteId,
  );
}

async function noteSeedChecked(websiteId: string) {
  // Rotation bookkeeping can wait for the next pass while a bounded build pins authority.
  await analysisTransaction(tx =>
    tx.$executeRawUnsafe(
      `UPDATE liekan_analysis_site SET dashboard_seed_checked_at=clock_timestamp()
       WHERE website_id=(SELECT website_id FROM liekan_analysis_site
         WHERE website_id=$1::uuid FOR NO KEY UPDATE SKIP LOCKED)`,
      websiteId,
    ),
  );
}

type Snapshot = {
  website_id: string;
  query_key: string;
  actor_id: string;
  target: string;
  parameters: Record<string, any>;
  locale: 'zh-CN' | 'en-US';
  strong_version: string;
  epoch: bigint;
  calendar_day: string;
  result: unknown;
  result_bytes: number;
  generated_at: Date;
  data_through: Date;
  dependency_end: Date;
  fingerprint: string;
  job_id: string | null;
  pending_fingerprint: string | null;
  pending_through: Date;
  next_refresh_at: Date;
  last_read_at: Date;
  error_code: string | null;
  recent?: boolean;
};

async function fingerprint(tx: AnalysisTx, row: Pick<Snapshot, 'website_id' | 'epoch'>, end: Date) {
  const [value] = await tx.$queryRawUnsafe<{ fingerprint: string }[]>(
    'SELECT liekan_dashboard_fingerprint($1::uuid,$2::bigint,$3::timestamptz) AS fingerprint',
    row.website_id,
    String(row.epoch),
    end,
  );
  return value.fingerprint;
}

function snapshotKey(
  websiteId: string,
  target: string,
  parameters: Record<string, unknown>,
  locale: string,
  state: { strong: string; epoch: bigint },
  day: string,
) {
  return analysisDigest([
    DASHBOARD_FORMAT,
    websiteId,
    target,
    parameters,
    locale,
    state.strong,
    String(state.epoch),
    day,
  ]);
}

function warmParameters(resource: string, timezone: string) {
  return dashboardWarmRanges(timezone).map((range, index) =>
    analysisQueryParameters('feature:page-report', {
      ...range,
      timezone,
      resource,
      chartPeriod: ['today', '7d', '30d'][index],
      ...(resource.startsWith('ai/')
        ? { endAt: range.endAt + 1, crawlerIdentityScope: 'all', crawlerMetricsVersion: 1 }
        : {}),
    }),
  );
}

function isWarmSelection(row: Pick<Snapshot, 'target' | 'parameters'>) {
  const resource = String(row.parameters.resource);
  if (
    row.target !== 'feature:page-report' ||
    !Object.hasOwn(pageReportParts, resource) ||
    ['logs', 'human/keywords'].includes(resource)
  )
    return false;
  const key = analysisDigest(row.parameters);
  return warmParameters(resource, row.parameters.timezone || 'UTC').some(
    parameters => analysisDigest(parameters) === key,
  );
}

function project(row: Snapshot, website: any, stale: boolean) {
  const envelope = decodeAnalysisEnvelope(row.result, row.website_id);
  const value: any = structuredClone(envelope.value);
  for (const population of envelope.populations) noteBrowserPopulation(row.website_id, population);
  const generatedAt = +new Date(row.generated_at);
  const interval = dashboardInterval(row.target);
  const expiresAt = Date.now() + interval;
  if (row.target === 'feature:page-report' && value) {
    value.website = {
      id: website.id,
      name: website.name,
      domain: website.domain,
      siteNumber: website.siteNumber,
    };
    value.meta = {
      ...value.meta,
      canManage: website.canManage,
      generatedAt,
      expiresAt,
      snapshot: {
        dataThrough: +new Date(row.data_through),
        state: stale ? 'updating' : 'ready',
        intervalMs: interval,
      },
    };
  }
  return {
    ready: true as const,
    value,
    generatedAt,
    expiresAt,
    dataThrough: +new Date(row.data_through),
    snapshotState: stale ? 'updating' : 'ready',
  };
}

/** Only metadata and task registration run in the foreground. Published values survive cache eviction. */
export async function requestDashboardSnapshot(
  websiteId: string,
  actor: CrawlerActor,
  target: string,
  input: Record<string, unknown>,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
  foreground = true,
  maintenance?: MaintenancePass,
) {
  let parameters = analysisQueryParameters(target, input);
  if (Buffer.byteLength(JSON.stringify(parameters)) > 16384)
    throw new LiekanError('统计条件超出上限', 413);
  const readAt = Date.now();
  let window = dashboardWindow(target, parameters, readAt, foreground);
  const state = await analysisTransaction(tx => analysisQueryState(tx, websiteId, actor));
  if (state.mode === 'disabled')
    return requestAnalysisQuery(websiteId, actor, target, input, locale);
  if (!process.env.CLICKHOUSE_URL && state.mode === 'live') {
    const canonical = canonicalDashboardParameters(target, parameters, readAt);
    if (canonical !== parameters) {
      parameters = canonical;
      window = dashboardWindow(target, parameters, readAt, foreground);
    }
  }
  const key = snapshotKey(websiteId, target, parameters, locale, state, window.day);
  let row = await analysisTransaction(async tx => {
    const [row] = await tx.$queryRawUnsafe<Snapshot[]>(
      `UPDATE liekan_dashboard_snapshot SET actor_id=$3::uuid,last_read_at=CASE WHEN $4 THEN clock_timestamp() ELSE last_read_at END
       WHERE website_id=$1::uuid AND query_key=$2 RETURNING *`,
      websiteId,
      key,
      actor.id,
      foreground,
    );
    return row;
  });
  row ||= {
    website_id: websiteId,
    query_key: key,
    actor_id: actor.id,
    target,
    parameters,
    locale,
    strong_version: state.strong,
    epoch: state.epoch,
    calendar_day: window.day,
    dependency_end: new Date(window.dependencyEnd),
    result: null,
    job_id: null,
    error_code: null,
    last_read_at: foreground ? new Date() : new Date(0),
  } as Snapshot;
  let changed = Boolean(row.job_id || row.error_code);
  if (!foreground && row.error_code === 'dashboard-paused')
    throw new LiekanError('后台预热已暂停，打开页面后重试', 503, 'dashboard-paused');
  if (row.result != null) {
    // Access and strong versions are checked again immediately before returning a stored projection.
    let current = await analysisTransaction(tx => analysisQueryState(tx, websiteId, actor));
    if (current.strong !== state.strong || String(current.epoch) !== String(state.epoch))
      throw new LiekanError('统计条件已变化，请重新读取', 409);
    if (foreground && input.refresh !== '1' && row.error_code === 'dashboard-idle') {
      const reused = await analysisTransaction(async tx => {
        const allowed = await analysisQueryState(tx, websiteId, actor);
        if (allowed.strong !== state.strong || String(allowed.epoch) !== String(state.epoch))
          throw new LiekanError('统计条件已变化，请重新读取', 409);
        const [saved] = await tx.$queryRawUnsafe<Snapshot[]>(
          `SELECT * FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2
           AND error_code='dashboard-idle' AND job_id IS NULL FOR UPDATE`,
          websiteId,
          key,
        );
        if (
          !saved ||
          saved.result == null ||
          saved.strong_version !== allowed.strong ||
          String(saved.epoch) !== String(allowed.epoch) ||
          +new Date(saved.data_through) !== window.through ||
          +new Date(saved.dependency_end) !== window.dependencyEnd ||
          (await fingerprint(tx, saved, saved.dependency_end)) !== saved.fingerprint
        )
          return undefined;
        await tx.$executeRawUnsafe(
          `UPDATE liekan_dashboard_snapshot SET error_code=NULL,checked_at=clock_timestamp(),next_refresh_at=$3
           WHERE website_id=$1::uuid AND query_key=$2`,
          websiteId,
          key,
          new Date(window.nextRefresh),
        );
        return {
          row: { ...saved, error_code: null, next_refresh_at: new Date(window.nextRefresh) },
          allowed,
        };
      });
      if (reused) {
        row = reused.row;
        current = reused.allowed;
        changed = false;
      }
    }
    const due = window.hot && +new Date(row.data_through) < window.through;
    if (foreground && (input.refresh === '1' || due || changed)) {
      try {
        const job = await enqueue(row, actor, maintenance);
        if (
          !job.ready &&
          (input.refresh === '1' ||
            !liveAnalysisTargets.includes(target) ||
            Number(parameters.startAt ?? +new Date(parameters.startDate as string)) > Date.now() ||
            !window.hot)
        )
          return { ...job, previousResult: project(row, current.website, true).value };
        if (job.ready === true) return job;
        return Object.defineProperty(project(row, current.website, true), refreshJob, {
          value: job.analysisJob.id,
        });
      } catch (error) {
        // A full queue retains the published value; the next visible read retries admission.
        if (
          (error as any)?.status !== 429 &&
          !['analysis-admission-busy', 'analysis-capacity-limited'].includes((error as any)?.code)
        )
          throw error;
      }
    }
    return project(
      row,
      current.website,
      changed || due || (+new Date(row.next_refresh_at) <= Date.now() && window.hot),
    );
  }
  const job = await enqueue(row, actor, maintenance);
  if (job.ready) return job;
  return {
    ...job,
    ...(row.result != null ? { previousResult: project(row, state.website, true).value } : {}),
  };
}

async function enqueue(row: Snapshot, actor: CrawlerActor, maintenance?: MaintenancePass) {
  if (row.job_id) {
    const [active] = await analysisTransaction(tx =>
      tx.$queryRawUnsafe<{ parameters: Record<string, unknown> }[]>(
        "SELECT parameters FROM liekan_analysis_query WHERE id=$1::uuid AND status IN('queued','running')",
        row.job_id,
      ),
    );
    if (active) {
      if (row.target === 'feature:page-report' && +new Date(row.last_read_at) > Date.now() - 120000)
        await analysisTransaction(async tx => {
          const [deferred] = await tx.$queryRawUnsafe<any[]>(
            `SELECT id FROM liekan_analysis_query WHERE id=$1::uuid AND status='queued'
             AND attempts=0 AND next_attempt_at>clock_timestamp() FOR UPDATE`,
            row.job_id,
          );
          if (!deferred) return;
          const linked = await tx.$queryRawUnsafe<Snapshot[]>(
            'SELECT * FROM liekan_dashboard_snapshot WHERE job_id=$1::uuid FOR UPDATE',
            row.job_id,
          );
          // Every alias shares the producer clock; preserve an existing multi-publication boundary.
          if (linked.length !== 1) return;
          const [saved] = linked;
          if (saved.website_id !== row.website_id || saved.query_key !== row.query_key) return;
          const visible = dashboardWindow(
            saved.target,
            saved.parameters,
            Date.now(),
            true,
            +new Date(saved.data_through || 0),
          );
          if (visible.through >= +new Date(saved.pending_through)) return;
          // A deferred first-day seed adopts the visible cutoff before computation begins.
          const end = new Date(visible.dependencyEnd);
          const pin = await fingerprint(tx, saved, end);
          await tx.$executeRawUnsafe(
            `UPDATE liekan_analysis_query SET next_attempt_at=least(next_attempt_at,
             greatest(clock_timestamp(),$2::timestamptz)) WHERE id=$1::uuid`,
            deferred.id,
            new Date(visible.availableAt),
          );
          await tx.$executeRawUnsafe(
            `UPDATE liekan_dashboard_snapshot SET pending_through=$3,pending_fingerprint=$4,
             dependency_end=$5,next_refresh_at=$6 WHERE website_id=$1::uuid AND query_key=$2`,
            saved.website_id,
            saved.query_key,
            new Date(visible.through),
            pin,
            end,
            new Date(visible.nextRefresh),
          );
        });
      return requestAnalysisQuery(row.website_id, actor, row.target, active.parameters, row.locale);
    }
  }
  const window = dashboardWindow(
    row.target,
    row.parameters,
    Date.now(),
    +new Date(row.last_read_at) > Date.now() - 120000,
    +new Date(row.data_through || 0),
  );
  const end = new Date(window.dependencyEnd);
  const pin = await analysisTransaction(tx => fingerprint(tx, row, end));
  const cold =
    row.target === 'feature:page-report' &&
    row.result == null &&
    +new Date(row.last_read_at) <= Date.now() - 120000;
  if (cold && maintenance?.coldRegistered)
    throw new LiekanError('本轮后台预热已登记', 503, 'dashboard-cold-busy');
  const result = await requestAnalysisQuery(
    row.website_id,
    actor,
    row.target,
    { ...window.parameters, refresh: '1' },
    row.locale,
    async (tx, job) => {
      if (job.strong_version !== row.strong_version || String(job.epoch) !== String(row.epoch))
        throw new LiekanError('统计条件已变化，请重新读取', 409);
      if (cold && ['queued', 'running'].includes(job.status)) {
        // Reuse the admission lock so separate workers cannot register competing cold producers.
        const [lock] = await tx.$queryRawUnsafe(
          'SELECT pg_try_advisory_xact_lock(1277339412) AS locked',
        );
        if (!lock.locked)
          throw new LiekanError('统计任务登记繁忙，请稍后重试', 503, 'analysis-admission-busy');
        const [busy] = await tx.$queryRawUnsafe(
          `SELECT 1 FROM liekan_analysis_query q WHERE q.id<>$1::uuid AND
            ((q.status IN('queued','running') AND ${coldDashboardPrewarmSql})
              OR (q.status='queued' AND ${analysisForegroundDemandSql})) LIMIT 1`,
          job.id,
        );
        if (busy) throw new LiekanError('后台预热等待当前任务', 503, 'dashboard-cold-busy');
      }
      // Admission, per-site capacity, result identity and the queued producer commit together.
      await lockSnapshotCapacity(tx, row.website_id);
      const [existing] = await tx.$queryRawUnsafe(
        'SELECT 1 FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2',
        row.website_id,
        row.query_key,
      );
      if (!existing) {
        const [count] = await tx.$queryRawUnsafe(
          'SELECT count(*)::int AS n FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
          row.website_id,
        );
        if (count.n >= 200) {
          // Background seeds use only free space. A real reader keeps the existing bounded eviction policy.
          if (+new Date(row.last_read_at) === 0)
            throw new LiekanError('后台预热空间已满', 503, 'dashboard-seed-capacity');
          const candidates: Pick<
            Snapshot,
            'query_key' | 'target' | 'parameters' | 'strong_version' | 'epoch'
          >[] = await tx.$queryRawUnsafe(
            `SELECT query_key,target,parameters,strong_version,epoch FROM liekan_dashboard_snapshot
             WHERE website_id=$1::uuid AND job_id IS NULL
               AND last_read_at<=clock_timestamp()-interval '2 minutes'
             ORDER BY (last_read_at=to_timestamp(0)),last_read_at,generated_at NULLS FIRST,checked_at
             FOR UPDATE SKIP LOCKED`,
            row.website_id,
          );
          const victim = candidates.find(
            candidate =>
              candidate.strong_version !== job.strong_version ||
              String(candidate.epoch) !== String(job.epoch) ||
              !isWarmSelection(candidate),
          );
          if (!victim)
            throw new LiekanError('统计结果空间已达上限', 503, 'analysis-capacity-limited');
          await tx.$executeRawUnsafe(
            'DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2',
            row.website_id,
            victim.query_key,
          );
        }
        const capacity = await analysisCapacity(tx, row.website_id);
        if (
          BigInt(capacity.globalBytes) >= BigInt(capacity.globalLimit) ||
          BigInt(capacity.siteBytes) >= BigInt(capacity.siteLimit)
        )
          throw new LiekanError('统计结果空间已达上限', 503, 'analysis-capacity-limited');
        await tx.$executeRawUnsafe(
          `INSERT INTO liekan_dashboard_snapshot(website_id,query_key,actor_id,target,parameters,locale,strong_version,epoch,calendar_day,dependency_end,last_read_at)
       VALUES($1::uuid,$2,$3::uuid,$4,$5::jsonb,$6,$7,$8::bigint,$9,$10,$11)`,
          row.website_id,
          row.query_key,
          actor.id,
          row.target,
          JSON.stringify(row.parameters),
          row.locale,
          row.strong_version,
          String(row.epoch),
          row.calendar_day,
          end,
          row.last_read_at,
        );
      }
      // An active producer keeps its originally pinned boundary and publication fence.
      await tx.$executeRawUnsafe(
        `UPDATE liekan_dashboard_snapshot SET job_id=$3::uuid,pending_fingerprint=$4,pending_through=$5,
       dependency_end=$6,next_refresh_at=$7,error_code=NULL
       WHERE website_id=$1::uuid AND query_key=$2 AND (job_id IS NULL
        OR NOT EXISTS(SELECT 1 FROM liekan_analysis_query q WHERE q.id=job_id AND q.status IN('queued','running')))`,
        row.website_id,
        row.query_key,
        job.id,
        pin,
        new Date(window.through),
        end,
        new Date(window.nextRefresh),
      );
      if (!window.computable)
        await tx.$executeRawUnsafe(
          `UPDATE liekan_analysis_query SET next_attempt_at=greatest(next_attempt_at,$2::timestamptz)
       WHERE id=$1::uuid AND status='queued'`,
          job.id,
          new Date(window.availableAt),
        );
      if (job.status === 'ready' && job.generated_at)
        await publishDashboardSnapshot(tx, { ...job, generated_at: job.generated_at });
    },
  );
  if (cold && !result.ready && maintenance) maintenance.coldRegistered = true;
  return result;
}

export async function dashboardJobClock(tx: AnalysisTx, jobId: string) {
  const rows = await tx.$queryRawUnsafe<Snapshot[]>(
    'SELECT * FROM liekan_dashboard_snapshot WHERE job_id=$1::uuid FOR UPDATE',
    jobId,
  );
  for (const row of rows)
    await tx.$executeRawUnsafe(
      'UPDATE liekan_dashboard_snapshot SET pending_fingerprint=$3 WHERE website_id=$1::uuid AND query_key=$2',
      row.website_id,
      row.query_key,
      await fingerprint(tx, row, row.dependency_end),
    );
  return rows.length ? +new Date(rows[0].pending_through) : undefined;
}

/** Copy a complete result and its population evidence in the producer's publication transaction. */
export async function publishDashboardSnapshot(
  tx: AnalysisTx,
  job: { id: string; result: unknown; generated_at: Date; result_bytes: number },
) {
  const rows = await tx.$queryRawUnsafe<Snapshot[]>(
    'SELECT * FROM liekan_dashboard_snapshot WHERE job_id=$1::uuid FOR UPDATE',
    job.id,
  );
  if (rows.length) {
    const growth = rows.reduce(
      (bytes, row) => bytes + Math.max(0, job.result_bytes - row.result_bytes) * 2,
      0,
    );
    const capacity = await analysisCapacity(tx, rows[0].website_id);
    const physicalReserve = rows.length * job.result_bytes * 2;
    if (
      BigInt(capacity.globalBytes) + BigInt(physicalReserve) >= BigInt(capacity.globalLimit) ||
      BigInt(capacity.siteBytes) + BigInt(growth) >= BigInt(capacity.siteLimit)
    )
      throw new LiekanError('统计结果空间已达上限', 413, 'analysis-capacity-limited');
  }
  for (const row of rows) {
    const current = await fingerprint(tx, row, row.dependency_end);
    if (current !== row.pending_fingerprint) {
      await tx.$executeRawUnsafe(
        `UPDATE liekan_dashboard_snapshot SET job_id=NULL,next_refresh_at=clock_timestamp(),error_code='dashboard-input-changed'
         WHERE website_id=$1::uuid AND query_key=$2`,
        row.website_id,
        row.query_key,
      );
      continue;
    }
    await tx.$executeRawUnsafe(
      `UPDATE liekan_dashboard_snapshot SET result=$3::jsonb,result_bytes=$4,generated_at=$5,
       data_through=pending_through,fingerprint=pending_fingerprint,job_id=NULL,error_code=NULL,checked_at=clock_timestamp()
       WHERE website_id=$1::uuid AND query_key=$2`,
      row.website_id,
      row.query_key,
      JSON.stringify(job.result),
      job.result_bytes,
      job.generated_at,
    );
  }
}

/** Persistent demand is revisited by the worker; ordinary page reads never start statistics SQL. */
export async function pumpDashboardSnapshots(
  maintenance: MaintenancePass = { coldRegistered: false },
) {
  if (process.env.CLICKHOUSE_URL) return;
  await analysisTransaction(pauseIdleDashboardRetries);
  await analysisTransaction(tx =>
    tx.$executeRawUnsafe(
      `DELETE FROM liekan_dashboard_snapshot WHERE (website_id,query_key) IN(
      SELECT website_id,query_key FROM (SELECT website_id,query_key,row_number() OVER(
       PARTITION BY website_id ORDER BY last_read_at DESC) AS rank FROM liekan_dashboard_snapshot WHERE job_id IS NULL) expired WHERE rank>200)`,
    ),
  );
  const rows = await analysisTransaction(tx =>
    tx.$queryRawUnsafe<Snapshot[]>(
      `SELECT d.*,d.last_read_at>clock_timestamp()-interval '2 minutes' AS recent
     FROM liekan_dashboard_snapshot d JOIN website w USING(website_id)
     JOIN liekan_analysis_site s USING(website_id) WHERE w.deleted_at IS NULL AND s.mode='live' AND s.epoch=d.epoch
     AND d.next_refresh_at<=clock_timestamp() AND (d.job_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM liekan_analysis_query q WHERE q.id=d.job_id AND q.status IN('queued','running')))
     ORDER BY (d.last_read_at>clock_timestamp()-interval '2 minutes') DESC,d.next_refresh_at,d.website_id LIMIT 8`,
    ),
  );
  for (const row of rows) {
    try {
      await withPublishedRegistry(async () => {
        const actor = { id: row.actor_id, role: '' };
        const recent = row.recent;
        if (!recent && !isWarmSelection(row)) {
          // Returning readers recheck parked publications through the existing input fences.
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              `UPDATE liekan_dashboard_snapshot SET next_refresh_at='9999-12-31'::timestamptz,
               error_code='dashboard-idle',job_id=NULL,pending_fingerprint=NULL
               WHERE website_id=$1::uuid AND query_key=$2
               AND last_read_at<=clock_timestamp()-interval '2 minutes'
               AND NOT EXISTS(SELECT 1 FROM liekan_analysis_query q
                 WHERE q.id=job_id AND q.status IN('queued','running'))`,
              row.website_id,
              row.query_key,
            ),
          );
          return;
        }
        const current = await analysisTransaction(tx =>
          analysisQueryState(tx, row.website_id, actor),
        );
        if (
          !recent &&
          (
            await analysisTransaction(tx =>
              tx.$queryRawUnsafe<any[]>(`SELECT 1 WHERE ${foregroundAnalysisQueuedSql}`),
            )
          ).length
        )
          return;
        const window = dashboardWindow(
          row.target,
          row.parameters,
          Date.now(),
          recent,
          +new Date(row.data_through || 0),
        );
        if (row.calendar_day !== window.day) {
          // The previous day's published generation remains intact while default demand advances to the new day.
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              "UPDATE liekan_dashboard_snapshot SET next_refresh_at='9999-12-31'::timestamptz,error_code=NULL WHERE website_id=$1::uuid AND query_key=$2",
              row.website_id,
              row.query_key,
            ),
          );
          return;
        }
        if (row.strong_version !== current.strong || String(row.epoch) !== String(current.epoch)) {
          await requestDashboardSnapshot(
            row.website_id,
            actor,
            row.target,
            row.parameters,
            row.locale,
            false,
            maintenance,
          );
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              'DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2',
              row.website_id,
              row.query_key,
            ),
          );
          return;
        }
        const pin = await analysisTransaction(tx =>
          fingerprint(tx, row, new Date(window.dependencyEnd)),
        );
        if (
          row.result != null &&
          pin === row.fingerprint &&
          +new Date(row.data_through) === window.through
        ) {
          // Stable history stays published until its input or rule boundary changes.
          await analysisTransaction(tx =>
            tx.$executeRawUnsafe(
              `UPDATE liekan_dashboard_snapshot SET next_refresh_at=$3,checked_at=clock_timestamp(),dependency_end=$4
             WHERE website_id=$1::uuid AND query_key=$2`,
              row.website_id,
              row.query_key,
              new Date(window.nextRefresh),
              new Date(window.dependencyEnd),
            ),
          );
          return;
        }
        if (window.computable) await enqueue(row, actor, maintenance);
      });
    } catch (error) {
      if ((error as any)?.code === 'dashboard-cold-busy') continue;
      const status = (error as any)?.status;
      await analysisTransaction(tx =>
        tx.$executeRawUnsafe(
          [401, 403, 404].includes(status)
            ? 'DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND query_key=$2'
            : `UPDATE liekan_dashboard_snapshot SET next_refresh_at=clock_timestamp()+interval '${status === 429 ? '5 seconds' : '5 minutes'}',error_code='dashboard-refresh-failed' WHERE website_id=$1::uuid AND query_key=$2`,
          row.website_id,
          row.query_key,
        ),
      );
    }
  }
}

/** Warm the date picker's common ranges at low priority, one cold job per idle pass. */
export async function seedDashboardSnapshots(
  maintenance: MaintenancePass = { coldRegistered: false },
) {
  if (maintenance.coldRegistered) return;
  if (
    (
      await analysisTransaction(tx =>
        tx.$queryRawUnsafe<any[]>(
          `SELECT 1 WHERE ${foregroundAnalysisQueuedSql} OR EXISTS(
            SELECT 1 FROM liekan_analysis_query q WHERE q.status IN('queued','running') AND ${coldDashboardPrewarmSql})`,
        ),
      )
    ).length
  )
    return;
  const sites = await analysisTransaction(tx =>
    tx.$queryRawUnsafe<{ website_id: string; actor_id: string }[]>(
      `SELECT w.website_id,coalesce(w.user_id,(SELECT tu.user_id FROM team_user tu JOIN "user" u USING(user_id)
      WHERE tu.team_id=w.team_id AND u.deleted_at IS NULL ORDER BY tu.user_id LIMIT 1),
      (SELECT user_id FROM "user" WHERE role='admin' AND deleted_at IS NULL ORDER BY user_id LIMIT 1)) AS actor_id
     FROM website w JOIN liekan_analysis_site s USING(website_id) WHERE w.deleted_at IS NULL AND s.mode='live'
     ORDER BY s.dashboard_seed_checked_at NULLS FIRST,w.website_id LIMIT 8`,
    ),
  );
  for (const site of sites) {
    if (!site.actor_id) continue;
    const remembered = await analysisTransaction(tx =>
      tx.$queryRawUnsafe<{ timezone: string; locale: 'zh-CN' | 'en-US' }[]>(
        `SELECT parameters->>'timezone' AS timezone,locale FROM liekan_dashboard_snapshot
       WHERE website_id=$1::uuid AND last_read_at>clock_timestamp()-interval '7 days'
       GROUP BY 1,2 ORDER BY max(last_read_at) DESC LIMIT 8`,
        site.website_id,
      ),
    );
    const resources = [
      'overview',
      'human/overview',
      ...Object.keys(pageReportParts).filter(
        x => !['overview', 'human/overview', 'logs', 'human/keywords'].includes(x),
      ),
    ];
    const scopes = [
      ...new Map(
        [{ timezone: 'Asia/Taipei', locale: 'zh-CN' as const }, ...remembered]
          .filter(x => x.timezone)
          .map(x => [`${x.timezone}:${x.locale}`, x]),
      ).values(),
    ].slice(0, Math.max(1, Math.floor(160 / (resources.length * 3))));
    const actor = { id: site.actor_id, role: '' };
    const current = await withPublishedRegistry(() =>
      analysisTransaction(tx => analysisQueryState(tx, site.website_id, actor)),
    ).catch(() => null);
    if (!current) continue;
    const candidates = [0, 1, 2].flatMap(rangeIndex =>
      scopes.flatMap(({ timezone, locale }) =>
        resources.map(resource => {
          const parameters = warmParameters(resource, timezone)[rangeIndex];
          const key = snapshotKey(
            site.website_id,
            'feature:page-report',
            parameters,
            locale,
            current,
            dashboardWindow('feature:page-report', parameters).day,
          );
          return { parameters, locale, key };
        }),
      ),
    );
    const existing = await analysisTransaction(async tx => {
      // Share the capacity lock with foreground registration before reclaiming result space.
      await lockSnapshotCapacity(tx, site.website_id);
      const protectedKeys = candidates.map(candidate => candidate.key);
      await tx.$executeRawUnsafe(
        `DELETE FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid AND target='feature:page-report'
         AND last_read_at=to_timestamp(0) AND job_id IS NULL AND NOT(query_key=ANY($2::text[]))`,
        site.website_id,
        protectedKeys,
      );
      // Reserve only missing common selections. Current readers, producers and seeds stay intact.
      await tx.$executeRawUnsafe(
        `WITH capacity AS(
          SELECT greatest(0,count(*)+cardinality($2::text[])
            -count(*) FILTER(WHERE query_key=ANY($2::text[]))-200)::int AS needed
          FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid
        ),victims AS(
          SELECT query_key FROM liekan_dashboard_snapshot
          WHERE website_id=$1::uuid AND NOT(query_key=ANY($2::text[])) AND job_id IS NULL
            AND last_read_at<=clock_timestamp()-interval '2 minutes'
          ORDER BY last_read_at,generated_at NULLS FIRST,checked_at
          LIMIT (SELECT needed FROM capacity) FOR UPDATE SKIP LOCKED
        ) DELETE FROM liekan_dashboard_snapshot d USING victims v
          WHERE d.website_id=$1::uuid AND d.query_key=v.query_key`,
        site.website_id,
        protectedKeys,
      );
      return tx.$queryRawUnsafe<{ query_key: string }[]>(
        'SELECT query_key FROM liekan_dashboard_snapshot WHERE website_id=$1::uuid',
        site.website_id,
      );
    });
    const keys = new Set(existing.map(row => row.query_key));
    let space = Math.max(0, 200 - keys.size);
    for (const { parameters, locale, key } of candidates) {
      if (keys.has(key)) continue;
      if (space === 0) break;
      try {
        const result = await withPublishedRegistry(() =>
          requestDashboardSnapshot(
            site.website_id,
            actor,
            'feature:page-report',
            parameters,
            locale,
            false,
            maintenance,
          ),
        );
        if (!result.ready) {
          await noteSeedChecked(site.website_id);
          return;
        }
        if (!keys.has(key)) {
          keys.add(key);
          space--;
        }
      } catch (error) {
        if ((error as any)?.code === 'dashboard-cold-busy') return;
        /* Quotas and per-site permission failures leave other websites independent. */
      }
    }
    await noteSeedChecked(site.website_id);
  }
}

/** Coordinate bounded common-range prewarming and existing publication maintenance. */
let seedFirst = true;
export async function pumpDashboardDemand() {
  const first = seedFirst;
  seedFirst = !seedFirst;
  const maintenance = { coldRegistered: false };
  if (first) await seedDashboardSnapshots(maintenance);
  await pumpDashboardSnapshots(maintenance);
  if (!first) await seedDashboardSnapshots(maintenance);
}
