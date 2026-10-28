import { expect, it } from 'vitest';
import { readLocaleCookie, resolveLiekanLocale, storageLiekanLocale } from './locale';
import {
  translateText,
  translateSystemText,
  metricLabel,
  fillMessage,
  createTranslator,
  countUnit,
} from './text';
import { helpTranslator } from './help';
import { searchArticles, searchCrawlers, helpArticles, helpCrawlers } from '../help/catalog';
import { localAiGreeting } from '../ai/answer';
import { aiConversationPostSchema } from '../ai/contracts';
import { hashAiRequest } from '../ai/request';
import { aiSpaceDisplayName } from '../contracts/ai-display';

it('uses saved preference before a valid hint and deployment default', () => {
  expect(resolveLiekanLocale({ cookie: 'en-US', stored: 'zh-CN', hint: 'zh-CN' })).toBe('en-US');
  expect(resolveLiekanLocale({ stored: 'en-US', hint: 'zh-CN' })).toBe('en-US');
  expect(resolveLiekanLocale({ hint: 'en-US' })).toBe('en-US');
  for (const invalid of ['fr', 'EN-US', '../en-US', 'en-US; Path=/', 'zh-HK', '', null])
    expect(resolveLiekanLocale({ cookie: invalid, stored: invalid, hint: invalid })).toBe('zh-TW');
  expect(resolveLiekanLocale({ configured: 'en-US' })).toBe('en-US');
  expect(resolveLiekanLocale({ configured: 'zh-CN' })).toBe('zh-CN');
  expect(resolveLiekanLocale({ configured: 'zh-TW' })).toBe('zh-TW');
  expect(resolveLiekanLocale({ cookie: 'zh-CN', configured: 'zh-TW' })).toBe('zh-CN');
  expect(resolveLiekanLocale({ stored: 'zh-TW', configured: 'zh-CN' })).toBe('zh-TW');
  expect(readLocaleCookie('liekan.locale=zh-TW')).toBe('zh-TW');
  expect(readLocaleCookie('session=x; liekan.locale=en-US; extra=x')).toBe('en-US');
  expect(readLocaleCookie('liekan.locale=%E0%A4%A')).toBeUndefined();
  expect(readLocaleCookie('other.liekan.locale=en-US')).toBeUndefined();
});
it('preserves metric units and interpolation values that resemble product copy', () => {
  expect(metricLabel('访问次数', 'pageviews', 'en-US')).toBe('Pageviews');
  expect(translateText('访问次数', 'en-US')).toBe('Visits');
  expect(metricLabel('AI 引荐访客', 'ai-sessions', 'en-US')).toBe('AI referral sessions');
  expect(translateText('AI 引荐访客', 'en-US')).toBe('AI referral visitors');
  expect(metricLabel('身份验证', 'crawler-identity', 'en-US')).toBe('Identity verification');
  expect(fillMessage('Name: {v0}', ['页面访问 $&'])).toBe('Name: 页面访问 $&');
  expect(translateSystemText('visitor-entered text', 'en-US')).toBe('visitor-entered text');
});
it('localizes GEO snapshot boundary, expiry, cooldown and cache authorization errors', () => {
  for (const message of [
    'GEO 快照基准已变化，请重新读取',
    'GEO 快照已淘汰，请重新读取',
    'GEO 权重重算间隔为 5 分钟',
    'GEO 权重需要有效的命名时区',
    'GEO 后台暂不可用，请重新读取',
    '请完成登录后读取统计缓存',
  ]) {
    expect(translateSystemText(message, 'en-US')).not.toMatch(/[\u3400-\u9fff]/);
    expect(translateSystemText(message, 'zh-CN')).toBe(message);
  }
});
it('finds English help bodies and purposes while retaining article/crawler identities and code', () => {
  const display = (source: string) => helpTranslator.system(source, 'en-US');
  const articles = searchArticles('official range', undefined, display);
  expect(articles.length).toBeGreaterThan(0);
  expect(articles.every(article => helpArticles.includes(article))).toBe(true);
  const crawlers = searchCrawlers('training', '', '', '', display);
  expect(crawlers.length).toBeGreaterThan(0);
  expect(crawlers.every(crawler => helpCrawlers.includes(crawler))).toBe(true);
  const code = helpArticles
    .flatMap(a => a.blocks)
    .find(b => b.code?.text.includes('User-agent'))?.code;
  expect(code?.text).toContain('User-agent');
  expect(helpTranslator.system('eq.AI 搜索引荐', 'en-US')).toBe('eq.AI 搜索引荐');
});
it('locks AI locale in an optional request and preserves old request hashes', () => {
  const request = {
    clientRequestId: '09cfb153-5a7b-4dce-b607-c61a0d0794c7',
    expectedConfigVersion: 1,
    question: '你好',
    startAt: '2026-10-01T00:00:00Z',
    endAt: '2026-10-02T00:00:00Z',
    timezone: 'UTC',
  };
  const old = aiConversationPostSchema.parse(request);
  expect(old).not.toHaveProperty('locale');
  expect(hashAiRequest({ ...old, locale: undefined })).toBe(hashAiRequest(old));
  expect(hashAiRequest({ ...old, locale: 'en-US' })).not.toBe(hashAiRequest(old));
  expect(aiConversationPostSchema.safeParse({ ...request, locale: 'fr-FR' }).success).toBe(false);
  expect(localAiGreeting('hello', 'en-US')?.summary).toMatch(/GEOInflow/);
  expect(localAiGreeting('hello', 'en-US')?.summary).not.toMatch(/[\u3400-\u9fff]/);
  expect(localAiGreeting('hello, analyze my traffic', 'en-US')).toBeNull();
});

it('formats singular and plural count labels without rewriting interpolation content', () => {
  const catalog = createTranslator({ count: '{v0} 条记录' }, { count: '{v0} records' });
  expect(catalog.text('{v0} 条记录', 'en-US', [1])).toBe('1 record');
  expect(catalog.text('{v0} 条记录', 'en-US', [2])).toBe('2 records');
  expect(countUnit('条', 1, 'en-US')).toBe('item');
  expect(countUnit('条', 2, 'en-US')).toBe('items');
  expect(countUnit('页', 2, 'en-US')).toBe('pages');
  expect(countUnit(' 条', 2, 'zh-CN')).toBe(' 条');
});

it('localizes only declared application-owned message slots and preserves raw fields', () => {
  const warning = translateSystemText('已保存，部分数据更新失败，请重试读取', 'en-US');
  expect(warning).toContain('Saved');
  expect(warning).not.toMatch(/[\u3400-\u9fff]/);
  expect(translateSystemText('第 1 条规则的厂商须为 1 至 80 个字符。', 'en-US')).toContain(
    'Vendor',
  );
  expect(translateText('输入 {v0} 确认', 'en-US', ['已保存'])).toContain('已保存');
  expect(translateSystemText('白名单已保存，共 1 条。', 'en-US')).toContain('1 entry');
  const rawName = 'foo  bar\t原始名称';
  expect(translateSystemText(`「${rawName}」已删除`, 'en-US')).toContain(rawName);
});
it('localizes the canonical current-user AI space and preserves names across other owners', () => {
  const display = (source: string) => translateText(source, 'en-US');
  const own = { kind: 'personal', id: 'current-user', name: '个人空间' };
  expect(aiSpaceDisplayName(own, 'current-user', display)).toBe('Personal space');
  expect(aiSpaceDisplayName({ ...own, kind: 'team' }, 'current-user', display)).toBe('个人空间');
  expect(aiSpaceDisplayName({ ...own, id: 'other-user' }, 'current-user', display)).toBe(
    '个人空间',
  );
  expect(aiSpaceDisplayName({ ...own, name: '原始用户名' }, 'current-user', display)).toBe(
    '原始用户名',
  );
  expect(aiSpaceDisplayName(own, undefined, display)).toBe('个人空间');
});

it('renders Taiwan Traditional Chinese from the shared message identities', () => {
  expect(translateText('网站设置', 'zh-TW')).not.toMatch(/[网设]/);
  expect(translateText('重新登录', 'zh-TW')).toBe('重新登入');
  expect(translateText('访问次数', 'zh-CN')).toBe('访问次数');
  expect(translateSystemText('GEO 后台暂不可用，请重新读取', 'zh-TW')).toBe(
    'GEO 後台暫不可用，請重新讀取',
  );
  expect(translateSystemText('visitor-entered 简体 text', 'zh-TW')).toBe('visitor-entered 简体 text');
  expect(countUnit('页', 2, 'zh-TW')).toBe('頁');
  expect(storageLiekanLocale('zh-TW')).toBe('zh-CN');
  expect(storageLiekanLocale('en-US')).toBe('en-US');
});
