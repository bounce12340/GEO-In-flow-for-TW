import { expect, it } from 'vitest';
import { resolveSharedDateRange, sharedChartPeriod, sharedDateRange } from './shared-report';

it('uses complete local calendar days so different share viewers request the same reporting window', () => {
  const first = sharedDateRange(30, Date.parse('2026-10-05T00:00:01Z'));
  expect(first).toEqual(sharedDateRange(30, Date.parse('2026-10-05T12:45:00Z')));
  expect(first.startAt).toBe(Date.parse('2026-09-05T16:00:00Z'));
  expect(first.endAt).toBe(Date.parse('2026-10-05T15:59:59.999Z'));
  expect(first.timezone).toBe('Asia/Taipei');
});
it('keeps the 24h rolling window at hourly chart resolution and aligns it to a minute', () => {
  const range = sharedDateRange(1, Date.parse('2026-10-05T12:45:59Z'));
  expect(range.endAt).toBe(Date.parse('2026-10-05T12:45:00Z'));
  expect(range.endAt - range.startAt).toBe(86400000);
  expect(range.unit).toBe('hour');
});

it.each([
  ['2026-03-08T12:00:00Z', '2026-03-08T05:00:00Z', '2026-03-09T03:59:59.999Z', 23],
  ['2026-11-01T12:00:00Z', '2026-11-01T04:00:00Z', '2026-11-02T04:59:59.999Z', 25],
])('uses the publisher calendar for Today on %s', (now, start, end, hours) => {
  const range = sharedDateRange(0, Date.parse(now), 'America/New_York');
  expect(range).toMatchObject({
    startAt: Date.parse(start),
    endAt: Date.parse(end),
    timezone: 'America/New_York',
    unit: 'hour',
    chartPeriod: 'today',
  });
  expect(range.endAt - range.startAt + 1).toBe(hours * 3600000);
  expect(sharedChartPeriod(range)).toBe('today');
});

it('retains legacy defaults and explicit historical range identity', () => {
  const now = Date.parse('2026-10-05T12:45:59Z');
  expect(resolveSharedDateRange({}, now)).toEqual(sharedDateRange(30, now));
  const saved = { timezone: 'Europe/London', range: 'range:123:456' };
  expect(resolveSharedDateRange(saved, now)).toMatchObject({
    startAt: 123,
    endAt: 456,
    timezone: 'Europe/London',
  });
  expect(saved).toEqual({ timezone: 'Europe/London', range: 'range:123:456' });
  expect(resolveSharedDateRange({ timezone: 'bad', range: '0day' }, now).timezone).toBe(
    'Asia/Taipei',
  );
});

it.each(['24hour', '24h'])('preserves explicit %s URL rolling semantics', token => {
  const now = Date.parse('2026-11-01T12:45:59Z');
  const range = resolveSharedDateRange({ timezone: 'America/New_York', range: '0day' }, now, token);
  expect(range.endAt - range.startAt).toBe(86400000);
  expect(sharedChartPeriod(range)).toBe('24h');
});

it('uses complete seven calendar days across a DST transition', () => {
  const range = sharedDateRange(7, Date.parse('2026-03-08T12:00:00Z'), 'America/New_York');
  expect(range.startAt).toBe(Date.parse('2026-03-02T05:00:00Z'));
  expect(range.endAt).toBe(Date.parse('2026-03-09T03:59:59.999Z'));
  expect(sharedChartPeriod(range)).toBe('7d');
});

it('keeps saved natural weeks Monday through Sunday independently of viewer language', () => {
  const range = resolveSharedDateRange(
    { timezone: 'America/New_York', range: '0week' },
    Date.parse('2026-10-07T12:00:00Z'),
  );
  expect(range.startAt).toBe(Date.parse('2026-10-05T04:00:00Z'));
  expect(range.endAt).toBe(Date.parse('2026-10-12T03:59:59.999Z'));
});
