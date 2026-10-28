import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CrawlerAnalysisResponse } from '@/lib/liekan/contracts/crawler-analysis';
import { getCrawlerDirectory } from '@/lib/liekan/crawlers/directory';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import type { LiekanLocale } from '@/lib/liekan/i18n/locale';
import { CrawlPurposePanel } from './CrawlPurposePanel';

const counts = (requests: number) => ({ requests, status2xx: requests });
const data = {
  directory: getCrawlerDirectory(),
  bots: [
    { botId: 'gptbot', name: 'GPTBot', ...counts(6) },
    { botId: 'chatgpt-user', name: 'ChatGPT-User', ...counts(3) },
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
