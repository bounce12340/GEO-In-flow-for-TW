import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: { client: { $queryRawUnsafe: mocks.query } },
  getRawQueryClient: (client: any) => client,
  getSchema: () => 'tenant"quoted',
}));
import { captureShareCalendar } from './share-calendar';

const auth = { user: { id: '11111111-1111-4111-8111-111111111111' } } as any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([{ timezone: 'America/New_York' }]);
});

it('captures the saved publisher timezone and Today independently of the submitted browser timezone', async () => {
  expect(await captureShareCalendar(auth, { overview: true, timezone: 'Asia/Tokyo' })).toEqual({
    overview: true,
    timezone: 'America/New_York',
    range: '0day',
  });
  expect(mocks.query).toHaveBeenCalledWith(
    'SELECT timezone FROM "tenant""quoted"."liekan_account_preferences" WHERE user_id=$1::uuid',
    auth.user.id,
  );
});

it.each([
  ['absent', []],
  ['invalid', [{ timezone: 'invalid' }]],
] as const)('uses the Taipei default for an %s saved preference', async (_state, rows) => {
  mocks.query.mockResolvedValue(rows);
  expect(await captureShareCalendar(auth)).toEqual({ timezone: 'Asia/Taipei', range: '0day' });
});

it('retains explicitly submitted dates while capturing the publisher timezone', async () => {
  const parameters = { overview: true, range: 'range:123:456' };
  expect(await captureShareCalendar(auth, parameters)).toEqual({
    ...parameters,
    timezone: 'America/New_York',
  });
  expect(parameters).toEqual({ overview: true, range: 'range:123:456' });
});

it('rejects a share identity before reading account preferences', async () => {
  await expect(captureShareCalendar({ ...auth, shareToken: {} })).rejects.toMatchObject({
    status: 401,
  });
  expect(mocks.query).not.toHaveBeenCalled();
});
