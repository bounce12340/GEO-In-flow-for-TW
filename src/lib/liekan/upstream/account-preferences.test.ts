// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  transaction: vi.fn(),
  tx: null as any,
  rows: new Map<string, any>(),
  actorId: '',
  live: true,
}));
vi.mock('@/lib/auth', () => ({ checkAuth: h.auth }));
vi.mock('@/lib/prisma', () => ({ default: { transaction: h.transaction } }));

import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import {
  initializeAccountPreferences,
  readAccountPreferences,
  saveAccountPreferences,
} from './account-preferences';

const actorId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const request = new Request('http://localhost/api/liekan/account/preferences');
const confirmed = { countryCode: 'JP', timezone: 'Asia/Tokyo', range: '7day' };
const methods = [
  (request: Request) => readAccountPreferences(request),
  (request: Request) => initializeAccountPreferences(request, {}),
  (request: Request) => saveAccountPreferences(request, confirmed),
];
const timestamp = '2026-10-25T00:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test?schema=account_test');
  h.actorId = actorId;
  h.live = true;
  h.rows = new Map();
  h.auth.mockImplementation(async (_request: Request, loadUser?: (id: string) => Promise<any>) => ({
    authType: 'session',
    user: loadUser ? await loadUser(h.actorId) : { id: h.actorId, role: 'user' },
  }));
  h.tx = {
    user: {
      findFirst: vi.fn(async ({ where }: any) => (h.live ? { id: where.id, role: 'user' } : null)),
    },
    $executeRawUnsafe: vi.fn(
      async (sql: string, id: string, country: string, timezone: string, range: string) => {
        if (sql.includes('INSERT INTO') && !h.rows.has(id))
          h.rows.set(id, {
            country_code: country,
            timezone,
            date_range: range,
            confirmed_at: null,
            updated_at: timestamp,
          });
      },
    ),
    $queryRawUnsafe: vi.fn(
      async (sql: string, id: string, country: string, timezone: string, range: string, supplied: boolean) => {
        if (sql.includes('FROM "user"')) return h.live ? [{ user_id: id }] : [];
        if (sql.includes('INSERT INTO'))
          h.rows.set(id, {
            country_code: country,
            timezone,
            date_range: supplied || !h.rows.has(id) ? range : h.rows.get(id).date_range,
            confirmed_at: timestamp,
            updated_at: timestamp,
          });
        return h.rows.has(id) ? [h.rows.get(id)] : [];
      },
    ),
  };
  h.transaction.mockImplementation(work => work(h.tx));
});

it('GET returns the default without creating or confirming preferences', async () => {
  expect(await readAccountPreferences(request)).toEqual({
    countryCode: 'CN',
    timezone: 'Asia/Taipei',
    range: '0day',
    configured: false,
    updatedAt: null,
  });
  expect(h.rows.size).toBe(0);
  expect(h.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  expect(h.tx.$executeRawUnsafe).toHaveBeenCalledWith('SET LOCAL search_path TO "account_test"');
});

it.each(['api-key', 'share', 'partial', undefined])(
  'rejects %s identities for every method',
  async authType => {
    h.auth.mockResolvedValue({ authType, user: { id: actorId } });
    for (const method of methods)
      await expect(method(request)).rejects.toMatchObject({ status: 401 });
    expect(h.transaction).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  { authType: 'session', user: null },
  { authType: 'session', user: { id: actorId, deletedAt: timestamp } },
  { authType: 'session', user: { id: actorId }, shareToken: { id: 'share' } },
])('rejects incomplete/deleted/mixed identity %s', async identity => {
  h.auth.mockResolvedValue(identity);
  for (const method of methods)
    await expect(method(request)).rejects.toMatchObject({ status: 401 });
  expect(h.transaction).not.toHaveBeenCalled();
});

it.each([SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER])(
  'rejects the %s header before identity queries',
  async header => {
    const mixed = new Request(request.url, { headers: { [header]: 'shared' } });
    for (const method of methods)
      await expect(method(mixed)).rejects.toMatchObject({ status: 401 });
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.transaction).not.toHaveBeenCalled();
  },
);

it('initializes once and preserves server values over later browser values', async () => {
  expect(
    await initializeAccountPreferences(request, { timezone: 'Asia/Calcutta', range: '1month' }),
  ).toMatchObject({
    countryCode: null,
    timezone: 'Asia/Calcutta',
    range: '1month',
    configured: false,
  });
  expect(
    await initializeAccountPreferences(request, { timezone: 'Asia/Shanghai', range: '24hour' }),
  ).toMatchObject({
    countryCode: null,
    timezone: 'Asia/Calcutta',
    range: '1month',
    configured: false,
  });
  expect(
    h.tx.$executeRawUnsafe.mock.calls.find(([sql]) => sql.includes('INSERT INTO'))[0],
  ).toContain('ON CONFLICT(user_id) DO NOTHING');
});

it.each([
  [{}, 'Asia/Taipei', null],
  [{ timezone: 'invalid/zone', range: 'garbage' }, 'Asia/Taipei', null],
  [{ timezone: 'Asia/Shanghai', range: '24hour' }, 'Asia/Shanghai', 'CN'],
  [{ timezone: 'Asia/Taipei', range: '24hour' }, 'Asia/Taipei', null],
])(
  'initializes the Taipei/Today default or a browser zone from %s; only Shanghai implies CN',
  async (input, timezone, countryCode) => {
    expect(await initializeAccountPreferences(request, input)).toMatchObject({
      countryCode,
      timezone,
      range: '0day',
      configured: false,
    });
  },
);

it('explicit confirmation accepts a matching alias and remains authoritative on initialization', async () => {
  const saved = await saveAccountPreferences(request, {
    countryCode: 'US',
    timezone: 'US/Eastern',
    range: '30day',
  });
  expect(saved).toEqual({
    countryCode: 'US',
    timezone: 'America/New_York',
    range: '30day',
    configured: true,
    updatedAt: timestamp,
  });
  expect(
    await initializeAccountPreferences(request, { timezone: 'Asia/Tokyo', range: '7day' }),
  ).toEqual(saved);
  expect(await readAccountPreferences(request)).toEqual(saved);
});

it('applies Today when an explicit save omits range', async () => {
  expect(
    await saveAccountPreferences(request, { countryCode: 'JP', timezone: 'Asia/Tokyo' }),
  ).toMatchObject({ configured: true, range: '0day' });
});

it('keeps users isolated and rejects caller-supplied identity fields', async () => {
  await saveAccountPreferences(request, confirmed);
  h.actorId = otherId;
  expect(await readAccountPreferences(request)).toMatchObject({
    configured: false,
    timezone: 'Asia/Taipei',
  });
  await initializeAccountPreferences(request, { timezone: 'Europe/London', range: '90day' });
  h.actorId = actorId;
  expect(await readAccountPreferences(request)).toMatchObject(confirmed);
  await expect(
    saveAccountPreferences(request, { ...confirmed, userId: otherId }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(initializeAccountPreferences(request, { userId: otherId })).rejects.toMatchObject({
    status: 400,
  });
});

it.each([
  { countryCode: 'US', timezone: 'Asia/Shanghai' },
  { countryCode: 'US' },
  { countryCode: 'ZZ', timezone: 'Asia/Tokyo' },
  { ...confirmed, range: 'range:100:99' },
  { ...confirmed, confirmedAt: timestamp },
])('rejects invalid explicit preferences %s before data mutations', async input => {
  await expect(saveAccountPreferences(request, input)).rejects.toMatchObject({ status: 400 });
  expect(h.rows.size).toBe(0);
});

it('rechecks live account identity while holding a user lock before every write', async () => {
  h.live = false;
  await expect(initializeAccountPreferences(request, {})).rejects.toMatchObject({ status: 401 });
  expect(h.rows.size).toBe(0);
  h.live = true;
  h.auth
    .mockResolvedValueOnce({ authType: 'session', user: { id: actorId } })
    .mockResolvedValueOnce(null);
  await expect(saveAccountPreferences(request, confirmed)).rejects.toMatchObject({ status: 401 });
  expect(h.rows.size).toBe(0);
  expect(h.tx.$queryRawUnsafe.mock.calls[0][0]).toContain('FOR SHARE');
});

it('rejects an identity switch during transactional authentication', async () => {
  h.auth
    .mockResolvedValueOnce({ authType: 'session', user: { id: actorId } })
    .mockResolvedValueOnce({ authType: 'session', user: { id: otherId } });
  await expect(saveAccountPreferences(request, confirmed)).rejects.toMatchObject({ status: 401 });
  expect(h.rows.size).toBe(0);
});

it('uses the transaction loader to revalidate password and 2FA session rules', async () => {
  await saveAccountPreferences(request, confirmed);
  expect(h.tx.user.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: actorId, deletedAt: null },
      select: expect.objectContaining({ password: true, twoFactorRequired: true }),
    }),
  );
});

it('keeps an explicit saved range when only country and timezone change', async () => {
  await saveAccountPreferences(request, confirmed);
  expect(await saveAccountPreferences(request, {countryCode:'US',timezone:'America/New_York'})).toMatchObject({range:'7day', timezone:'America/New_York'});
});
