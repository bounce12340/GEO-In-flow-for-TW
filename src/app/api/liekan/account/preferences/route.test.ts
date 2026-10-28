// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  transaction: vi.fn(),
  user: vi.fn(),
  apiKey: vi.fn(),
  tx: null as any,
}));
vi.mock('@/lib/prisma', () => ({ default: { transaction: h.transaction } }));
vi.mock('@/queries/prisma/user', () => ({ getUser: h.user }));
vi.mock('@/queries/prisma/apiKey', () => ({
  getApiKeyByHash: h.apiKey,
  updateApiKeyLastUsed: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({ default: { enabled: false } }));
vi.mock('@/lib/liekan/upstream/server', async () => ({
  LiekanError: (await import('@/lib/liekan/upstream/errors')).LiekanError,
}));
vi.mock('@/lib/liekan/upstream/crawler-registry-context', () => ({
  withPublishedRegistry: (work: any) => work(),
}));
vi.mock('@/lib/liekan/crawlers/published', () => ({ getPublishedCatalog: () => null }));
vi.mock('@/lib/liekan/upstream/cache-context', () => ({
  withQueryCacheHeaders: (work: any) => work(),
}));

import { PARTIAL_AUTH_TOKEN_TYPE, SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import { hash, secret } from '@/lib/crypto';
import { createSecureToken } from '@/lib/jwt';
import { GET, PATCH, POST } from './route';

const actorId = '11111111-1111-4111-8111-111111111111';
const fixturePassword = 'account-route-test-password-hash';
const valid = { countryCode: 'JP', timezone: 'Asia/Tokyo' };
const methods = { GET, POST, PATCH };
const request = (
  method: keyof typeof methods,
  payload?: unknown,
  authorization?: string,
  headers = {},
) =>
  new Request('http://localhost/api/liekan/account/preferences', {
    method,
    headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}), ...headers },
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(payload ?? (method === 'POST' ? {} : valid)) }),
  });
const token = (extra = {}) =>
  createSecureToken({ userId: actorId, pwd: hash(fixturePassword), ...extra }, secret());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test?schema=account_route_test');
  vi.stubEnv('APP_SECRET', 'account-preferences-route-test');
  h.user.mockImplementation(async () => ({
    id: actorId,
    username: 'fixture',
    role: 'user',
    password: fixturePassword,
  }));
  h.tx = {
    user: { findFirst: h.user },
    $executeRawUnsafe: vi.fn(),
    $queryRawUnsafe: vi.fn(async (sql: string) =>
      sql.includes('FROM "user"') ? [{ user_id: actorId }] : [],
    ),
  };
  h.transaction.mockImplementation(work => work(h.tx));
  h.apiKey.mockResolvedValue({
    id: actorId,
    userId: actorId,
    name: 'fixture',
    lastUsedAt: new Date(),
  });
});

it.each(['GET', 'POST', 'PATCH'] as const)(
  '%s rejects missing and partial 2FA credentials through real auth',
  async method => {
    expect((await methods[method](request(method))).status).toBe(401);
    expect(
      (await methods[method](request(method, undefined, token({ type: PARTIAL_AUTH_TOKEN_TYPE }))))
        .status,
    ).toBe(401);
    expect(h.transaction).not.toHaveBeenCalled();
  },
);

it.each(['GET', 'POST', 'PATCH'] as const)(
  '%s rejects API keys and share context',
  async method => {
    expect((await methods[method](request(method, undefined, 'umami_test-key'))).status).toBe(401);
    for (const header of [SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER]) {
      expect(
        (await methods[method](request(method, undefined, token(), { [header]: 'shared' }))).status,
      ).toBe(401);
    }
    expect(h.transaction).not.toHaveBeenCalled();
  },
);

it('GET returns a no-store default response for a complete password-authenticated session', async () => {
  const response = await GET(request('GET', undefined, token()));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    countryCode: 'CN',
    timezone: 'Asia/Taipei',
    range: '0day',
    configured: false,
    updatedAt: null,
  });
});

it.each(['POST', 'PATCH'] as const)(
  '%s enforces bounded JSON and rejects extra fields',
  async method => {
    const auth = token();
    const oversized = await methods[method](request(method, { extra: 'a'.repeat(1024) }, auth));
    expect(oversized.status).toBe(413);
    const extra = await methods[method](
      request(method, { ...(method === 'PATCH' ? valid : {}), userId: actorId }, auth),
    );
    expect(extra.status).toBe(400);
    const malformed = new Request('http://localhost/api/liekan/account/preferences', {
      method,
      headers: { authorization: `Bearer ${auth}` },
      body: '{',
    });
    expect((await methods[method](malformed)).status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  },
);

it('rejects a password change during transactional reauthentication', async () => {
  h.user
    .mockResolvedValueOnce({ id: actorId, role: 'user', password: fixturePassword })
    .mockResolvedValueOnce({ id: actorId, role: 'user', password: 'changed-test-password-hash' });
  expect((await POST(request('POST', {}, token()))).status).toBe(401);
  expect(h.tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
});
