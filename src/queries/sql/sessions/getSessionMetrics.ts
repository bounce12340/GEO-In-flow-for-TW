import { currentCacheContext } from '@/lib/liekan/upstream/cache-context';
import { readAnalysisVisitMetrics } from '@/lib/liekan/upstream/analysis-rollups';
import {
  applyNativePopulation,
  readBrowserPopulation,
} from '@/lib/liekan/upstream/browser-population';
import { noteBrowserPopulation } from '@/lib/liekan/upstream/cache-context';
import { nativeSnapshot } from '@/lib/liekan/upstream/native-snapshot';
import { nativeAggregate } from '@/lib/liekan/upstream/native-aggregate';
import { postgresEventEnvironmentColumn } from '@/lib/liekan/upstream/environment-query';
import clickhouse from '@/lib/clickhouse';
import { EVENT_COLUMNS, FILTER_COLUMNS, SESSION_COLUMNS } from '@/lib/constants';
import { getClickHouseCountrySQL, getClickHouseRegionSQL } from '@/lib/country';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';
import { postgresVisitGeographyColumn } from '@/lib/liekan/upstream/geography-query';

const FUNCTION_NAME = 'getSessionMetrics';

export interface SessionMetricsParameters {
  type: string;
  limit?: number | string;
  offset?: number | string;
}

export async function getSessionMetrics(
  ...args: [websiteId: string, parameters: SessionMetricsParameters, filters: QueryFilters]
) {
  return runQuery({
    [PRISMA]: () =>
      nativeAggregate(FUNCTION_NAME, args[0], { ...args[1], ...args[2] }, args[2], () =>
        relationalQuery(...args),
      ),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(
  websiteId: string,
  parameters: SessionMetricsParameters,
  filters: QueryFilters,
) {
  const { type, limit = 500, offset = 0 } = parameters;
  if (
    !currentCacheContext()?.probeOnly &&
    /^[a-f0-9-]{36}$/i.test(websiteId) &&
    filters.startDate &&
    filters.endDate
  ) {
    const { startDate, endDate, timezone, unit, compare, ...conditions } = filters;
    const accelerated = await nativeSnapshot(async () => {
      const rows = await readAnalysisVisitMetrics({
        websiteId,
        startDate,
        endDate,
        filters: conditions,
        type,
        limit: Number(limit),
        offset: Number(offset),
      });
      if (!rows) return undefined;
      const population = await readBrowserPopulation(websiteId, startDate, endDate, timezone);
      noteBrowserPopulation(websiteId, population);
      return applyNativePopulation(rows, FUNCTION_NAME, population);
    });
    if (accelerated) return accelerated;
  }
  let column = postgresEventEnvironmentColumn(FILTER_COLUMNS[type] || type);
  const { parseFilters, rawQuery } = prisma;
  const { filterQuery, joinSessionQuery, cohortQuery, excludeBounceQuery, queryParams } =
    parseFilters(
      {
        ...filters,
        websiteId,
      },
      {
        joinSession: SESSION_COLUMNS.includes(type),
      },
    );
  const includeCountry = column === 'city' || column === 'region';

  if (type === 'language') {
    column = `lower(left(${column}, 2))`;
  }
  const countryColumn = postgresVisitGeographyColumn('country');

  if (type === 'country') {
    column = countryColumn;
  } else if (type === 'region') {
    column = postgresVisitGeographyColumn('region');
  } else if (type === 'city') {
    column = postgresVisitGeographyColumn('city');
  }

  return rawQuery(
    `
    select 
      ${column} x,
      count(distinct website_event.session_id) y
      ${includeCountry ? `, ${countryColumn} country` : ''}
    from website_event
    ${cohortQuery}
    ${excludeBounceQuery}
    ${joinSessionQuery}
    where website_event.website_id = {{websiteId::uuid}}
      and website_event.created_at between {{startDate}} and {{endDate}}
      and website_event.event_type NOT IN (2, 5)
      and ${column} != ''
    ${filterQuery}
    group by 1
    ${includeCountry ? ', 3' : ''}
    order by 2 desc
    limit ${limit}
    offset ${offset}
    `,
    { ...queryParams, ...parameters },
    FUNCTION_NAME,
  );
}

async function clickhouseQuery(
  websiteId: string,
  parameters: SessionMetricsParameters,
  filters: QueryFilters,
): Promise<{ x: string; y: number }[]> {
  const { type, limit = 500, offset = 0 } = parameters;
  let column = FILTER_COLUMNS[type] || type;
  const { parseFilters, rawQuery } = clickhouse;
  const { filterQuery, cohortQuery, excludeBounceQuery, queryParams } = parseFilters({
    ...filters,
    websiteId,
  });
  const includeCountry = column === 'city' || column === 'region';

  if (type === 'language') {
    column = `lower(left(${type}, 2))`;
  }
  const countryColumn = getClickHouseCountrySQL('website_event.country', 'website_event.region');

  if (type === 'country') {
    column = countryColumn;
  } else if (type === 'region') {
    column = getClickHouseRegionSQL('website_event.country', 'website_event.region');
  }

  let sql = '';

  if (EVENT_COLUMNS.some(item => Object.keys(filters).includes(item))) {
    sql = `
    select
      ${column} x,
      count(distinct session_id) y
      ${includeCountry ? `, ${countryColumn} country` : ''}
    from website_event
    ${cohortQuery}
    ${excludeBounceQuery}
    where website_id = {websiteId:UUID}
      and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      and event_type NOT IN (2, 5)
      and ${column} != ''
      ${filterQuery}
    group by x
    ${includeCountry ? ', country' : ''}
    order by y desc
    limit ${limit}
    offset ${offset}
    `;
  } else {
    sql = `
    select
      ${column} x,
      uniq(session_id) y
      ${includeCountry ? `, ${countryColumn} country` : ''}
    from website_event_stats_hourly as website_event
    ${cohortQuery}
    ${excludeBounceQuery}
    where website_id = {websiteId:UUID}
      and created_at between {startDate:DateTime64} and {endDate:DateTime64}
      and event_type NOT IN (2, 5)
      and ${column} != ''
      ${filterQuery}
    group by x 
    ${includeCountry ? ', country' : ''}
    order by y desc
    limit ${limit}
    offset ${offset}
    `;
  }

  return rawQuery(sql, { ...queryParams, ...parameters }, FUNCTION_NAME);
}
