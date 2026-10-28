import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import clickhouse from '../src/lib/clickhouse';
import { identifyCity } from '../src/lib/liekan/contracts/geography';
import {
  cityNameSQL,
  geographyQueryParams,
  withClickHouseGeographySQL,
} from '../src/lib/liekan/upstream/geography-query';

const fixture = [
  ['a', 'CN', 'CN-SN', 'Xian'],
  ['b', 'CN', 'CN-61', '西安'],
  ['c', 'CN', 'CN-SC', 'Chengdu'],
  ['d', 'CN', 'CN-JS', 'Suzhou'],
  ['e', 'CN', 'CN-AH', 'Suzhou'],
  ['f', 'CN', null, 'Suzhou'],
  ['g', 'US', 'US-CA', "Xi'an"],
  ['h', 'CN', 'CN-SN', null],
  ['i', 'TW', null, 'Taipei'],
  ['j', 'CN', 'CN-37', 'Jinan'],
  ['k', 'CN', 'CN-SD', '济南'],
  ['l', 'CN', 'CN-SN', 'Unlisted Town'],
  ['u1', 'CN', 'CN-XJ', 'Ürümqi'],
  ['u2', 'CN', 'CN-65', 'Ürümqi'.normalize('NFD')],
  ['j1', 'CN', null, "Ji'an"],
  ['j2', 'CN', null, 'Ji’an'],
  ['j3', 'CN', 'CN-JX', 'Ji’an'],
  ['w1', 'CN', 'CN-SD', '\tJinan\n'],
  ['w2', 'CN', 'CN-SD', '\u00a0Jinan\u00a0'],
  ['w3', 'CN', 'CN-SD', '\u3000Jinan\u3000'],
  ['w4', ' CN ', 'CN-SD', 'Jinan'],
  ['w5', 'CN', ' CN-SD ', 'Jinan'],
  ['w6', '\tCN\u3000', '\u00a0CN-SD\n', 'Jinan'],
  ['cx', 'US', 'CN-SD', 'Jinan'],
  ['co', null, 'CN-SD', 'Jinan'],
].map(([id, country, region, city]) => ({
  id,
  country,
  region,
  city,
  session_id: id,
  website_id: '11111111-1111-4111-8111-111111111111',
  created_at: '2026-10-10 12:00:00',
}));
const cases: [Record<string, string>, string[]][] = [
  [{ city: 'eq.西安' }, ['a', 'b']],
  [{ city: 'eq.Xian' }, ['a', 'b']],
  [{ city: 'c.西安' }, ['a', 'b']],
  [{ city: "re.^Xi'an$" }, ['a', 'b', 'g']],
  [{ city: 'eq.苏州' }, ['d']],
  [{ city: 'eq.宿州' }, ['e']],
  [{ city: 'eq.台北' }, ['i']],
  [{ country: 'eq.TW' }, ['i']],
  [{ region: 'eq.CN-71' }, ['i']],
  [{ region: 'c.台湾' }, ['i']],
  [{ city: 'eq.吉安' }, ['j3']],
  [{ city: 'eq.乌鲁木齐' }, ['u1', 'u2']],
  [{ city: 'eq.Ürümqi' }, ['u1', 'u2']],
  [{ city: 'c.乌鲁木齐' }, ['u1', 'u2']],
  [{ city: `c.${'Ürümqi'.normalize('NFD')}` }, ['u1', 'u2']],
  [{ city: `re.^${'Ürümqi'.normalize('NFD')}$` }, ['u1', 'u2']],
  [
    { city: `dnc.${'Ürümqi'.normalize('NFD')}` },
    fixture
      .filter(row => row.city != null && !['u1', 'u2'].includes(row.id))
      .map(row => row.id)
      .sort(),
  ],
  [
    { city: `nre.^${'Ürümqi'.normalize('NFD')}$` },
    fixture
      .filter(row => row.city != null && !['u1', 'u2'].includes(row.id))
      .map(row => row.id)
      .sort(),
  ],
  [{ city: 'eq.济南' }, ['j', 'k', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6']],
  [{ drill_city: 'eq.西安' }, ['a', 'b']],
  [
    Object.fromEntries(Array.from({ length: 58 }, (_, i) => [i ? `city${i}` : 'city', 'c.西安'])),
    ['a', 'b'],
  ],
];
const params: Record<string, unknown> = { ...geographyQueryParams() };
const expected: Record<string, string[]> = {};
const statements = cases.map(([filter, ids], index) => {
  const parsed = clickhouse.parseFilters(filter);
  let predicate = parsed.filterQuery;
  for (const [key, value] of Object.entries(parsed.queryParams)) {
    const name = `case_${index}_${key}`;
    params[name] = value;
    predicate = predicate.replaceAll(`{${key}:`, `{${name}:`);
  }
  expected[String(index)] = ids;
  return `SELECT '${index}' AS scenario,arraySort(groupArray(id)) AS ids FROM website_event WHERE true ${predicate}`;
});
const names = cityNameSQL('country', 'region', 'city', 'clickhouse');
statements.push(
  `SELECT 'names' AS scenario,arraySort(groupArray(concat(id,'=',coalesce(${names},'NULL')))) AS ids FROM website_event`,
);
expected.names = fixture.map(row => `${row.id}=${identifyCity(row).name ?? 'NULL'}`).sort();
const west = clickhouse.parseFilters({ city: 'eq.西安' }).filterQuery;
params.city = ['西安'];
statements.push(
  `SELECT 'nested' AS scenario,arraySort(groupArray(id)) AS ids FROM (WITH 1 AS marker SELECT id FROM website_event WHERE marker=1 ${west})`,
);
expected.nested = ['a', 'b'];
const cohort = clickhouse.parseFilters({ cohort_city: 'eq.西安' }).cohortQuery;
params.cohort_city = ['西安'];
params.websiteId = '11111111-1111-4111-8111-111111111111';
params.cohort_startDate = '2026-10-01 00:00:00';
params.cohort_endDate = '2026-10-11 00:00:00';
statements.push(
  `SELECT 'cohort' AS scenario,arraySort(groupArray(id)) AS ids FROM website_event ${cohort}`,
);
expected.cohort = ['a', 'b'];
statements.push(
  `SELECT 'count' AS scenario,[toString(count(*))] AS ids FROM (WITH 1 AS marker SELECT id FROM website_event WHERE marker=1 ${west}) t`,
);
expected.count = ['2'];
const sql = withClickHouseGeographySQL(`WITH 1 AS outer_marker ${statements.join(' UNION ALL ')}`);
assert(
  Buffer.byteLength(sql) < 240 * 1024,
  `Compound geography exceeds the default parser budget: ${Buffer.byteLength(sql)} bytes`,
);
const directory = mkdtempSync(path.join(tmpdir(), 'liekan-geography-ch-'));
const parameter = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(item => (Array.isArray(item) ? parameter(item) : typeof item === 'number' ? String(item) : `'${String(item).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`)).join(',')}]`
    : String(value);
try {
  writeFileSync(
    path.join(directory, 'fixture.jsonl'),
    fixture.map(row => JSON.stringify(row)).join('\n') + '\n',
  );
  writeFileSync(path.join(directory, 'query.sql'), sql);
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '--entrypoint',
      'clickhouse',
      '--mount',
      `type=bind,src=${directory},dst=/fixtures,readonly`,
      'clickhouse/clickhouse-server:25.8',
      'local',
      '--max_threads',
      '2',
      '--enable_global_with_statement',
      '1',
      '--structure',
      'id String,country Nullable(String),region Nullable(String),city Nullable(String),session_id String,website_id UUID,created_at DateTime64',
      '--input-format',
      'JSONEachRow',
      '--file',
      '/fixtures/fixture.jsonl',
      '--table',
      'website_event',
      '--queries-file',
      '/fixtures/query.sql',
      '--output-format',
      'JSONEachRow',
      ...Object.entries(params)
        .filter(([key]) => sql.includes(`{${key}:`))
        .flatMap(([key, value]) => [`--param_${key}`, parameter(value)]),
    ],
    { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.stderr);
  const actual = Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map(line => {
        const row = JSON.parse(line);
        return [row.scenario, row.ids];
      }),
  );
  assert.deepEqual(actual, expected);
  console.log(
    JSON.stringify({
      engine: 'ClickHouse 25.8 local',
      isolated: true,
      checks: statements.length,
      queryBytes: Buffer.byteLength(sql),
    }),
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
