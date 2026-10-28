'use client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';

import { geographyCoverageText, geographyEmptyText } from '@/lib/liekan/contracts/geography';
import { useFreshQuery } from './context';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import {
  sharedChartPeriod,
  type SharedDateRange,
  type SharedReport,
} from '@/lib/liekan/contracts/shared-report';
import { countryName, geographyLabel } from '@/lib/liekan/contracts/geography';
import styles from '@/styles/liekan/SharedReport.module.css';
import { LoadingLines } from '../DataLoading';
import { InsightRows, ReferenceChart } from '../ReportComponents';
import { formatCellValue, formatMetricValue, formatPercentage, stateLabels } from '../data';
import { Badge, Metrics, QueryState, Table, TableCell } from './ui';

function ReportChart({
  id,
  title,
  subtitle,
  report,
  height = 260,
}: {
  id: string;
  title: string;
  subtitle: string;
  report?: SharedReport;
  height?: number;
}) {
  return (
    <section className={styles.panel} data-liekan-report-panel>
      <div className={styles.panelHead}>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <ReferenceChart id={id} height={height} report={report} />
    </section>
  );
}

export function SharedWebsiteOverview({
  id,
  token,
  cacheKey,
  range,
  request,
  dateControls,
}: {
  id: string;
  token: string;
  cacheKey?: string;
  range: Pick<SharedDateRange, 'startAt' | 'endAt' | 'timezone' | 'chartPeriod'>;
  request: (path: string, params?: any, signal?: AbortSignal) => Promise<any>;
  dateControls?: ReactNode;
}) {
  const i18n = useLiekanI18n();
  const chartPeriod = sharedChartPeriod(range);
  const query = useFreshQuery<SharedReport>(
    {
      queryKey: ['liekan-shared-report', cacheKey || token, id, range, chartPeriod],
      queryFn: ({ signal }) =>
        request(
          `/liekan/websites/${id}/shared-report`,
          {
            startAt: range.startAt,
            endAt: range.endAt,
            timezone: range.timezone,
            chartPeriod,
          },
          signal,
        ),
      retry: false,
      gcTime: 600000,
    },
    { aggregate: true, endAt: range.endAt, timezone: range.timezone },
  );
  const queryClient = useQueryClient();
  const report = query.data;
  const [previousIdentity, setPreviousIdentity] = useState<{
    website: SharedReport['website'];
    demo: boolean;
  }>();
  const accessDenied = [401, 403, 404].includes((query.error as any)?.status);
  useEffect(() => {
    if (accessDenied) {
      setPreviousIdentity(undefined);
      queryClient.removeQueries({
        queryKey: ['liekan-shared-report', cacheKey || token, id],
        type: 'inactive',
      });
    } else if (report) setPreviousIdentity({ website: report.website, demo: report.meta.demo });
  }, [report, accessDenied, queryClient, cacheKey, token, id]);
  const identity = accessDenied
    ? undefined
    : report
      ? { website: report.website, demo: report.meta.demo }
      : previousIdentity?.website.id === id
        ? previousIdentity
        : undefined;
  const date = (time: number) => formatInTimeZone(time, range.timezone, 'MM/dd');
  const period = `${date(range.startAt)} – ${date(range.endAt)}`;
  const trendPeriod =
    range.endAt - range.startAt > 30 * 86400000 ? i18n.text('截至结束日期的近 30 天') : period;
  const metrics = (labels: string[]): [string, ReactNode, ReactNode?, string?][] =>
    labels.map(label => {
      const card = report?.cards.find(card => card.label === label);
      const place = card && report?.meta.geography?.cards?.[card.key];
      return [
        i18n.system(label),
        place && i18n.locale !== 'zh-CN'
          ? label === '海外 TOP1'
            ? countryName(place.country, i18n.locale)
            : geographyLabel(place, i18n.locale)
          : formatMetricValue(card || { label, value: null }, i18n.locale, i18n.system),
        `${i18n.system(card?.detail || stateLabels[card?.state || 'not_connected'])}${card?.state === 'estimated' ? i18n.text(' · 估算') : ''}`,
        ['跳出率', '平均访问时长'].includes(label) ? 'green' : 'blue',
      ];
    });
  const environment = (category: string) =>
    (report?.tables.envGrid || []).filter(row => row.category === category).slice(0, 5);
  const goals = report?.capabilities.goals;
  const crawlerEnabled = report?.meta.aiCrawlerEnabled !== false;
  return (
    <article className={styles.report}>
      <header className={styles.reportHead}>
        <div className={styles.reportToolbar}>
          <div className={styles.identity}>
            <div className={styles.titleRow}>
              <h1>
                {identity?.demo
                  ? identity.website.name.replace(/\s*[（(]示例数据[）)]$/, '')
                  : identity?.website.name || i18n.text('网站流量报告')}
              </h1>
              {identity?.demo && <Badge>{i18n.text('示例数据')}</Badge>}
            </div>
            <p>{identity?.website.domain}</p>
            {identity?.demo && (
              <p className={styles.demoNote}>
                {i18n.text('当前网站为演示站，以下为隔离的示例数据。')}
              </p>
            )}
          </div>
          <div className={styles.dateTools}>
            {dateControls || <p>{period}</p>}
            <p className={styles.timezone}>
              {i18n.fragment('时区：', false, true)}
              {range.timezone}
            </p>
          </div>
        </div>
        <nav aria-label={i18n.text('报告章节')} className={styles.chapters}>
          <a href="#shared-visitors">{i18n.text('访客概览')}</a>
          <a href="#shared-ai">
            {crawlerEnabled ? i18n.text('AI 与来源') : i18n.text('访问与来源')}
          </a>
          <a href="#shared-geography">{i18n.text('地域分布')}</a>
        </nav>
      </header>
      <QueryState readOnly query={query}>
        <section
          id="shared-visitors"
          className={styles.section}
          aria-labelledby="shared-visitors-title"
        >
          <h2 id="shared-visitors-title" className={styles.sectionTitle}>
            {i18n.text('访客概览')}
          </h2>
          <Metrics
            className="five"
            items={metrics(['访客数 UV', '浏览量 PV', '跳出率', '平均访问时长', '新访客占比'])}
          />
          <ReportChart
            id="h1"
            title={i18n.text('访客趋势（UV / PV / 跳出率）')}
            subtitle={i18n.text('{v0} · 浏览器追踪数据', [trendPeriod])}
            report={report}
            height={300}
          />
          <div className={styles.threeColumns}>
            <ReportChart
              id="h2"
              title={i18n.text('访问时段热力')}
              subtitle={i18n.system(`${period} · 24h · ${range.timezone}`)}
              report={report}
            />
            <ReportChart
              id="h3"
              title={i18n.text('设备构成')}
              subtitle={i18n.text('{v0} · 按会话', [period])}
              report={report}
            />
            <section className={styles.panel} data-liekan-report-panel>
              <div className={styles.panelHead}>
                <h2>{i18n.text('浏览器 / OS TOP5')}</h2>
                <p>
                  {period}
                  {i18n.fragment(' · 按会话', true, false)}
                </p>
              </div>
              <div className={styles.environment}>
                {(['browser', 'os'] as const).map(category => (
                  <div key={category}>
                    <h3>{category === 'browser' ? i18n.text('浏览器') : i18n.text('操作系统')}</h3>
                    {query.isPending ? (
                      <LoadingLines />
                    ) : (
                      environment(category).map(row => (
                        <p key={String(row.name)}>
                          <span>{row.name}</span>
                          <span className="num">{formatPercentage(row.share)}</span>
                        </p>
                      ))
                    )}
                    {!query.isPending && !environment(category).length && (
                      <p className="muted">
                        {i18n.system(stateLabels[report?.states.human || 'empty'])}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
        <section id="shared-ai" className={styles.section} aria-labelledby="shared-ai-title">
          <h2 id="shared-ai-title" className={styles.sectionTitle}>
            {crawlerEnabled ? i18n.text('AI 与来源') : i18n.text('访问与来源')}
          </h2>
          <ReportChart
            id="d1"
            title={i18n.system(
              crawlerEnabled ? i18n.text('AI 蜘蛛与浏览访问趋势') : i18n.text('访客浏览趋势'),
            )}
            subtitle={i18n.system(
              `${trendPeriod} · ${crawlerEnabled ? i18n.text('浏览器 PV / 日志 AI 请求') : i18n.text('浏览器 PV')}`,
            )}
            report={report}
            height={300}
          />
          <div className={crawlerEnabled ? styles.threeColumns : styles.twoColumns}>
            {crawlerEnabled && (
              <ReportChart
                id="d2"
                title={i18n.text('AI 蜘蛛构成')}
                subtitle={i18n.text('{v0} · 按请求量', [period])}
                report={report}
              />
            )}
            <ReportChart
              id="d3"
              title={i18n.text('访客来源渠道')}
              subtitle={i18n.text('{v0} · 按会话', [period])}
              report={report}
            />
            <section className={styles.panel} data-liekan-report-panel>
              <div className={styles.panelHead}>
                <h2>{crawlerEnabled ? i18n.text('GEO 关键发现') : i18n.text('访问概况')}</h2>
                <p>
                  {period}
                  {i18n.fragment(' · 数据依据与覆盖情况', true, false)}
                </p>
              </div>
              <InsightRows className={styles.insights} report={report} />
            </section>
          </div>
        </section>
        <section
          id="shared-geography"
          className={styles.section}
          aria-labelledby="shared-geography-title"
        >
          <h2 id="shared-geography-title" className={styles.sectionTitle}>
            {i18n.text('地域分布')}
          </h2>
          <Metrics items={metrics(['覆盖省份', '海外国家/地区', 'TOP1 城市', '海外 TOP1'])} />
          <div className={styles.geography}>
            <ReportChart
              id="g1"
              title={i18n.text('国内省份分布 TOP10')}
              subtitle={i18n.text('{v0} · 按会话数{v1}', [
                period,
                goals ? i18n.text('（含转化率）') : '',
              ])}
              report={report}
              height={320}
            />
            <ReportChart
              id="g2"
              title={i18n.text('海外国家/地区 TOP8')}
              subtitle={i18n.text('{v0} · 按会话数', [period])}
              report={report}
              height={320}
            />
          </div>
          <section className={styles.panel} data-liekan-report-panel>
            <div className={styles.panelHead}>
              <h2>{i18n.text('城市明细 TOP12')}</h2>
              <p>{i18n.system(geographyCoverageText(report?.meta.geographyCoverage))}</p>
            </div>
            <Table
              empty={geographyEmptyText(report?.meta.geographyCoverage)}
              columns={['城市', '会话', '占比', '平均时长', '跳出率', ...(goals ? ['转化率'] : [])]}
              numeric={[1, 2, 3, 4, 5]}
              rows={(report?.tables.cityBody || []).map((row, index) =>
                [
                  'city',
                  'sessions',
                  'share',
                  'duration',
                  'bounceRate',
                  ...(goals ? ['conversionRate'] : []),
                ].map(field => {
                  const place = report?.meta.geography?.tables?.cityBody?.[index];
                  const display =
                    field === 'city' && place && i18n.locale !== 'zh-CN'
                      ? geographyLabel(place, i18n.locale)
                      : formatCellValue(row, field, 'cityBody', i18n.locale, i18n.system);
                  return (
                    <TableCell
                      sortValue={formatCellValue(row, field, 'cityBody')}
                      searchValue={
                        field === 'city' && place
                          ? geographyLabel(place, 'en-US')
                          : formatCellValue(row, field, 'cityBody', 'en-US', i18n.english.system)
                      }
                    >
                      {display}
                    </TableCell>
                  );
                }),
              )}
            />
          </section>
        </section>
      </QueryState>
    </article>
  );
}
