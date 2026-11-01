import { z } from 'zod';
import catalog from './country-timezones.json' with { type: 'json' };

export const ACCOUNT_DEFAULT_TIMEZONE = 'Asia/Taipei';
export const ACCOUNT_DEFAULT_RANGE = '0day';
export const accountCountryCodes: string[] = Object.keys(catalog.countries);
export const accountTimezoneCatalogVersion = catalog.version;
const countries: Record<string, string[]> = catalog.countries;
const timezoneNames = new Map(
  [...catalog.zones, ...Object.keys(catalog.aliases)].map(zone => [zone.toLowerCase(), zone]),
);
const aliases: Record<string, string> = catalog.aliases;

export function countryTimezoneChoices(countryCode: string): string[] {
  return Object.hasOwn(countries, countryCode) ? [...countries[countryCode]] : [];
}

/** Stable IANA comparison identity, including aliases preferred by older ICU releases. */
export function canonicalAccountTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+./-]{0,79}$/.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
    const known =
      timezoneNames.get(value.toLowerCase()) || timezoneNames.get(resolved.toLowerCase());
    return known ? aliases[known] || known : null;
  } catch {
    return null;
  }
}

export const validateTimezone = (value: unknown): value is string =>
  canonicalAccountTimezone(value) !== null;

export function accountTimezoneForCountry(countryCode: string, timezone: string): string | null {
  const canonical = canonicalAccountTimezone(timezone);
  return canonical
    ? countryTimezoneChoices(countryCode).find(
        zone => canonicalAccountTimezone(zone) === canonical,
      ) || null
    : null;
}

export const isAccountTimezoneForCountry = (countryCode: string, timezone: string) =>
  accountTimezoneForCountry(countryCode, timezone) !== null;

/** Keep the existing parser's numeric tokens and finite custom ranges. */
export function isAccountDateRange(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  const relative = value.match(/^(\d+)(hour|day|week|month|year)$/);
  if (relative) {
    const count = Number(relative[1]);
    const duration = {
      hour: 3600000,
      day: 86400000,
      week: 604800000,
      month: 2678400000,
      year: 31622400000,
    };
    return (
      Number.isSafeInteger(count) &&
      Number.isFinite(+new Date(Date.now() - count * duration[relative[2]]))
    );
  }
  const custom = value.match(
    /^range:(-?\d+):(-?\d+)(?::(?:all|minute|hour|day|week|month|year))?$/,
  );
  if (!custom) return false;
  const start = Number(custom[1]),
    end = Number(custom[2]);
  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start <= end &&
    Number.isFinite(+new Date(start)) &&
    Number.isFinite(+new Date(end))
  );
}

export function normalizeAccountDateRange(value: unknown): string {
  return isAccountDateRange(value) && value !== '24hour' ? value : ACCOUNT_DEFAULT_RANGE;
}

export const accountPreferencesSchema = z
  .object({
    countryCode: z.string().nullable(),
    timezone: z.string(),
    range: z.string(),
    configured: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .strict();

export const initializeAccountPreferencesSchema = z
  .object({
    timezone: z.string().max(80).optional(),
    range: z.string().max(100).optional(),
  })
  .strict();

export const saveAccountPreferencesSchema = z
  .object({
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .refine(code => code in countries, '国家或地区无效'),
    timezone: z.string().max(80),
    range: z.string().max(100).refine(isAccountDateRange, '日期范围无效').optional(),
  })
  .strict()
  .refine(value => isAccountTimezoneForCountry(value.countryCode, value.timezone), {
    path: ['timezone'],
    message: '请选择所选国家或地区的具体时区',
  });

export type AccountPreferences = z.infer<typeof accountPreferencesSchema>;
export type InitializeAccountPreferences = z.infer<typeof initializeAccountPreferencesSchema>;
export type SaveAccountPreferences = z.infer<typeof saveAccountPreferencesSchema>;

export const defaultAccountPreferences: AccountPreferences = {
  countryCode: 'TW',
  timezone: ACCOUNT_DEFAULT_TIMEZONE,
  range: ACCOUNT_DEFAULT_RANGE,
  configured: false,
  updatedAt: null,
};
