import { checkAuth } from '@/lib/auth';
import { SHARE_CONTEXT_HEADER, SHARE_TOKEN_HEADER } from '@/lib/constants';
import prisma from '@/lib/prisma';
import {
  ACCOUNT_DEFAULT_TIMEZONE,
  type AccountPreferences,
  accountTimezoneForCountry,
  canonicalAccountTimezone,
  defaultAccountPreferences,
  initializeAccountPreferencesSchema,
  normalizeAccountDateRange,
  saveAccountPreferencesSchema,
  validateTimezone,
} from '../contracts/account-preferences';
import { LiekanError } from './errors';

type PreferenceRow = {
  country_code: string | null;
  timezone: string;
  date_range: string;
  confirmed_at: Date | string | null;
  updated_at: Date | string;
};

async function accountIdentity(request: Request, loadUser?: Parameters<typeof checkAuth>[1]) {
  if (request.headers.has(SHARE_TOKEN_HEADER) || request.headers.has(SHARE_CONTEXT_HEADER))
    throw new LiekanError('账户偏好需要独立的登录会话', 401);
  const auth = await checkAuth(request, loadUser);
  if (auth?.authType !== 'session' || !auth.user?.id || auth.user.deletedAt || auth.shareToken)
    throw new LiekanError('请完成登录后设置账户偏好', 401);
  return auth.user.id;
}

async function accountTransaction<T>(
  request: Request,
  work: (tx: any, userId: string) => Promise<T>,
) {
  const userId = await accountIdentity(request);
  return prisma.transaction(async tx => {
    const schema = new URL(process.env.DATABASE_URL).searchParams.get('schema') || 'public';
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) throw new LiekanError('数据库 schema 无效', 500);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    const users = await tx.$queryRawUnsafe(
      'SELECT user_id FROM "user" WHERE user_id=$1::uuid AND deleted_at IS NULL FOR SHARE',
      userId,
    );
    if (!users.length) throw new LiekanError('需要重新登录', 401);
    const current = await accountIdentity(request, id =>
      tx.user.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          username: true,
          password: true,
          role: true,
          createdAt: true,
          twoFactorRequired: true,
        },
      }),
    );
    if (current !== userId) throw new LiekanError('登录身份已变更', 401);
    return work(tx, userId);
  });
}

function preferencesFromRow(row?: PreferenceRow): AccountPreferences {
  if (!row) return { ...defaultAccountPreferences };
  return {
    countryCode: row.country_code,
    timezone: row.timezone,
    range: row.date_range,
    configured: row.confirmed_at !== null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readPreferences(tx: any, userId: string): Promise<AccountPreferences> {
  const rows = await tx.$queryRawUnsafe(
    'SELECT country_code,timezone,date_range,confirmed_at,updated_at FROM liekan_account_preferences WHERE user_id=$1::uuid',
    userId,
  );
  return preferencesFromRow(rows[0]);
}

export function readAccountPreferences(request: Request) {
  return accountTransaction(request, readPreferences);
}

export async function initializeAccountPreferences(request: Request, input: unknown) {
  const parsed = initializeAccountPreferencesSchema.safeParse(input);
  if (!parsed.success) throw new LiekanError('账户偏好格式无效');
  const timezone = validateTimezone(parsed.data.timezone)
    ? parsed.data.timezone
    : ACCOUNT_DEFAULT_TIMEZONE;
  // Only the Taipei and Shanghai zones imply a catalog country; other zones start without one
  // until the user confirms a country.
  const canonical = canonicalAccountTimezone(timezone);
  const countryCode =
    canonical === canonicalAccountTimezone('Asia/Taipei')
      ? 'TW'
      : canonical === canonicalAccountTimezone('Asia/Shanghai')
        ? 'CN'
        : null;
  const range = normalizeAccountDateRange(parsed.data.range);
  return accountTransaction(request, async (tx, userId) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO liekan_account_preferences(user_id,country_code,timezone,date_range)
       VALUES($1::uuid,$2,$3,$4) ON CONFLICT(user_id) DO NOTHING`,
      userId,
      countryCode,
      timezone,
      range,
    );
    return readPreferences(tx, userId);
  });
}

export async function saveAccountPreferences(request: Request, input: unknown) {
  const parsed = saveAccountPreferencesSchema.safeParse(input);
  if (!parsed.success) throw new LiekanError(parsed.error.issues[0]?.message || '账户偏好无效');
  const { countryCode } = parsed.data;
  const timezone = accountTimezoneForCountry(countryCode, parsed.data.timezone);
  const range = parsed.data.range ?? '0day';
  return accountTransaction(request, async (tx, userId) => {
    const rows = await tx.$queryRawUnsafe(
      `INSERT INTO liekan_account_preferences(user_id,country_code,timezone,date_range,confirmed_at)
       VALUES($1::uuid,$2,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET
       country_code=EXCLUDED.country_code,timezone=EXCLUDED.timezone,
       date_range=CASE WHEN $5::boolean THEN EXCLUDED.date_range ELSE liekan_account_preferences.date_range END,
       confirmed_at=now(),updated_at=now()
       RETURNING country_code,timezone,date_range,confirmed_at,updated_at`,
      userId,
      countryCode,
      timezone,
      range,
      parsed.data.range !== undefined,
    );
    return preferencesFromRow(rows[0]);
  });
}
