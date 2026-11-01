import { describe, expect, test } from 'vitest';
import clickhouse, { CLICKHOUSE_DATE_FORMATS } from './clickhouse';

describe('CLICKHOUSE_DATE_FORMATS', () => {
  test('uses date format tokens compatible with ClickHouse 22.8 and newer', () => {
    expect(CLICKHOUSE_DATE_FORMATS).toMatchObject({
      utc: '%Y-%m-%dT%TZ',
      second: '%Y-%m-%dT%T',
      minute: '%Y-%m-%d %R:00',
    });
  });
});

describe('getDateSQL bucket formatting', () => {
  // Regression: getDateSQL used to return a native DateTime whose "iso" serialization
  // is a genuine UTC instant - unlike Postgres's already-shifted-but-Z-labeled value,
  // which the frontend assumes for every backend. formatDateTime makes it match.
  test('formats an explicit "Z" via formatDateTime instead of relying on native DateTime serialization', () => {
    expect(clickhouse.getDateSQL('website_event.created_at', 'hour', 'Asia/Tokyo')).toBe(
      `formatDateTime(date_trunc('hour', website_event.created_at, 'Asia/Tokyo'), '%Y-%m-%dT%H:00:00Z', 'Asia/Tokyo')`,
    );
  });

  test('omits the timezone argument to formatDateTime when no timezone is given', () => {
    expect(clickhouse.getDateSQL('website_event.created_at', 'day')).toBe(
      `formatDateTime(date_trunc('day', website_event.created_at), '%Y-%m-%dT00:00:00Z')`,
    );
  });

  test('covers every bucket unit with an explicit "Z"', () => {
    expect(clickhouse.getDateSQL('created_at', 'minute', 'UTC')).toBe(
      `formatDateTime(date_trunc('minute', created_at, 'UTC'), '%Y-%m-%dT%R:00Z', 'UTC')`,
    );
    expect(clickhouse.getDateSQL('created_at', 'month', 'UTC')).toBe(
      `formatDateTime(date_trunc('month', created_at, 'UTC'), '%Y-%m-01T00:00:00Z', 'UTC')`,
    );
    expect(clickhouse.getDateSQL('created_at', 'year', 'UTC')).toBe(
      `formatDateTime(date_trunc('year', created_at, 'UTC'), '%Y-01-01T00:00:00Z', 'UTC')`,
    );
  });
});

describe('Liekan breakdown drill filters', () => {
  test('keeps repeated city filters bounded before the ClickHouse parser', () => {
    const parsed = clickhouse.parseFilters(
      Object.fromEntries(Array.from({ length: 58 }, (_, i) => [i ? `city${i}` : 'city', 'c.an'])),
    );
    expect(Buffer.byteLength(parsed.filterQuery)).toBeLessThan(40 * 1024);
  });
  test('fits compound city conditions inside the default ClickHouse query size', () => {
    const parsed = clickhouse.parseFilters({
      city: 're.^Xian$',
      city1: 'nre.^Suzhou$',
      city2: 'c.西安',
      drill_city: 'eq.西安',
      cohort_city: 'eq.Chengdu',
    });
    expect(Buffer.byteLength(parsed.filterQuery + parsed.cohortQuery)).toBeLessThan(240 * 1024);
  });
  test('expands saved city aliases in equality, exclusion and drill parameters', () => {
    for (const key of ['city', 'drill_city']) {
      for (const operator of ['eq', 'neq']) {
        const parsed = clickhouse.parseFilters({ [key]: `${operator}.Xian,Chengdu` });
        expect(parsed.queryParams[key]).toEqual(['西安', '成都', 'Xian', 'Chengdu']);
      }
    }
  });
  test('matches null and empty dimensions as a mandatory drill condition', () => {
    const parsed = clickhouse.parseFilters({
      country: 'eq.CN',
      path: 'eq./home',
      match: 'any',
      drill_country: 'empty.',
    });
    expect(parsed.filterQuery).toContain(' is null or ');
    expect(parsed.filterQuery).toContain("upper(website_event.country)) = '')");
    expect(parsed.filterQuery).toContain(' or ');
    expect(parsed.filterQuery).not.toContain('IN {drill_country:Array(String)}');
  });
  test('retains normal literal filtering and normalized country drill values', () => {
    const literal = clickhouse.parseFilters({ country: 'empty.' });
    expect(literal.filterQuery).toContain(
      'upper(website_event.country)) IN {country:Array(String)}',
    );
    expect(literal.queryParams).toMatchObject({ country: ['EMPTY.'] });
    const drill = clickhouse.parseFilters({ drill_country: 'eq.CN' });
    expect(drill.queryParams).toMatchObject({ drill_country: ['CN'] });
  });
  test('compares country equality on the normalized code only', () => {
    const china = clickhouse.parseFilters({ country: 'eq.CN' });
    expect(china.queryParams).toMatchObject({ country: ['CN'] });
    expect(china.filterQuery).toContain(
      "'TW', upper(website_event.country)) IN {country:Array(String)}",
    );
    expect(china.filterQuery).not.toContain('coalesce(website_event.country, if(');
    const taiwan = clickhouse.parseFilters({ country: 'neq.TWN' });
    expect(taiwan.queryParams).toMatchObject({ country: ['TW'] });
    expect(taiwan.filterQuery).toContain('NOT IN {country:Array(String)}');
  });
  test.each(['eq', 'neq'])(
    'the former Taiwan province selects all Taiwan rows with %s',
    operator => {
      const parsed = clickhouse.parseFilters({ region: `${operator}.CN-71` });
      expect((parsed.queryParams as Record<string, string[]>).region).toEqual(
        expect.arrayContaining(['TW', 'TW-TPE', 'TW-KHH']),
      );
      expect((parsed.queryParams as Record<string, string[]>).region).not.toContain('CN-71');
      expect(parsed.filterQuery).toContain("upper(website_event.country) in ('TW', 'TWN')");
      expect(parsed.filterQuery).toContain("'TW-YUN'], ''), if(");
      expect(parsed.filterQuery).toContain(
        operator === 'eq' ? 'IN {region:Array(String)}' : 'NOT IN {region:Array(String)}',
      );
      expect(parsed.filterQuery).toContain(
        `${operator === 'eq' ? ' or ' : ' and not '}((upper(website_event.country) in ('TW', 'TWN')`,
      );
      expect(parsed.filterQuery).toContain("has({region:Array(String)}, 'TW')");
    },
  );
  test('normalizes legacy county drills and keeps mainland filters separate', () => {
    const parsed = clickhouse.parseFilters({ drill_region: 'eq.TWN-KHH', region: 'eq.CN-SH' });
    expect(parsed.queryParams).toMatchObject({ drill_region: ['TW-KHH'], region: ['CN-31'] });
    expect(parsed.filterQuery).toContain('IN {drill_region:Array(String)}');
  });
  test.each(['c', 'dnc', 're', 'nre'])('keeps saved province %s filters compatible', operator => {
    const parsed = clickhouse.parseFilters({ region: `${operator}.CN-TPE` });
    const join = ['c', 're'].includes(operator) ? 'or' : 'and';
    expect(parsed.filterQuery).toContain(
      operator === 'dnc' || operator === 'nre' ? 'not arrayExists' : 'and arrayExists',
    );
    expect(parsed.filterQuery).toContain("'TW-YUN'], ''), if(");
    expect(parsed.filterQuery).toContain(
      operator.includes('re') ? 'match(alias, ' : 'positionCaseInsensitiveUTF8(alias, ',
    );
  });
});
