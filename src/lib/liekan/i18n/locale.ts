export const liekanLocales = ['zh-TW', 'zh-CN', 'en-US'] as const;
export type LiekanLocale = (typeof liekanLocales)[number];
export const localeCookie = 'liekan.locale';
/** GEOInflow TW default when neither the browser nor the deployment states a preference. */
export const fallbackLiekanLocale: LiekanLocale = 'zh-TW';

export function isLiekanLocale(value: unknown): value is LiekanLocale {
  return value === 'zh-TW' || value === 'zh-CN' || value === 'en-US';
}

/** Chinese locales share source-text layout rules (no inter-word spaces, full-width punctuation). */
export const isChineseLocale = (locale: LiekanLocale) => locale !== 'en-US';

export function defaultLiekanLocale(value?: string): LiekanLocale {
  const configured = value?.trim().toLowerCase();
  if (configured?.startsWith('en')) return 'en-US';
  if (configured === 'zh-cn' || configured === 'zh-hans' || configured === 'zh-hans-cn')
    return 'zh-CN';
  return fallbackLiekanLocale;
}

/**
 * Persisted server records (rollups, snapshots, repair jobs) only accept the two original
 * locales. Traditional Chinese shares the Simplified source identity and is converted at render.
 */
export function storageLiekanLocale(locale: LiekanLocale): 'zh-CN' | 'en-US' {
  return locale === 'en-US' ? 'en-US' : 'zh-CN';
}

export function readLocaleCookie(cookies: string): LiekanLocale | undefined {
  const value = cookies.split(';').find(part => part.trim().startsWith(`${localeCookie}=`));
  if (!value) return undefined;
  try {
    const locale = decodeURIComponent(value.trim().slice(localeCookie.length + 1));
    return isLiekanLocale(locale) ? locale : undefined;
  } catch {
    return undefined;
  }
}

/** Cookie is the current preference; local storage provides the upgrade path. */
export function resolveLiekanLocale(input: {
  cookie?: unknown;
  stored?: unknown;
  hint?: unknown;
  configured?: string;
}): LiekanLocale {
  for (const value of [input.cookie, input.stored, input.hint])
    if (isLiekanLocale(value)) return value;
  return defaultLiekanLocale(input.configured);
}
