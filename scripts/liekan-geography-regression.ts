import assert from 'node:assert/strict';
import pg from 'pg';
import prisma from '../src/lib/prisma';
import { cityNameSQL } from '../src/lib/liekan/upstream/geography-query';
import { getValues } from '../src/queries/sql/getValues';

const url = new URL(process.env.DATABASE_URL || '');
if (!/^\/liekan_(verify|regression)(?:_[a-zA-Z0-9_]+)?$/.test(url.pathname))
  throw new Error('Use an isolated Liekan verification database');
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
].map(([id, country, region, city]) => ({ id, country, region, city }));
const cte = `WITH session AS (SELECT *,id AS session_id FROM jsonb_to_recordset($1::jsonb) AS fixture(id text,country text,region text,city text)),website_event AS(SELECT id,session_id FROM session)`;
const cases: [Record<string, string>, string[]][] = [
  [{ city: 'eq.西安' }, ['a', 'b']],
  [{ city: 'eq.Xian' }, ['a', 'b']],
  [{ city: 'c.Xian' }, ['a', 'b']],
  [{ city: "re.^Xi'an$" }, ['a', 'b', 'g']],
  [{ city: 'dnc.Xian' }, ['c', 'd', 'e', 'f', 'g', 'i', 'j', 'k', 'l']],
  [{ city: "nre.^Xi'an$" }, ['c', 'd', 'e', 'f', 'i', 'j', 'k', 'l']],
  [{ city: 'eq.苏州' }, ['d']],
  [{ city: 'eq.宿州' }, ['e']],
  [{ city: 'eq.台北' }, ['i']],
  [{ country: 'eq.TW' }, ['i']],
  [{ region: 'eq.CN-71' }, ['i']],
  [{ region: 'c.台湾' }, ['i']],
  [{ drill_city: 'eq.西安' }, ['a', 'b']],
  [{ city: 'eq.西安,成都' }, ['a', 'b', 'c']],
  [{ city: 'neq.西安,成都' }, ['d', 'e', 'f', 'g', 'i', 'j', 'k', 'l']],
  [{ region: 'eq.CN-SD' }, ['j', 'k']],
  [{ region: 'eq.山东' }, ['j', 'k']],
  [{ region: 're.^CN-SD$' }, ['j', 'k']],
  [{ region: 'nre.^CN-SD$' }, ['a', 'b', 'c', 'd', 'e', 'g', 'h', 'i', 'l']],
  [{ region: 'c.Shandong' }, ['j', 'k']],
  [{ region: 'c.山东' }, ['j', 'k']],
];
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
let passed = 0;
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const unicodeFixture = [
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
  ].map(([id, country, region, city]) => ({ id, country, region, city }));
  for (const [filter, expected] of [
    [{ city: 'eq.乌鲁木齐' }, ['u1', 'u2']],
    [{ city: 'eq.Ürümqi' }, ['u1', 'u2']],
    [{ city: 'c.乌鲁木齐' }, ['u1', 'u2']],
    [{ city: `c.${'Ürümqi'.normalize('NFD')}` }, ['u1', 'u2']],
    [{ city: `re.^${'Ürümqi'.normalize('NFD')}$` }, ['u1', 'u2']],
    [
      { city: `dnc.${'Ürümqi'.normalize('NFD')}` },
      ['j1', 'j2', 'j3', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
    ],
    [
      { city: `nre.^${'Ürümqi'.normalize('NFD')}$` },
      ['j1', 'j2', 'j3', 'w1', 'w2', 'w3', 'w4', 'w5', 'w6'],
    ],
    [{ city: 'eq.吉安' }, ['j3']],
    [{ city: 'eq.济南' }, ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']],
  ] as [Record<string, string>, string[]][]) {
    const { filterQuery, queryParams } = prisma.parseFilters(filter);
    const parameters: unknown[] = [JSON.stringify(unicodeFixture)];
    const predicate = filterQuery.replace(/\{\{([\w]+)(?:::[\w]+)?\}\}/g, (_, key) => {
      parameters.push(queryParams[key]);
      return `$${parameters.length}`;
    });
    const { rows } = await client.query(
      `${cte} SELECT session.id FROM website_event JOIN session USING(session_id) WHERE true ${predicate} ORDER BY session.id`,
      parameters,
    );
    assert.deepEqual(
      rows.map(row => row.id),
      expected,
      JSON.stringify(filter),
    );
    passed++;
  }
  for (const [filter, expected] of cases) {
    const { filterQuery, queryParams } = prisma.parseFilters(filter);
    const parameters: unknown[] = [JSON.stringify(fixture)];
    const predicate = filterQuery.replace(/\{\{([\w]+)(?:::[\w]+)?\}\}/g, (_, key) => {
      parameters.push(queryParams[key]);
      return `$${parameters.length}`;
    });
    const { rows } = await client.query(
      `${cte} SELECT session.id FROM website_event JOIN session USING(session_id) WHERE true ${predicate} ORDER BY session.id`,
      parameters,
    );
    assert.deepEqual(
      rows.map(row => row.id),
      expected,
      JSON.stringify(filter),
    );
    passed++;
  }
  const { rows } = await client.query(
    `${cte} SELECT id,${cityNameSQL('country', 'region', 'city', 'postgres')} AS name FROM session ORDER BY id`,
    [JSON.stringify(fixture)],
  );
  assert.deepEqual(
    rows.map(row => row.name),
    [
      '西安',
      '西安',
      '成都',
      '苏州',
      '宿州',
      'Suzhou',
      "Xi'an",
      null,
      '台北',
      '济南',
      '济南',
      'Unlisted Town',
    ],
  );
  const originalQuery = prisma.rawQuery;
  const websiteId = '11111111-1111-4111-8111-111111111111';
  const candidates = [
    ...Array.from({ length: 20 }, () => ({ country: 'CN', region: 'CN-SD', city: 'Jinan' })),
    ...Array.from({ length: 11 }, (_, i) => ({
      country: 'US',
      region: 'US-CA',
      city: `Town ${i}`,
    })),
  ];
  try {
    prisma.rawQuery = async (sql, params) => {
      const parameters: unknown[] = [JSON.stringify(candidates), websiteId];
      const query = sql.replace(/\{\{([\w]+)(?:::[\w]+)?\}\}/g, (_, key) => {
        parameters.push(params[key]);
        return `$${parameters.length}`;
      });
      const { rows } = await client.query(
        `WITH session AS (SELECT *, $2::uuid AS website_id, '2026-10-10'::timestamptz AS created_at FROM jsonb_to_recordset($1::jsonb) AS f(country text,region text,city text)) ${query}`,
        parameters,
      );
      return rows;
    };
    const values = await getValues(websiteId, 'city', {
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-10-11'),
    });
    assert.equal(
      values[0]?.value,
      'Jinan',
      'Autocomplete ranks by count before applying its limit',
    );
    assert.equal(Number(values[0]?.count), 20);
    assert.equal(values.length, 10);
    passed++;
    for (const search of ['CN-SD', '山东', 'Shandong']) {
      const regions = await getValues(websiteId, 'region', {
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-10-11'),
        search,
      });
      assert.deepEqual(
        regions.map(row => row.value),
        ['CN-37'],
      );
      passed++;
    }
  } finally {
    prisma.rawQuery = originalQuery;
  }
  console.log(JSON.stringify({ database: 'isolated', readOnly: true, checks: passed + 1 }));
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end();
  await prisma.client.$disconnect();
}
