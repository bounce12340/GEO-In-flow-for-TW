import type {
  CrawlerAnalyzedBot,
  CrawlerAnalyzedPage,
  CrawlerAnalyzedPlatform,
} from '../contracts/crawler-analysis';
import type { CrawlerDirectoryEntry } from './directory';
import {
  checkRobotsAccess,
  parseRobots,
  ROBOTS_PARSE_MAX_BYTES,
  type RobotsDocument,
} from './robots';

/**
 * "Why did this AI come?" Purpose is read from the reviewed catalog entry of the identity that
 * made the request, never guessed from a single hit. Requests without a catalog identity stay
 * `unknown`, because a user agent string alone does not reveal the operator's intent.
 */
export const CRAWL_PURPOSE_VERSION = 'crawl-purpose-v1';
export const crawlPurposes = [
  'training_crawl',
  'ai_search_index',
  'user_triggered_fetch',
  'agent_browsing',
  'traditional_search',
  'other',
  'unknown',
] as const;
export type CrawlPurpose = (typeof crawlPurposes)[number];

/** Display order puts Taiwan and global operators first; mainland China entries stay available. */
export const crawlerRegions = ['taiwan', 'global', 'japan', 'korea', 'europe', 'china'] as const;
export type CrawlerRegion = (typeof crawlerRegions)[number];

/** Operator home region by catalog platform. Unlisted platforms are shown under global. */
export const platformRegions: Readonly<Record<string, CrawlerRegion>> = Object.freeze({
  openai: 'global',
  anthropic: 'global',
  perplexity: 'global',
  google: 'global',
  microsoft: 'global',
  apple: 'global',
  amazon: 'global',
  meta: 'global',
  duckduckgo: 'global',
  'common-crawl': 'global',
  ai2: 'global',
  ahrefs: 'global',
  semrush: 'global',
  diffbot: 'global',
  yahoo: 'global',
  webz: 'global',
  cohere: 'global',
  mistral: 'europe',
  seznam: 'europe',
  qwant: 'europe',
  mojeek: 'europe',
  majestic: 'europe',
  yandex: 'europe',
  line: 'taiwan',
  'sb-intuitions': 'japan',
  nict: 'japan',
  rois: 'japan',
  naver: 'korea',
  kakao: 'korea',
  kimi: 'china',
  tencent: 'china',
  bytedance: 'china',
  baidu: 'china',
  sogou: 'china',
  '360': 'china',
  petal: 'china',
});
export const crawlerRegion = (platformId: string): CrawlerRegion =>
  platformRegions[platformId] ?? 'global';

/**
 * Where crawled text can end up. `open_dataset` means the operator publishes the crawl (or a
 * corpus built from it) for anyone to train on; `commercial_dataset` means it is sold or licensed
 * to third parties; `operator_model` means it trains the operator's own models.
 */
export type DatasetExposure = 'open_dataset' | 'commercial_dataset' | 'operator_model' | 'none';
const datasetExposure: Readonly<Record<string, DatasetExposure>> = Object.freeze({
  ccbot: 'open_dataset',
  ai2bot: 'open_dataset',
  diffbot: 'commercial_dataset',
  omgilibot: 'commercial_dataset',
  'webzio-extended': 'commercial_dataset',
});

/** Documented as acting on a user's behalf (browsing and taking actions), not a single fetch. */
const agentBrowsingIds = new Set(['google-agent']);

export function crawlPurposeForEntry(
  entry: Pick<CrawlerDirectoryEntry, 'id' | 'type' | 'kind'> | null | undefined,
): CrawlPurpose {
  if (!entry) return 'unknown';
  if (entry.kind === 'signed_agent' || agentBrowsingIds.has(entry.id)) return 'agent_browsing';
  if (datasetExposure[entry.id] === 'open_dataset') return 'training_crawl';
  return (
    {
      training: 'training_crawl',
      search: 'ai_search_index',
      user: 'user_triggered_fetch',
      traditional_search: 'traditional_search',
      other: 'other',
    } as const
  )[entry.type];
}

export function datasetExposureForEntry(
  entry: Pick<CrawlerDirectoryEntry, 'id' | 'type'> | null | undefined,
): DatasetExposure {
  if (!entry) return 'none';
  return datasetExposure[entry.id] ?? (entry.type === 'training' ? 'operator_model' : 'none');
}

export type ContentType =
  | 'robots'
  | 'llms'
  | 'ai_policy'
  | 'sitemap_feed'
  | 'html'
  | 'document'
  | 'image'
  | 'media'
  | 'asset'
  | 'data_api';
export const contentTypes: readonly ContentType[] = [
  'html',
  'document',
  'image',
  'media',
  'data_api',
  'sitemap_feed',
  'robots',
  'llms',
  'ai_policy',
  'asset',
];

/** Path-based content type; the log does not carry Content-Type, so extensions decide. */
export function contentTypeForPath(path: string): ContentType {
  const value = (path.split(/[?#]/)[0] || '/').toLowerCase();
  if (value === '/robots.txt') return 'robots';
  if (value === '/llms.txt' || value === '/llms-full.txt') return 'llms';
  if (value === '/ai.txt' || value === '/.well-known/tdmrep.json') return 'ai_policy';
  if (/(^|\/)sitemap[^/]*\.xml(\.gz)?$/.test(value) || /\.(rss|atom)$|\/(feed|rss)\/?$/.test(value))
    return 'sitemap_feed';
  if (/\.(pdf|docx?|pptx?|xlsx?|odt|rtf|md|txt|epub)$/.test(value)) return 'document';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)$/.test(value)) return 'image';
  if (/\.(mp4|webm|mov|m4v|mp3|m4a|wav|ogg|flac)$/.test(value)) return 'media';
  if (/\.(js|mjs|css|map|woff2?|ttf|otf|eot|wasm)$/.test(value)) return 'asset';
  if (/^\/(api|graphql)(\/|$)/.test(value) || /\.(json|xml|csv)$/.test(value)) return 'data_api';
  return 'html';
}

export const aiPolicyFiles = [
  '/robots.txt',
  '/llms.txt',
  '/llms-full.txt',
  '/ai.txt',
  '/.well-known/tdmrep.json',
] as const;

type Directory = readonly Pick<
  CrawlerDirectoryEntry,
  'id' | 'name' | 'type' | 'kind' | 'platformId' | 'robotsToken' | 'documentationUrl'
>[];

export interface PurposeBot {
  botId: string | null;
  name: string;
  platformId: string | null;
  region: CrawlerRegion | null;
  purpose: CrawlPurpose;
  datasetExposure: DatasetExposure;
  documentationUrl: string | null;
  requests: number;
}

export interface CrawlPurposeAnalysis {
  version: typeof CRAWL_PURPOSE_VERSION;
  totalRequests: number;
  purposes: { purpose: CrawlPurpose; requests: number; share: number | null; bots: number }[];
  bots: PurposeBot[];
  contentTypes: {
    contentType: ContentType;
    requests: number;
    byPurpose: Partial<Record<CrawlPurpose, number>>;
  }[];
  pages: {
    path: string;
    contentType: ContentType;
    requests: number;
    byPurpose: Partial<Record<CrawlPurpose, number>>;
    bots: string[];
  }[];
  policyFiles: {
    path: (typeof aiPolicyFiles)[number];
    bots: { botId: string | null; name: string; requests: number; successful: number }[];
  }[];
  /**
   * `null` when no robots.txt text is available for comparison; `unavailable` when the supplied
   * text cannot be parsed (for example above the 512 KiB parser limit), so no verdict is given.
   */
  robots:
    | { state: 'unavailable'; reason: 'too_large' | 'unreadable' }
    | {
        state: 'checked';
        disallowedHits: {
          botId: string;
          name: string;
          path: string;
          requests: number;
          rule: string;
          userTriggered: boolean;
        }[];
        checkedPages: number;
        skippedPages: number;
        issues: number;
      }
    | null;
  correlation: {
    platformId: string;
    referralState: CrawlerAnalyzedPlatform['state'] | 'no_platform';
    /** Landing pages were cut off, so an unlisted path has unknown, not zero, referral visits. */
    landingPagesTruncated: boolean;
    rows: {
      path: string;
      userFetches: number;
      /** `null` when referral visits are unknown: input missing, truncated or not reported. */
      referralVisits: number | null;
      relation: 'both' | 'fetch_only' | 'referral_only' | 'referral_unknown';
    }[];
  }[];
  pagesTruncated: boolean;
}

const pagePath = (page: Pick<CrawlerAnalyzedPage, 'path' | 'humanPath'>) =>
  page.humanPath || page.path;

/** The parser throws above its byte limit; the analysis runs during render, so it must not. */
function readRobots(text: string): RobotsDocument | 'too_large' | 'unreadable' {
  try {
    return parseRobots(text);
  } catch {
    return new TextEncoder().encode(text).length > ROBOTS_PARSE_MAX_BYTES
      ? 'too_large'
      : 'unreadable';
  }
}

/**
 * Pure summary over an existing crawler-analysis snapshot. Inputs are the same rows the analysis
 * dialog already reads, so the result shares their coverage, identity scope and truncation.
 */
export function analyzeCrawlPurpose(input: {
  directory: Directory;
  bots: readonly Pick<CrawlerAnalyzedBot, 'botId' | 'name' | 'requests'>[];
  pages: readonly Pick<
    CrawlerAnalyzedPage,
    'botId' | 'name' | 'path' | 'humanPath' | 'requests' | 'status2xx'
  >[];
  platforms: readonly (Pick<CrawlerAnalyzedPlatform, 'platformId' | 'state' | 'landingPages'> &
    Partial<Pick<CrawlerAnalyzedPlatform, 'landingPagesTruncated'>>)[];
  pagesTruncated?: boolean;
  robotsText?: string | null;
  pageLimit?: number;
}): CrawlPurposeAnalysis {
  const entries = new Map(input.directory.map(entry => [entry.id, entry]));
  const entryFor = (botId: string | null) => (botId ? entries.get(botId) : undefined);
  const purposeOf = (botId: string | null) => crawlPurposeForEntry(entryFor(botId));
  const totalRequests = input.bots.reduce((sum, bot) => sum + (Number(bot.requests) || 0), 0);

  const bots: PurposeBot[] = input.bots
    .map(bot => {
      const entry = entryFor(bot.botId);
      return {
        botId: bot.botId,
        name: bot.name,
        platformId: entry?.platformId ?? null,
        region: entry ? crawlerRegion(entry.platformId) : null,
        purpose: crawlPurposeForEntry(entry),
        datasetExposure: datasetExposureForEntry(entry),
        documentationUrl: entry?.documentationUrl || null,
        requests: Number(bot.requests) || 0,
      };
    })
    .sort(
      (a, b) =>
        crawlerRegions.indexOf(a.region ?? 'global') -
          crawlerRegions.indexOf(b.region ?? 'global') ||
        b.requests - a.requests ||
        a.name.localeCompare(b.name),
    );

  const purposes = crawlPurposes
    .map(purpose => {
      const matching = bots.filter(bot => bot.purpose === purpose);
      const requests = matching.reduce((sum, bot) => sum + bot.requests, 0);
      return {
        purpose,
        requests,
        share: totalRequests ? Math.round((requests / totalRequests) * 10000) / 100 : null,
        bots: matching.length,
      };
    })
    .filter(row => row.requests > 0);

  const typeTotals = new Map<
    ContentType,
    { requests: number; byPurpose: Record<string, number> }
  >();
  const pageTotals = new Map<
    string,
    { requests: number; byPurpose: Record<string, number>; bots: Set<string> }
  >();
  for (const page of input.pages) {
    const requests = Number(page.requests) || 0;
    const purpose = purposeOf(page.botId);
    const path = pagePath(page);
    const type = contentTypeForPath(path);
    const typeRow = typeTotals.get(type) || { requests: 0, byPurpose: {} };
    typeRow.requests += requests;
    typeRow.byPurpose[purpose] = (typeRow.byPurpose[purpose] || 0) + requests;
    typeTotals.set(type, typeRow);
    const pageRow = pageTotals.get(path) || { requests: 0, byPurpose: {}, bots: new Set<string>() };
    pageRow.requests += requests;
    pageRow.byPurpose[purpose] = (pageRow.byPurpose[purpose] || 0) + requests;
    pageRow.bots.add(entryFor(page.botId)?.name || page.name || page.botId || '');
    pageTotals.set(path, pageRow);
  }

  const policyFiles = aiPolicyFiles.map(path => ({
    path,
    bots: input.pages
      .filter(page => pagePath(page).toLowerCase() === path)
      .map(page => ({
        botId: page.botId,
        name: entryFor(page.botId)?.name || page.name || page.botId || '',
        requests: Number(page.requests) || 0,
        successful: Number(page.status2xx) || 0,
      }))
      .sort((a, b) => b.requests - a.requests),
  }));

  let robots: CrawlPurposeAnalysis['robots'] = null;
  const document = input.robotsText?.trim() ? readRobots(input.robotsText) : null;
  if (typeof document === 'string') robots = { state: 'unavailable', reason: document };
  else if (document) {
    const disallowedHits: Extract<
      NonNullable<CrawlPurposeAnalysis['robots']>,
      { state: 'checked' }
    >['disallowedHits'] = [];
    let checkedPages = 0,
      skippedPages = 0;
    for (const page of input.pages) {
      const entry = entryFor(page.botId);
      if (!entry?.robotsToken || !page.botId) {
        skippedPages++;
        continue;
      }
      let result: ReturnType<typeof checkRobotsAccess>;
      try {
        result = checkRobotsAccess(document, entry.robotsToken, page.path);
      } catch {
        skippedPages++;
        continue;
      }
      checkedPages++;
      if (!result.allowed && result.matchedRule)
        disallowedHits.push({
          botId: page.botId,
          name: entry.name,
          path: page.path,
          requests: Number(page.requests) || 0,
          rule: `Disallow: ${result.matchedRule.path}`,
          userTriggered: entry.type === 'user',
        });
    }
    robots = {
      state: 'checked',
      disallowedHits: disallowedHits.sort((a, b) => b.requests - a.requests),
      checkedPages,
      skippedPages,
      issues: document.issues.length,
    };
  }

  const userPlatforms = [
    ...new Set(
      input.directory
        .filter(entry => entry.type === 'user' && entry.kind === 'http_crawler')
        .map(entry => entry.platformId),
    ),
  ];
  const correlation = userPlatforms
    .map(platformId => {
      const userIds = new Set(
        input.directory
          .filter(entry => entry.platformId === platformId && entry.type === 'user')
          .map(entry => entry.id),
      );
      const fetches = new Map<string, number>();
      for (const page of input.pages)
        if (page.botId && userIds.has(page.botId))
          fetches.set(
            pagePath(page),
            (fetches.get(pagePath(page)) || 0) + (Number(page.requests) || 0),
          );
      const platform = input.platforms.find(row => row.platformId === platformId);
      const available = platform?.state === 'available';
      const truncated = !!platform?.landingPagesTruncated;
      const visits = new Map<string, number | null>();
      if (platform) for (const row of platform.landingPages) visits.set(row.path, row.visits);
      const paths = new Set([...fetches.keys(), ...(available ? visits.keys() : [])]);
      const rows = [...paths]
        .map(path => {
          const userFetches = fetches.get(path) || 0;
          const listed = visits.get(path);
          const referralVisits = !available
            ? null
            : listed !== undefined
              ? listed
              : truncated
                ? null
                : 0;
          return {
            path,
            userFetches,
            referralVisits,
            relation:
              referralVisits == null
                ? ('referral_unknown' as const)
                : userFetches && referralVisits
                  ? ('both' as const)
                  : userFetches
                    ? ('fetch_only' as const)
                    : ('referral_only' as const),
          };
        })
        .sort(
          (a, b) =>
            Number(b.relation === 'both') - Number(a.relation === 'both') ||
            b.userFetches - a.userFetches ||
            (b.referralVisits || 0) - (a.referralVisits || 0) ||
            a.path.localeCompare(b.path),
        );
      return {
        platformId,
        referralState: platform ? platform.state : ('no_platform' as const),
        landingPagesTruncated: truncated,
        rows,
      };
    })
    .filter(row => row.rows.length);

  const limit = input.pageLimit ?? 100;
  return {
    version: CRAWL_PURPOSE_VERSION,
    totalRequests,
    purposes,
    bots,
    contentTypes: contentTypes
      .filter(type => typeTotals.has(type))
      .flatMap(contentType => {
        const row = typeTotals.get(contentType);
        return row ? [{ contentType, ...row }] : [];
      }),
    pages: [...pageTotals.entries()]
      .map(([path, row]) => ({
        path,
        contentType: contentTypeForPath(path),
        requests: row.requests,
        byPurpose: row.byPurpose,
        bots: [...row.bots].filter(Boolean).sort(),
      }))
      .sort((a, b) => b.requests - a.requests || a.path.localeCompare(b.path))
      .slice(0, limit),
    policyFiles,
    robots,
    correlation,
    pagesTruncated: !!input.pagesTruncated,
  };
}
