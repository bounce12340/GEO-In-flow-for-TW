'use client';
import { useMemo, useState } from 'react';
import type { CrawlerAnalysisResponse } from '@/lib/liekan/contracts/crawler-analysis';
import {
  analyzeCrawlPurpose,
  type ContentType,
  type CrawlPurpose,
  type CrawlerRegion,
  type DatasetExposure,
} from '@/lib/liekan/crawlers/purpose';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { Badge, Notice, Table, TableCell } from './ui';

const purposeLabels: Record<CrawlPurpose, string> = {
  training_crawl: '训练抓取',
  ai_search_index: 'AI 搜索索引',
  user_triggered_fetch: '用户实时触发获取',
  agent_browsing: 'Agent 代理浏览',
  traditional_search: '传统搜索',
  other: '其他用途',
  unknown: '无法判定',
};
const purposeHelp: Record<CrawlPurpose, string> = {
  training_crawl: '运营方抓取网页用于训练或改进其 AI 模型。允许与否不直接影响 AI 搜索中的引用。',
  ai_search_index: '为 AI 搜索或问答产品建立索引；允许访问通常是被 AI 回答引用的前提。',
  user_triggered_fetch:
    '某位用户在 AI 产品中提问或贴上网址时，AI 实时读取页面。通常不遵循 robots.txt。',
  agent_browsing: 'AI Agent 代替用户浏览网页并可能执行操作。',
  traditional_search:
    '搜索引擎索引。Google 的 AI 摘要与 AI 模式使用 Googlebot 的索引；Bing 索引也支撑 Copilot。',
  other: '广告检查、SEO 工具、链接预览、研究或通用抓取。',
  unknown: '请求未对应到已审核身份。仅凭 UA 无法判断运营方或目的，因此不作推断。',
};
const regionLabels: Record<CrawlerRegion, string> = {
  taiwan: '台湾',
  global: '全球 / 美国',
  japan: '日本',
  korea: '韩国',
  europe: '欧洲',
  china: '中国大陆',
};
const exposureLabels: Record<DatasetExposure, string> = {
  open_dataset: '开放数据集',
  commercial_dataset: '商业数据集',
  operator_model: '运营方模型训练',
  none: '无',
};
const contentLabels: Record<ContentType, string> = {
  html: '网页',
  document: '文件',
  image: '图片',
  media: '音视频',
  data_api: '数据 / API',
  sitemap_feed: '站点地图 / 订阅',
  robots: 'robots.txt',
  llms: 'llms.txt',
  ai_policy: 'AI 政策文件',
  asset: '静态资源',
};
const relationLabels = { both: '两者皆有', fetch_only: '仅获取', referral_only: '仅引荐' };

/** Reads robots.txt from the latest completed public check when that check stored its body. */
function checkedRobots(checks: any[]): string | null {
  for (const check of checks) {
    const robots = check?.result?.robots;
    if (check?.state === 'completed' && robots?.status === 200 && typeof robots.body === 'string')
      return robots.body;
  }
  return null;
}

export function CrawlPurposePanel({
  data,
  checks,
}: {
  data: CrawlerAnalysisResponse;
  checks: any[];
}) {
  const i18n = useLiekanI18n();
  const [pasted, setPasted] = useState('');
  const stored = checkedRobots(checks);
  const robotsText = pasted.trim() ? pasted : stored;
  const result = useMemo(
    () =>
      analyzeCrawlPurpose({
        directory: data.directory,
        bots: data.bots,
        pages: data.pages,
        platforms: data.platforms,
        pagesTruncated: data.pagesTruncated,
        robotsText,
      }),
    [data, robotsText],
  );
  const num = (value: number | null | undefined) =>
    value == null ? i18n.text('待接入') : value.toLocaleString(i18n.locale);
  const purposeCell = (purpose: CrawlPurpose) => (
    <TableCell sortValue={purpose} searchValue={i18n.english.text(purposeLabels[purpose])}>
      {i18n.text(purposeLabels[purpose])}
    </TableCell>
  );
  const distribution = (values: Partial<Record<CrawlPurpose, number>>) =>
    Object.entries(values)
      .sort((a, b) => b[1] - a[1])
      .map(
        ([purpose, count]) => `${i18n.text(purposeLabels[purpose as CrawlPurpose])} ${num(count)}`,
      )
      .join(' · ');
  return (
    <>
      <Notice>
        {i18n.text(
          '目的按蜘蛛目录中已审核的身份类型判定，不根据单次请求猜测。未登记的身份显示为无法判定。',
        )}
      </Notice>
      {result.pagesTruncated && (
        <Notice tone="amber">{i18n.text('页面记录已截断，结果仅覆盖前 1000 条路径。')}</Notice>
      )}
      <h3>{i18n.text('抓取目的')}</h3>
      <Table
        columns={['目的', '请求数', '占比', '身份数', '说明']}
        numeric={[1, 2, 3]}
        static={[4]}
        rows={result.purposes.map(row => [
          purposeCell(row.purpose),
          num(row.requests),
          row.share == null ? '–' : `${row.share}%`,
          num(row.bots),
          i18n.text(purposeHelp[row.purpose]),
        ])}
      />
      <h3>{i18n.text('各身份目的与来源')}</h3>
      <Table
        columns={['蜘蛛', '地区', '目的', '开放数据集', '请求数', '官方文档']}
        numeric={[4]}
        static={[5]}
        search
        rows={result.bots.map(bot => [
          bot.name,
          bot.region ? i18n.text(regionLabels[bot.region]) : i18n.text('无法判定'),
          purposeCell(bot.purpose),
          bot.datasetExposure === 'none' ? (
            '–'
          ) : (
            <Badge key="exposure" tone={bot.datasetExposure === 'open_dataset' ? 'amber' : 'gray'}>
              {i18n.text(exposureLabels[bot.datasetExposure])}
            </Badge>
          ),
          num(bot.requests),
          bot.documentationUrl ? (
            <a
              key="documentation"
              href={bot.documentationUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {new URL(bot.documentationUrl).hostname}
            </a>
          ) : (
            '–'
          ),
        ])}
      />
      <h3>{i18n.text('内容类型与目的')}</h3>
      <Table
        columns={['内容类型', '请求数', '目的分布']}
        numeric={[1]}
        static={[2]}
        rows={result.contentTypes.map(row => [
          i18n.text(contentLabels[row.contentType]),
          num(row.requests),
          distribution(row.byPurpose),
        ])}
      />
      <h3>{i18n.text('页面与目的（前 100）')}</h3>
      <Table
        columns={['页面', '内容类型', '请求数', '目的分布', '蜘蛛']}
        numeric={[2]}
        static={[3, 4]}
        search
        rows={result.pages.map(row => [
          row.path,
          i18n.text(contentLabels[row.contentType]),
          num(row.requests),
          distribution(row.byPurpose),
          row.bots.join(', '),
        ])}
      />
      <h3>{i18n.text('读取 robots.txt / llms.txt 的蜘蛛')}</h3>
      <Table
        columns={['文件', '蜘蛛', '请求数', '成功请求']}
        numeric={[2, 3]}
        empty={i18n.text('当前范围没有蜘蛛读取这些文件')}
        rows={result.policyFiles.flatMap(file =>
          file.bots.map(bot => [file.path, bot.name, num(bot.requests), num(bot.successful)]),
        )}
      />
      <h3>{i18n.text('robots.txt 遵循检查')}</h3>
      <p className="muted">
        {i18n.text('粘贴网站当前的 robots.txt 内容，在浏览器内对照已记录的抓取路径，不会保存。')}
      </p>
      <label className="field">
        <span>{i18n.text('robots.txt 内容')}</span>
        <textarea
          rows={5}
          value={pasted}
          onChange={event => setPasted(event.target.value)}
          spellCheck={false}
        />
      </label>
      {!pasted.trim() && stored && (
        <Notice>{i18n.text('已使用最近一次公开页面检查读取的 robots.txt。')}</Notice>
      )}
      {!result.robots ? (
        <Notice tone="amber">{i18n.text('尚未提供 robots.txt，无法判断是否抓取禁止路径。')}</Notice>
      ) : result.robots.state === 'unavailable' ? (
        <Notice tone="amber">
          {result.robots.reason === 'too_large'
            ? i18n.text('无法判断：robots.txt 超过 512 KiB，超出解析上限。')
            : i18n.text('无法判断：无法解析 robots.txt 内容。')}
        </Notice>
      ) : (
        <>
          <p className="muted">
            {i18n.text('已检查 {v0} 条路径记录，跳过 {v1} 条（身份无 robots token）。', [
              num(result.robots.checkedPages),
              num(result.robots.skippedPages),
            ])}
          </p>
          {result.robots.issues > 0 && (
            <Notice tone="amber">
              {i18n.text(
                'robots.txt 有 {v0} 行格式无效（例如路径未以 / 开头），这些行未纳入比对；未发现命中不代表已全部遵循。',
                [num(result.robots.issues)],
              )}
            </Notice>
          )}
          <Table
            columns={['蜘蛛', '路径', '请求数', '匹配规则', '类型']}
            numeric={[2]}
            empty={i18n.text('未发现命中禁止路径的请求')}
            rows={result.robots.disallowedHits.map(hit => [
              hit.name,
              hit.path,
              num(hit.requests),
              hit.rule,
              hit.userTriggered ? i18n.text('用户触发') : i18n.text('自动抓取'),
            ])}
          />
          {result.robots.disallowedHits.some(hit => hit.userTriggered) && (
            <Notice>
              {i18n.text('用户触发获取器的运营方说明其可能不适用 robots.txt；命中不一定代表违规。')}
            </Notice>
          )}
        </>
      )}
      <h3>{i18n.text('用户触发获取与 AI 引荐访问')}</h3>
      <p className="muted">
        {i18n.text(
          '同一期间内，同一平台的用户触发获取与 AI 引荐落地页出现在同一页面。这是共同出现，不代表因果；汇总数据无法判定先后顺序。',
        )}
      </p>
      <Table
        columns={['平台', '页面', '用户触发获取', 'AI 引荐访问', '关系']}
        numeric={[2, 3]}
        search
        rows={result.correlation.flatMap(platform =>
          platform.rows.map(row => [
            platform.platformId,
            row.path,
            num(row.userFetches),
            num(row.referralVisits),
            i18n.text(relationLabels[row.relation]),
          ]),
        )}
      />
    </>
  );
}
