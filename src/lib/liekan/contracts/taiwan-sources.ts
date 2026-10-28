/**
 * Taiwan referral sources reviewed for GEOInflow TW on 2026-10-28. Each hostname was checked
 * against the operator's own site. These are portals, communities and messaging services, not AI
 * assistants, so attribution keeps its existing channel; this table only labels the source.
 * Pending integration: referrer attribution and the source tables do not read it yet.
 */
export type TaiwanSourceCategory =
  | 'search'
  | 'portal'
  | 'messaging'
  | 'news'
  | 'community'
  | 'shopping';
export interface TaiwanReferralSource {
  id: string;
  name: string;
  operator: string;
  category: TaiwanSourceCategory;
  hosts: readonly string[];
  sourceUrl: string;
}
export const taiwanReferralSources: readonly TaiwanReferralSource[] = Object.freeze([
  {
    id: 'yahoo-tw-search',
    name: 'Yahoo奇摩搜尋',
    operator: 'Yahoo Taiwan',
    category: 'search',
    hosts: ['tw.search.yahoo.com'],
    sourceUrl: 'https://tw.search.yahoo.com/',
  },
  {
    id: 'yahoo-tw',
    name: 'Yahoo奇摩',
    operator: 'Yahoo Taiwan',
    category: 'portal',
    hosts: ['tw.yahoo.com'],
    sourceUrl: 'https://tw.yahoo.com/',
  },
  {
    id: 'line-today',
    name: 'LINE TODAY',
    operator: 'LY Corporation',
    category: 'news',
    hosts: ['today.line.me'],
    sourceUrl: 'https://today.line.me/',
  },
  {
    id: 'line',
    name: 'LINE',
    operator: 'LY Corporation',
    category: 'messaging',
    hosts: ['line.me'],
    sourceUrl: 'https://line.me/',
  },
  {
    id: 'pchome-24h',
    name: 'PChome 24h購物',
    operator: 'PChome Online',
    category: 'shopping',
    hosts: ['24h.pchome.com.tw'],
    sourceUrl: 'https://24h.pchome.com.tw/',
  },
  {
    id: 'pchome',
    name: 'PChome Online',
    operator: 'PChome Online',
    category: 'portal',
    hosts: ['pchome.com.tw'],
    sourceUrl: 'https://www.pchome.com.tw/',
  },
  {
    id: 'dcard',
    name: 'Dcard',
    operator: 'Dcard Taiwan',
    category: 'community',
    hosts: ['dcard.tw'],
    sourceUrl: 'https://www.dcard.tw/robots.txt',
  },
  {
    id: 'ptt',
    name: 'PTT 批踢踢實業坊',
    operator: 'PTT',
    category: 'community',
    hosts: ['ptt.cc'],
    sourceUrl: 'https://www.ptt.cc/',
  },
  {
    id: 'gamer',
    name: '巴哈姆特電玩資訊站',
    operator: 'Gamania Digital',
    category: 'community',
    hosts: ['gamer.com.tw'],
    sourceUrl: 'https://www.gamer.com.tw/',
  },
]);

/** Most specific host wins, so tw.search.yahoo.com is not labelled as the portal. */
export function taiwanSourceForHost(host: string | null | undefined) {
  const value = host?.trim().toLowerCase().replace(/\.$/, '');
  if (!value) return undefined;
  let best: { source: TaiwanReferralSource; length: number } | undefined;
  for (const source of taiwanReferralSources)
    for (const domain of source.hosts)
      if (
        (value === domain || value.endsWith(`.${domain}`)) &&
        (!best || domain.length > best.length)
      )
        best = { source, length: domain.length };
  return best?.source;
}

/** Taiwan-facing content signals that a page or host can carry. */
export const isTaiwanDomain = (host: string) =>
  /(^|\.)[^.]+\.tw$/i.test(host.trim().replace(/\.$/, ''));
export function chineseScriptForLanguageTag(tag: string | null | undefined) {
  const value = tag?.trim().toLowerCase();
  if (!value?.startsWith('zh')) return 'not_chinese' as const;
  if (/^zh-(hant|tw|hk|mo)(-|$)/.test(value)) return 'traditional' as const;
  if (/^zh-(hans|cn|sg|my)(-|$)/.test(value)) return 'simplified' as const;
  return 'unspecified' as const;
}
