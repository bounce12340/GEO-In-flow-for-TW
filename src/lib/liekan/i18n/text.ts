import chinese from './messages/zh-CN.json';
import english from './messages/en-US.json';
import traditional from './messages/zh-TW.json';
import type { LiekanLocale } from './locale';

export type MessageCatalog = Record<string, string>;
export const normalizeMessage = (source: string) => source.trim().replace(/\s+/g, ' ');
export const liekanMessages = { 'zh-CN': chinese, 'en-US': english, 'zh-TW': traditional };

export function fillMessage(source: string, values: readonly unknown[] = []) {
  return source.replace(/\{v(\d+)\}/g, (token, index) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token,
  );
}

const singularNouns: Record<string, string> = {
  pages: 'page',
  records: 'record',
  items: 'item',
  results: 'result',
  members: 'member',
  websites: 'website',
  dashboards: 'dashboard',
  days: 'day',
  hours: 'hour',
  months: 'month',
  events: 'event',
  requests: 'request',
  sessions: 'session',
  visits: 'visit',
  visitors: 'visitor',
  goals: 'goal',
  steps: 'step',
  files: 'file',
  samples: 'sample',
  rows: 'row',
  articles: 'article',
  entries: 'entry',
  rules: 'rule',
};
function pluralMessage(message: string, values: readonly unknown[]) {
  return values.reduce<string>((result, value, index) => {
    if (value !== 1 && value !== '1') return result;
    return result.replace(
      new RegExp(`(\\{v${index}\\}\\s+)([a-z]+)\\b`, 'gi'),
      (match, prefix, noun) => {
        const singular = singularNouns[noun.toLowerCase()];
        return singular
          ? prefix +
              (/^[A-Z]/.test(noun) ? singular[0].toUpperCase() + singular.slice(1) : singular)
          : match;
      },
    );
  }, message);
}
export function countUnit(source: string, count: unknown, locale: LiekanLocale) {
  if (locale === 'zh-CN') return source;
  if (locale === 'zh-TW') return translateText(source, locale);
  const unit = ({ 页: 'page', 条: 'item', 次: 'time' } as Record<string, string>)[source.trim()];
  if (unit) return unit + (Number(count) === 1 ? '' : 's');
  const text = translateText(source, locale);
  return Number(count) === 1
    ? text.replace(/\b([a-z]+)\b/i, noun => singularNouns[noun.toLowerCase()] || noun)
    : text;
}

export function createTranslator(
  chinese: MessageCatalog,
  english: MessageCatalog,
  traditional: MessageCatalog = {},
) {
  const catalog = (locale: LiekanLocale) =>
    locale === 'en-US' ? english : locale === 'zh-TW' ? traditional : undefined;
  const sourceKeys = new Map(
    Object.entries(chinese).map(([key, source]) => [normalizeMessage(source), key]),
  );
  const key = (source: string) => sourceKeys.get(normalizeMessage(source));
  const ownedSlots: Record<string, number[]> = {
    '{v0}。请核对本次账户 ID，或关闭弹窗后添加已有用户。': [0],
    '第 {v0} 条规则的{v1}须为 1 至 80 个字符。': [1],
    '{v0}，部分数据更新失败，请重试读取': [0],
    '{v0} 页面状态刷新失败，请刷新页面确认已保存结果。': [0],
    '{v0} {v1} 个页面': [0],
    '校验通过 {v0} 条 · 新增 {v1} 条 · 重复 {v2} 条 · 拒绝 {v3} 条{v4}': [4],
  };
  const templates = Object.entries(chinese)
    .filter(([, source]) => /\{v\d+\}/.test(source))
    .map(([key, source]) => {
      const slots: number[] = [];
      const escaped = source
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\s+/g, '\\s+')
        .replace(/\\\{v(\d+)\\\}/g, (_token, index) => {
          slots.push(Number(index));
          return '(.*?)';
        });
      return { key, source, slots, pattern: new RegExp(`^${escaped}$`, 's') };
    })
    .sort(
      (a, b) => b.source.replace(/\{v\d+\}/g, '').length - a.source.replace(/\{v\d+\}/g, '').length,
    );

  function systemText(value: string, locale: LiekanLocale = 'zh-CN', depth = 0): string {
    const target = catalog(locale);
    if (!target || !value || depth > 4) return value;
    const message = key(value);
    if (message) return target[message] || value;
    for (const template of templates) {
      const match = template.pattern.exec(value);
      if (!match) continue;
      const values: string[] = [];
      template.slots.forEach((slot, index) => {
        values[slot] = match[index + 1];
      });
      for (const slot of ownedSlots[template.source] || [])
        values[slot] = systemText(values[slot], locale, depth + 1);
      const translated = target[template.key] || value;
      return fillMessage(
        locale === 'en-US' ? pluralMessage(translated, values) : translated,
        values,
      );
    }
    return value;
  }
  return {
    key,
    text(source: string, locale: LiekanLocale = 'zh-CN', values: readonly unknown[] = []) {
      const message = key(source);
      const translated = message ? catalog(locale)?.[message] : undefined;
      return fillMessage(
        translated
          ? source.match(/^\s*/)?.[0] +
              (locale === 'en-US' ? pluralMessage(translated, values) : translated) +
              source.match(/\s*$/)?.[0]
          : source,
        values,
      );
    },
    /** Only application-owned text belongs here; visitor content stays separate. */
    system: systemText,
  };
}

const translator = createTranslator(
  chinese as MessageCatalog,
  english as MessageCatalog,
  traditional as MessageCatalog,
);
export const messageKey = translator.key;
export const translateText = translator.text;
export const translateSystemText = translator.system;
export type LiekanTranslator = typeof translator;

export function metricLabel(
  source: string,
  context: 'pageviews' | 'ai-sessions' | 'crawler-identity' | 'event-property-type',
  locale: LiekanLocale,
) {
  if (locale === 'en-US') {
    if (context === 'pageviews' && source === '访问次数') return 'Pageviews';
    if (context === 'ai-sessions' && source === 'AI 引荐访客') return 'AI referral sessions';
    if (context === 'crawler-identity' && source === '身份验证') return 'Identity verification';
    if (context === 'event-property-type' && source === '数值') return 'Number';
  }
  return translateText(source, locale);
}
