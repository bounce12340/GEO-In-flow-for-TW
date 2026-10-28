import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CrawlerAnalysisResponse } from '@/lib/liekan/contracts/crawler-analysis';
import { getCrawlerDirectory } from '@/lib/liekan/crawlers/directory';
import { ROBOTS_PARSE_MAX_BYTES } from '@/lib/liekan/crawlers/robots';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { LiekanLocale } from '@/lib/liekan/i18n/locale';
import { CrawlPurposePanel } from './CrawlPurposePanel';

const counts = (requests: number) => ({ requests, status2xx: requests });
const data = {
  directory: getCrawlerDirectory(),
  bots: [
    { botId: 'gptbot', name: 'GPTBot', ...counts(6) },
    { botId: 'chatgpt-user', name: 'ChatGPT-User', ...counts(3) },
    { botId: 'ccbot', name: 'CCBot', ...counts(1) },
  ],
  pages: [
    { botId: 'gptbot', name: 'GPTBot', path: '/private/a', humanPath: '/private/a', ...counts(4) },
    {
      botId: 'gptbot',
      name: 'GPTBot',
      path: '/robots.txt',
      humanPath: '/robots.txt',
      ...counts(2),
    },
    {
      botId: 'chatgpt-user',
      name: 'ChatGPT-User',
      path: '/guide',
      humanPath: '/guide',
      ...counts(3),
    },
  ],
  platforms: [
    {
      platformId: 'openai',
      state: 'available',
      landingPages: [{ path: '/guide', visits: 5, conversions: null, goalEvents: null }],
    },
  ],
  pagesTruncated: false,
} as unknown as CrawlerAnalysisResponse;

const view = (locale: LiekanLocale, checks: any[] = []) =>
  render(
    <LiekanLocaleContext.Provider value={locale}>
      <CrawlPurposePanel data={data} checks={checks} />
    </LiekanLocaleContext.Provider>,
  );

it('explains crawl purposes in Taiwan Traditional Chinese and keeps unknown robots state explicit', () => {
  view('zh-TW');
  expect(screen.getAllByText('訓練抓取').length).toBeGreaterThan(0);
  expect(screen.getAllByText('使用者即時觸發取得').length).toBeGreaterThan(0);
  expect(screen.getByText('尚未提供 robots.txt，無法判斷是否抓取禁止路徑。')).toBeInTheDocument();
  expect(screen.getByText('兩者皆有')).toBeInTheDocument();
  expect(
    screen.getByText('記錄的抓取路徑不含查詢字串，因此以 $ 結尾或包含查詢參數的規則只能近似比對。'),
  ).toBeInTheDocument();
});

it('checks recorded paths against pasted robots rules without saving them', () => {
  view('en-US');
  fireEvent.change(screen.getByLabelText('robots.txt content'), {
    target: { value: 'User-agent: GPTBot\nDisallow: /private/' },
  });
  const row = screen.getByText('Disallow: /private/').closest('tr') as HTMLElement;
  expect(within(row).getByText('GPTBot')).toBeInTheDocument();
  expect(within(row).getByText('/private/a')).toBeInTheDocument();
});

it('reuses robots.txt stored by the latest completed public check', () => {
  view('zh-CN', [
    {
      state: 'completed',
      result: { robots: { status: 200, body: 'User-agent: *\nDisallow: /guide' } },
    },
  ]);
  expect(screen.getByText('已使用最近一次公开页面检查读取的 robots.txt。')).toBeInTheDocument();
  expect(screen.getByText('Disallow: /guide')).toBeInTheDocument();
});

it.each([
  ['zh-TW', '開放資料集', '營運方模型訓練'],
  ['en-US', 'Open dataset', 'Operator model training'],
] as const)('translates dataset exposure badges in %s', (locale, open, operator) => {
  view(locale);
  const badgeIn = (name: string, label: string) =>
    screen
      .getAllByText(name, { selector: 'td' })
      .some(cell => within(cell.closest('tr') as HTMLElement).queryByText(label));
  expect(badgeIn('CCBot', open)).toBe(true);
  expect(badgeIn('GPTBot', operator)).toBe(true);
  expect(screen.queryByText('开放数据集')).toBeNull();
  expect(screen.queryByText('运营方模型训练')).toBeNull();
});

it.each([
  ['zh-TW', '無法判斷：robots.txt 超過 512 KiB，超出解析上限。'],
  ['zh-CN', '无法判断：robots.txt 超过 512 KiB，超出解析上限。'],
  ['en-US', 'Cannot determine: robots.txt exceeds the 512 KiB parser limit.'],
] as const)(
  'keeps the tab usable when robots.txt exceeds the parser limit in %s',
  (locale, message) => {
    view(locale, [
      {
        state: 'completed',
        result: {
          robots: { status: 200, body: `User-agent: *\n#${'x'.repeat(ROBOTS_PARSE_MAX_BYTES)}` },
        },
      },
    ]);
    expect(screen.getByText(message)).toBeInTheDocument();
  },
);

it('flags malformed robots lines instead of only reporting no disallowed hits', () => {
  view('zh-TW');
  fireEvent.change(screen.getByLabelText('robots.txt 內容'), {
    target: { value: 'User-agent: GPTBot\nDisallow: private' },
  });
  expect(screen.getByText('未發現命中禁止路徑的請求')).toBeInTheDocument();
  expect(
    screen.getByText(
      'robots.txt 有 1 行格式無效（例如路徑未以 / 開頭），這些行未納入比對；未發現命中不代表已全部遵循。',
    ),
  ).toBeInTheDocument();
});

it('shows truncated AI referral landings as unknown rather than fetch-only', () => {
  const truncated = {
    ...data,
    pages: [
      ...data.pages,
      {
        botId: 'chatgpt-user',
        name: 'ChatGPT-User',
        path: '/faq',
        humanPath: '/faq',
        ...counts(1),
      },
    ],
    platforms: [{ ...data.platforms[0], landingPagesTruncated: true }],
  } as unknown as CrawlerAnalysisResponse;
  render(
    <LiekanLocaleContext.Provider value="zh-TW">
      <CrawlPurposePanel data={truncated} checks={[]} />
    </LiekanLocaleContext.Provider>,
  );
  expect(
    screen.getByText('AI 引薦落地頁記錄已截斷，未列出頁面的引薦造訪顯示為未知，不計為 0。'),
  ).toBeInTheDocument();
  const row = screen
    .getAllByText('/faq', { selector: 'td' })
    .map(cell => cell.closest('tr') as HTMLElement)
    .find(tr => within(tr).queryByText('ChatGPT-User') === null) as HTMLElement;
  expect(within(row).getByText('引薦造訪未知')).toBeInTheDocument();
  expect(within(row).getByText('未知')).toBeInTheDocument();
  expect(within(row).queryByText('僅取得')).toBeNull();
});
