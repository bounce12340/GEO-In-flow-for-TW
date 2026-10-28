import { expect, test } from 'vitest';
import {
  getCountryFilterValues,
  getPostgresCountrySQL,
  getRegionFilterValues,
  isTaiwanGeography,
  LEGACY_TAIWAN_REGION_CODE,
  normalizeCountryCode,
  normalizeRegionCode,
  TAIWAN_ALPHA3_CODE,
  TAIWAN_COUNTRY_CODE,
  TAIWAN_REGION_FILTER_VALUE,
} from './country';

const taiwanCounties = [
  'TW-CHA',
  'TW-CYI',
  'TW-CYQ',
  'TW-HSQ',
  'TW-HSZ',
  'TW-HUA',
  'TW-ILA',
  'TW-KEE',
  'TW-KHH',
  'TW-KIN',
  'TW-LIE',
  'TW-MIA',
  'TW-NAN',
  'TW-NWT',
  'TW-PEN',
  'TW-PIF',
  'TW-TAO',
  'TW-TNN',
  'TW-TPE',
  'TW-TTT',
  'TW-TXG',
  'TW-YUN',
];

test('reports Taiwan as its own country code', () => {
  expect(normalizeCountryCode(TAIWAN_COUNTRY_CODE)).toBe('TW');
  expect(normalizeCountryCode(TAIWAN_ALPHA3_CODE)).toBe('TW');
  expect(normalizeCountryCode('tw')).toBe('TW');
  expect(normalizeCountryCode('twn')).toBe('TW');
  expect(normalizeCountryCode('CN')).toBe('CN');
  expect(normalizeCountryCode('cn', 'CN-BJ')).toBe('CN');
});

test.each([
  ['CN', 'CN-71'],
  ['CN', 'CN-TW'],
  ['CN', 'CN-TPE'],
  ['CN', 'cn-Khh'],
  ['CN', 'HSZ'],
  ['CN', 'TW'],
  ['CN', '71'],
  ['', 'CN-71'],
  [null, 'CN-TPE'],
  [undefined, 'TW-TPE'],
  [undefined, 'TWN-KHH'],
])('normalizes legacy China-Taiwan country %s and region %s to TW', (country, region) => {
  expect(isTaiwanGeography(country, region)).toBe(true);
  expect(normalizeCountryCode(country, region)).toBe('TW');
});

test.each([
  ['CN', 'CN-BJ', 'CN'],
  ['CN', null, 'CN'],
  ['CN', 'CN-91', 'CN'],
  ['US', 'TW-TPE', 'US'],
  ['US', 'CN-TPE', 'US'],
  [undefined, 'TPE', undefined],
  [null, null, null],
  ['', '', ''],
])('keeps other countries for country %s and region %s', (country, region, expected) => {
  expect(isTaiwanGeography(country, region)).toBe(false);
  expect(normalizeCountryCode(country, region)).toBe(expected);
});

test.each([
  ['TW', 'TPE', 'TW-TPE'],
  ['TW', 'TW-TPE', 'TW-TPE'],
  ['TWN', 'KHH', 'TW-KHH'],
  ['TWN', 'TWN-KHH', 'TW-KHH'],
  ['CN', 'CN-TPE', 'TW-TPE'],
  ['CN', 'CN-tpe', 'TW-TPE'],
  ['CN', 'cn-Khh', 'TW-KHH'],
  ['CN', 'HSZ', 'TW-HSZ'],
  ['CN', 'CYI', 'TW-CYI'],
  [undefined, 'TW-NWT', 'TW-NWT'],
  [undefined, 'TWN-KHH', 'TW-KHH'],
  [undefined, 'CN-TPE', 'TW-TPE'],
])('uses ISO 3166-2:TW codes for country %s and region %s', (country, region, expected) => {
  expect(normalizeRegionCode(region, country)).toBe(expected);
});

test.each([
  ['TW', null, null],
  ['TW', undefined, undefined],
  ['TW', '', ''],
  ['tw', 'unknown', null],
  ['TW', 'TW', null],
  ['CN', 'CN-71', null],
  ['CN', 'CN-TW', null],
  ['CN', 'TW', null],
  ['', 'CN-71', null],
])(
  'keeps no county when country %s and region %s only identify Taiwan',
  (country, region, expected) => {
    expect(normalizeRegionCode(region, country)).toBe(expected);
  },
);

test.each([
  ['CN', null, null],
  ['CN', undefined, undefined],
  ['CN', '', ''],
  ['CN', 'CN-BJ', 'CN-BJ'],
  ['US', 'CA', 'US-CA'],
  ['US', 'CN-TPE', 'US-TPE'],
  [undefined, undefined, undefined],
  [undefined, 'TPE', 'TPE'],
])(
  'preserves other or missing geography for country %s and region %s',
  (country, region, expected) => {
    expect(normalizeRegionCode(region, country)).toBe(expected);
  },
);

test('country filters keep China and Taiwan separate', () => {
  expect(getCountryFilterValues(['CN'])).toEqual(['CN']);
  expect(getCountryFilterValues(['TW'])).toEqual(['TW']);
  expect(getCountryFilterValues(['TWN', 'tw'])).toEqual(['TW']);
  expect(getCountryFilterValues(['CN', 'TW'])).toEqual(['CN', 'TW']);
});

test('old Taiwan county region links select their ISO 3166-2:TW county', () => {
  expect(getRegionFilterValues(['CN-TPE'])).toEqual(['TW-TPE']);
  expect(getRegionFilterValues(['TWN-KHH'])).toEqual(['TW-KHH']);
  expect(getRegionFilterValues(['TW-HSZ', 'CN-hsz'])).toEqual(['TW-HSZ']);
  expect(getRegionFilterValues(['CN-SH'])).toEqual(['CN-31']);
  expect(getRegionFilterValues(['山东'])).toEqual(['CN-37']);
});

test.each([LEGACY_TAIWAN_REGION_CODE, 'CN-TW', '台湾', '台灣'])(
  'the former Taiwan province %s selects every Taiwan record',
  value => {
    expect(getRegionFilterValues([value])).toEqual([TAIWAN_REGION_FILTER_VALUE, ...taiwanCounties]);
  },
);

test('China province coverage no longer includes Taiwan', () => {
  expect(getRegionFilterValues(['CN-71'])).not.toContain('CN-71');
  expect(normalizeRegionCode('CN-71', 'CN')).toBeNull();
});

test('country SQL maps Taiwan and legacy China-Taiwan rows to TW', () => {
  const sql = getPostgresCountrySQL('s.country', 's.region');
  expect(sql).toContain("upper(s.country) in ('TW', 'TWN')");
  expect(sql).toContain("upper(s.region) like 'TW-%'");
  expect(sql).toContain("'CN-71'");
  expect(sql).toContain("'CN-TPE'");
  expect(sql).toContain("then 'TW' else upper(s.country) end");
  expect(sql).not.toContain("then 'CN'");
});
