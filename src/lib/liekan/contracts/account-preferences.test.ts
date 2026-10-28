// @vitest-environment node
import { describe, expect, it } from 'vitest';
import countryNames from '../../../../public/intl/country/zh-CN.json' with { type: 'json' };
import {
  ACCOUNT_DEFAULT_RANGE,
  ACCOUNT_DEFAULT_TIMEZONE,
  accountCountryCodes,
  accountTimezoneForCountry,
  canonicalAccountTimezone,
  countryTimezoneChoices,
  initializeAccountPreferencesSchema,
  isAccountDateRange,
  isAccountTimezoneForCountry,
  normalizeAccountDateRange,
  saveAccountPreferencesSchema,
  validateTimezone,
} from './account-preferences';
import catalog from './country-timezones.json' with { type: 'json' };

describe('bundled account country and timezone catalog', () => {
  it('covers the current geography country names with pinned official IANA source hashes', () => {
    expect(accountCountryCodes.sort()).toEqual(Object.keys(countryNames).sort());
    expect(catalog.version).toMatch(/^\d{4}[a-z]+$/);
    expect(catalog.sources.find(source => source.file === 'zone.tab')).toBeDefined();
    expect(catalog.sources.find(source => source.file === 'zone1970.tab')).toBeDefined();
    expect(catalog.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
    expect(accountCountryCodes.every(code => countryTimezoneChoices(code).length > 0)).toBe(true);
    expect(countryTimezoneChoices('CN')).toEqual(['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Taipei']);
    expect(countryTimezoneChoices('JP')).toEqual(['Asia/Tokyo']);
    expect(countryTimezoneChoices('US')).toContain('America/Los_Angeles');
    expect(countryTimezoneChoices('US')).toContain('America/New_York');
    expect(countryTimezoneChoices('unknown')).toEqual([]);
    expect(ACCOUNT_DEFAULT_TIMEZONE).toBe('Asia/Taipei');
    expect(ACCOUNT_DEFAULT_RANGE).toBe('0day');
  });

  it.each([
    ['IN', 'Asia/Calcutta', 'Asia/Kolkata'],
    ['NP', 'Asia/Katmandu', 'Asia/Kathmandu'],
    ['CN', 'PRC', 'Asia/Shanghai'],
    ['JP', 'Japan', 'Asia/Tokyo'],
    ['US', 'US/Eastern', 'America/New_York'],
    ['UA', 'Europe/Kiev', 'Europe/Kyiv'],
  ])('accepts canonical aliases for %s including older ICU preferences', (country, alias, zone) => {
    expect(validateTimezone(alias)).toBe(true);
    expect(canonicalAccountTimezone(alias)).toBe(canonicalAccountTimezone(zone));
    expect(accountTimezoneForCountry(country, alias)).toBe(zone);
    expect(
      saveAccountPreferencesSchema.safeParse({ countryCode: country, timezone: alias }).success,
    ).toBe(true);
  });

  it.each([
    ['NP', 'Asia/Kathmandu'],
    ['IN', 'Asia/Kolkata'],
    ['AU', 'Australia/Eucla'],
    ['AU', 'Australia/Adelaide'],
    ['NZ', 'Pacific/Chatham'],
    ['CA', 'America/St_Johns'],
  ])('permits the half/quarter-hour zone %s / %s', (country, zone) => {
    expect(isAccountTimezoneForCountry(country, zone)).toBe(true);
  });

  it.each([
    ['CN', 'Asia/Tokyo'],
    ['JP', 'Asia/Shanghai'],
    ['US', 'Europe/London'],
    ['GB', 'UTC'],
    ['ZZ', 'Asia/Shanghai'],
    ['US', ''],
    ['US', 'GMT+8'],
  ])('rejects country/zone mismatch %s / %s', (countryCode, timezone) => {
    expect(saveAccountPreferencesSchema.safeParse({ countryCode, timezone }).success).toBe(false);
  });

  it.each([null, 8, '', 'invalid/zone', '+08:00', 'Asia/Shanghai;DROP TABLE', 'x'.repeat(81)])(
    'rejects invalid timezone %s',
    value => expect(validateTimezone(value)).toBe(false),
  );

  it('rejects absent explicit zone selection and payload fields owned by the server', () => {
    expect(saveAccountPreferencesSchema.safeParse({ countryCode: 'US' }).success).toBe(false);
    expect(
      saveAccountPreferencesSchema.safeParse({
        countryCode: 'US',
        timezone: 'America/New_York',
        configured: true,
      }).success,
    ).toBe(false);
    expect(
      initializeAccountPreferencesSchema.safeParse({ timezone: 'Asia/Tokyo', userId: 'other' })
        .success,
    ).toBe(false);
  });
});

describe('account date preference compatibility', () => {
  it.each([
    '0day',
    '0week',
    '7day',
    '0month',
    '30day',
    '90day',
    '0year',
    '6month',
    '12month',
    '1month',
    '6hour',
    'range:0:86400000',
    'range:0:86400000:day',
    'range:0:86400000:all',
  ])('preserves %s', range => {
    expect(isAccountDateRange(range)).toBe(true);
    expect(normalizeAccountDateRange(range)).toBe(range);
  });
  it('migrates only the rolling 24-hour preference to Today', () => {
    expect(normalizeAccountDateRange('24hour')).toBe('0day');
    expect(normalizeAccountDateRange('48hour')).toBe('48hour');
  });
  it.each([
    undefined,
    null,
    'all',
    'custom',
    'garbage',
    'range:NaN:100',
    'range:100:99',
    'range:0:Infinity',
    'range:0:8640000000000001',
    '9007199254740992day',
    'range:0:100:bad',
  ])('rejects malformed or nonfinite range %s', value => {
    expect(isAccountDateRange(value)).toBe(false);
    expect(normalizeAccountDateRange(value)).toBe('0day');
  });
});
