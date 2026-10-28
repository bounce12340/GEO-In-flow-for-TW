import { describe, expect, it } from 'vitest';
import { getCrawlerDirectory } from './directory';
import {
  analyzeCrawlPurpose,
  contentTypeForPath,
  crawlerRegion,
  crawlPurposeForEntry,
  datasetExposureForEntry,
} from './purpose';
import { ROBOTS_PARSE_MAX_BYTES } from './robots';

const directory = getCrawlerDirectory();
const entry = (id: string) => {
  const found = directory.find(row => row.id === id);
  if (!found) throw new Error(`Missing directory entry: ${id}`);
  return found;
};
const page = (botId: string | null, path: string, requests: number, name = '') => ({
  botId,
  name,
  path,
  humanPath: path,
  requests,
  status2xx: requests,
});

describe('crawl purpose from the reviewed catalog', () => {
  it('derives purpose from the identity type instead of individual requests', () => {
    expect(crawlPurposeForEntry(entry('gptbot'))).toBe('training_crawl');
    expect(crawlPurposeForEntry(entry('oai-searchbot'))).toBe('ai_search_index');
    expect(crawlPurposeForEntry(entry('chatgpt-user'))).toBe('user_triggered_fetch');
    expect(crawlPurposeForEntry(entry('googlebot'))).toBe('traditional_search');
    expect(crawlPurposeForEntry(entry('ahrefsbot'))).toBe('other');
    expect(crawlPurposeForEntry(null)).toBe('unknown');
    expect(crawlPurposeForEntry({ id: 'x', type: 'user', kind: 'signed_agent' })).toBe(
      'agent_browsing',
    );
    // A catalog type added later without a purpose mapping stays unknown instead of undefined.
    const unmapped = {
      id: 'x',
      type: 'future_type',
      kind: 'http_crawler',
    } as unknown as Parameters<typeof crawlPurposeForEntry>[0];
    expect(crawlPurposeForEntry(unmapped)).toBe('unknown');
  });
  it('marks crawlers whose output feeds open datasets', () => {
    expect(crawlPurposeForEntry(entry('ccbot'))).toBe('training_crawl');
    expect(datasetExposureForEntry(entry('ccbot'))).toBe('open_dataset');
    expect(datasetExposureForEntry(entry('ai2bot'))).toBe('open_dataset');
    expect(datasetExposureForEntry(entry('gptbot'))).toBe('operator_model');
    expect(datasetExposureForEntry(entry('googlebot'))).toBe('none');
  });
  it('groups operators by region with mainland China kept but not first', () => {
    expect(crawlerRegion('openai')).toBe('global');
    expect(crawlerRegion('naver')).toBe('korea');
    expect(crawlerRegion('mistral')).toBe('europe');
    expect(crawlerRegion('baidu')).toBe('china');
    expect(crawlerRegion('unlisted-platform')).toBe('global');
  });
  it('classifies content types from paths', () => {
    expect(contentTypeForPath('/robots.txt')).toBe('robots');
    expect(contentTypeForPath('/llms-full.txt')).toBe('llms');
    expect(contentTypeForPath('/.well-known/tdmrep.json')).toBe('ai_policy');
    expect(contentTypeForPath('/sitemap-posts.xml')).toBe('sitemap_feed');
    expect(contentTypeForPath('/files/report.PDF')).toBe('document');
    expect(contentTypeForPath('/img/a.webp?x=1')).toBe('image');
    expect(contentTypeForPath('/api/items')).toBe('data_api');
    expect(contentTypeForPath('/blog/post')).toBe('html');
  });
});

describe('purpose analysis over an analysis snapshot', () => {
  const base = {
    directory,
    bots: [
      { botId: 'gptbot', name: 'GPTBot', requests: 6 },
      { botId: 'chatgpt-user', name: 'ChatGPT-User', requests: 3 },
      { botId: null, name: 'mystery-bot', requests: 1 },
    ],
    pages: [
      page('gptbot', '/private/a', 4),
      page('gptbot', '/robots.txt', 2),
      page('chatgpt-user', '/guide', 2),
      page('chatgpt-user', '/private/b', 1),
      page(null, '/guide', 1, 'mystery-bot'),
    ],
    platforms: [
      {
        platformId: 'openai',
        state: 'available' as const,
        landingPages: [
          { path: '/guide', visits: 5, conversions: null, goalEvents: null },
          { path: '/pricing', visits: 2, conversions: null, goalEvents: null },
        ],
      },
    ],
  };
  it('summarizes purposes, unknown identities, content types and policy files', () => {
    const result = analyzeCrawlPurpose(base);
    expect(result.totalRequests).toBe(10);
    expect(result.purposes).toEqual([
      { purpose: 'training_crawl', requests: 6, share: 60, bots: 1 },
      { purpose: 'user_triggered_fetch', requests: 3, share: 30, bots: 1 },
      { purpose: 'unknown', requests: 1, share: 10, bots: 1 },
    ]);
    expect(result.contentTypes.find(row => row.contentType === 'robots')?.requests).toBe(2);
    expect(result.policyFiles.find(row => row.path === '/robots.txt')?.bots).toEqual([
      { botId: 'gptbot', name: 'GPTBot', requests: 2, successful: 2 },
    ]);
    expect(result.pages[0]).toMatchObject({ path: '/private/a', requests: 4 });
    expect(result.robots).toBeNull();
  });
  it('reports hits on disallowed paths only when robots rules are supplied', () => {
    const result = analyzeCrawlPurpose({
      ...base,
      robotsText: 'User-agent: GPTBot\nDisallow: /private/\n\nUser-agent: *\nDisallow: /private/b',
    });
    expect(result.robots).toMatchObject({
      state: 'checked',
      disallowedHits: [
        expect.objectContaining({ botId: 'gptbot', path: '/private/a', requests: 4 }),
        expect.objectContaining({ botId: 'chatgpt-user', path: '/private/b', userTriggered: true }),
      ],
      skippedPages: 1,
    });
  });
  it('returns an unavailable robots state instead of throwing above the parser limit', () => {
    const robotsText = `User-agent: *\nDisallow: /private/\n#${'x'.repeat(ROBOTS_PARSE_MAX_BYTES)}`;
    expect(() => analyzeCrawlPurpose({ ...base, robotsText })).not.toThrow();
    const result = analyzeCrawlPurpose({ ...base, robotsText });
    expect(result.robots).toEqual({ state: 'unavailable', reason: 'too_large' });
    expect(result.purposes.length).toBeGreaterThan(0);
  });
  it('relates user-triggered fetches and AI referral landings without implying causation', () => {
    const [openai] = analyzeCrawlPurpose(base).correlation;
    expect(openai.platformId).toBe('openai');
    expect(openai.rows).toEqual([
      { path: '/guide', userFetches: 2, referralVisits: 5, relation: 'both' },
      { path: '/private/b', userFetches: 1, referralVisits: 0, relation: 'fetch_only' },
      { path: '/pricing', userFetches: 0, referralVisits: 2, relation: 'referral_only' },
    ]);
    const missing = analyzeCrawlPurpose({
      ...base,
      platforms: [{ ...base.platforms[0], state: 'missing' as const }],
    }).correlation[0];
    expect(missing.referralState).toBe('missing');
    expect(missing.rows.every(row => row.referralVisits === null)).toBe(true);
    expect(missing.rows.every(row => row.relation === 'referral_unknown')).toBe(true);
  });
  it('keeps truncated or unreported referral visits unknown instead of zero', () => {
    const platform = {
      ...base.platforms[0],
      landingPagesTruncated: true,
      landingPages: [
        { path: '/guide', visits: 5, conversions: null, goalEvents: null },
        { path: '/pricing', visits: null, conversions: null, goalEvents: null },
      ],
    };
    const [openai] = analyzeCrawlPurpose({ ...base, platforms: [platform] }).correlation;
    expect(openai.landingPagesTruncated).toBe(true);
    expect(openai.rows).toEqual([
      { path: '/guide', userFetches: 2, referralVisits: 5, relation: 'both' },
      { path: '/private/b', userFetches: 1, referralVisits: null, relation: 'referral_unknown' },
      { path: '/pricing', userFetches: 0, referralVisits: null, relation: 'referral_unknown' },
    ]);
    const complete = analyzeCrawlPurpose({
      ...base,
      platforms: [{ ...platform, landingPagesTruncated: false }],
    }).correlation[0];
    expect(complete.rows.find(row => row.path === '/private/b')).toMatchObject({
      referralVisits: 0,
      relation: 'fetch_only',
    });
  });
});
