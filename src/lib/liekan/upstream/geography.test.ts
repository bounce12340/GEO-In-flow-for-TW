import { expect, test } from 'vitest';
import { geographyCoverage, geographyLabel } from '../contracts/geography';
import { countryName, regionName } from './geography';

test('labels Taiwan as its own country with ISO 3166-2:TW regions', () => {
  expect(countryName('TW')).toBe('台湾');
  expect(countryName('TWN')).toBe('台湾');
  expect(countryName('TW', 'zh-TW')).toBe('台灣');
  expect(countryName('TW', 'en-US')).toBe('Taiwan');
  expect(regionName('TW-KHH', 'TW')).toBe('TW-KHH');
  expect(regionName('CN-TPE', 'CN')).toBe('TW-TPE');
  expect(regionName('TWN-KHH', 'TWN', 'en-US')).toBe('TW-KHH');
  expect(countryName('JP')).toBe('日本');
  expect(regionName('CN-31')).toBe('上海');
});

test('labels legacy China-Taiwan records as Taiwan', () => {
  expect(geographyLabel({ country: 'CN', region: 'CN-71' })).toBe('台湾 · 城市未知');
  expect(geographyLabel({ country: 'CN', region: 'CN-TPE' })).toBe('TW-TPE · 城市未知');
  expect(geographyLabel({ country: 'TW' }, 'zh-TW')).toBe('台灣 · 城市未知');
  expect(geographyLabel({ country: 'CN', region: 'CN-71', city: 'Taipei' }, 'en-US')).toBe(
    'Taipei',
  );
  expect(geographyLabel({ country: 'CN', region: 'CN-KHH', city: '高雄' })).toBe('高雄');
});

test('China province coverage excludes Taiwan records', () => {
  const coverage = geographyCoverage(
    [
      {
        country: 'CN',
        region: 'CN-SD',
        city: null,
        sessions: 2,
        bounces: 0,
        conversions: 0,
        duration: null,
      },
      {
        country: 'CN',
        region: 'CN-71',
        city: null,
        sessions: 3,
        bounces: 0,
        conversions: 0,
        duration: null,
      },
      {
        country: 'TW',
        region: 'TW-TPE',
        city: null,
        sessions: 4,
        bounces: 0,
        conversions: 0,
        duration: null,
      },
    ],
    9,
  );
  expect(coverage).toMatchObject({
    chinaVisits: 2,
    chinaProvinceKnownVisits: 2,
    chinaProvinceCoverage: 100,
  });
});

test('shows the same simplified province label for historic letter and numeric codes', () => {
  expect(regionName('CN-SD')).toBe('山东');
  expect(regionName('CN-37')).toBe('山东');
  expect(regionName('CN-SN')).toBe('陕西');
  expect(regionName('CN-SX')).toBe('山西');
  expect(regionName('CN-GX')).toBe('广西');
  expect(regionName('CN-71')).not.toBe('台湾');
});
