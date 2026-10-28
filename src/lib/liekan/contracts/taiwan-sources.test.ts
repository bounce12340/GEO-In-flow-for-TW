import { expect, it } from 'vitest';
import {
  chineseScriptForLanguageTag,
  isTaiwanDomain,
  taiwanReferralSources,
  taiwanSourceForHost,
} from './taiwan-sources';
import { classifyEntrySource, referralForHost } from './sources';

it('labels reviewed Taiwan referral hosts with the most specific match', () => {
  expect(taiwanSourceForHost('tw.search.yahoo.com')?.id).toBe('yahoo-tw-search');
  expect(taiwanSourceForHost('TW.YAHOO.COM')?.id).toBe('yahoo-tw');
  expect(taiwanSourceForHost('today.line.me')?.id).toBe('line-today');
  expect(taiwanSourceForHost('www.line.me')?.id).toBe('line');
  expect(taiwanSourceForHost('www.dcard.tw')?.id).toBe('dcard');
  expect(taiwanSourceForHost('forum.gamer.com.tw')?.id).toBe('gamer');
  expect(taiwanSourceForHost('notptt.cc')).toBeUndefined();
  for (const source of taiwanReferralSources)
    expect(new URL(source.sourceUrl).protocol).toBe('https:');
});
it('keeps Taiwan portals out of the AI channel', () => {
  expect(classifyEntrySource({ referrer: 'www.ptt.cc' }).channel).toBe('其他引荐');
  expect(classifyEntrySource({ referrer: 'www.dcard.tw' }).channel).toBe('其他引荐');
  expect(classifyEntrySource({ referrer: 'tw.search.yahoo.com' }).channel).toBe('传统搜索');
  expect(classifyEntrySource({ referrer: 'chatgpt.com' }).channel).toBe('AI 搜索引荐');
  for (const source of taiwanReferralSources)
    for (const host of source.hosts) expect(referralForHost(host)).toBeUndefined();
});
it('reads Taiwan content signals from hosts and language tags', () => {
  expect(isTaiwanDomain('www.example.com.tw')).toBe(true);
  expect(isTaiwanDomain('example.tw.')).toBe(true);
  expect(isTaiwanDomain('example.com')).toBe(false);
  expect(chineseScriptForLanguageTag('zh-Hant-TW')).toBe('traditional');
  expect(chineseScriptForLanguageTag('zh-TW')).toBe('traditional');
  expect(chineseScriptForLanguageTag('zh-CN')).toBe('simplified');
  expect(chineseScriptForLanguageTag('zh')).toBe('unspecified');
  expect(chineseScriptForLanguageTag('en')).toBe('not_chinese');
});
