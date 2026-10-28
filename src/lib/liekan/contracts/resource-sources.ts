import { z } from 'zod';
export const resourceSourcesQuery = z
  .object({
    startAt: z.coerce.number().int().nonnegative(),
    endAt: z.coerce.number().int().nonnegative(),
    timezone: z.string().max(80).default('Asia/Taipei'),
    page: z.coerce.number().int().positive().max(100000).default(1),
  })
  .catchall(z.string().max(2000))
  .refine(p => p.endAt >= p.startAt && p.endAt - p.startAt <= 1096 * 86400000);
export const resourceSourcesResponse = z.object({
  rows: z.array(
    z.object({
      source: z.string().nullable(),
      country: z.string().nullable(),
      clicks: z.number().nonnegative(),
    }),
  ),
  count: z.number().nonnegative(),
  page: z.number(),
  pageSize: z.literal(25),
});
