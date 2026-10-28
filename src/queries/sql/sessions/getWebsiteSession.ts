import { identityUsable } from '@/lib/liekan/contracts/browser-population';
import { readBrowserPopulation } from '@/lib/liekan/upstream/browser-population';
import { noteBrowserPopulation } from '@/lib/liekan/upstream/cache-context';
import { nativeSnapshot } from '@/lib/liekan/upstream/native-snapshot';
import clickhouse from '@/lib/clickhouse';
import { EVENT_TYPE } from '@/lib/constants';
import {
  getClickHouseCountrySQL,
  getClickHouseRegionSQL,
  getPostgresCountrySQL,
  getPostgresRegionSQL,
} from '@/lib/country';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';

const FUNCTION_NAME = 'getWebsiteSession';

export async function getWebsiteSession(...args: [websiteId: string, sessionId: string]) {
  return nativeSnapshot(async () => {
    const data = await runQuery({
      [PRISMA]: () => relationalQuery(...args),
      [CLICKHOUSE]: () => clickhouseQuery(...args),
    });
    if (!data) return data;
    const population = await readBrowserPopulation(
      args[0],
      new Date(data.firstAt),
      new Date(data.lastAt),
      'UTC',
    );
    noteBrowserPopulation(args[0], population);
    return {
      ...data,
      ...(!identityUsable(population)
        ? { visits: null, totaltime: null, distinctId: undefined }
        : {}),
      population,
    };
  });
}

async function relationalQuery(websiteId: string, sessionId: string) {
  const { rawQuery, getTimestampDiffSQL } = prisma;

  return rawQuery(
    `
    select id,
      distinct_id as "distinctId",
      website_id as "websiteId",
      (array_agg(browser order by max_time desc,visit_id desc))[1] as browser,
      (array_agg(os order by max_time desc,visit_id desc))[1] as os,
      (array_agg(device order by max_time desc,visit_id desc))[1] as device,
      (array_agg(screen order by max_time desc,visit_id desc))[1] as screen,
      (array_agg(language order by max_time desc,visit_id desc))[1] as language,
      ${getPostgresCountrySQL('(array_agg(country order by max_time desc,visit_id desc))[1]', '(array_agg(region order by max_time desc,visit_id desc))[1]')} as country,
      ${getPostgresRegionSQL('(array_agg(country order by max_time desc,visit_id desc))[1]', '(array_agg(region order by max_time desc,visit_id desc))[1]')} as region,
      (array_agg(city order by max_time desc,visit_id desc))[1] as city,
      min(min_time) as "firstAt",
      max(max_time) as "lastAt",
      count(distinct visit_id) as visits,
      sum(views) as views,
      sum(events) as events,
      sum(${getTimestampDiffSQL('min_time', 'max_time')}) as "totaltime" 
    from (select
          session.session_id as id,
          session.distinct_id,
          website_event.visit_id,
          session.website_id,
          (array_agg(session.browser order by website_event.created_at desc,website_event.event_id desc))[1] as browser,
          (array_agg(session.os order by website_event.created_at desc,website_event.event_id desc))[1] as os,
          (array_agg(session.device order by website_event.created_at desc,website_event.event_id desc))[1] as device,
          (array_agg(session.screen order by website_event.created_at desc,website_event.event_id desc))[1] as screen,
          (array_agg(session.language order by website_event.created_at desc,website_event.event_id desc))[1] as language,
          session.country as country,
          session.region as region,
          session.city as city,
          min(website_event.created_at) as min_time,
          max(website_event.created_at) as max_time,
          sum(case when website_event.event_type = ${EVENT_TYPE.pageView} then 1 else 0 end) as views,
          sum(case when website_event.event_type = ${EVENT_TYPE.customEvent} then 1 else 0 end) as events
    from session
    join website_event on website_event.session_id = session.session_id
    where session.website_id = {{websiteId::uuid}}
      and session.session_id = {{sessionId::uuid}}
      and website_event.event_type != ${EVENT_TYPE.performance}
    group by session.session_id, session.distinct_id, visit_id, session.website_id, session.country, session.region, session.city) t
    group by id, distinct_id, website_id;
    `,
    { websiteId, sessionId },
    FUNCTION_NAME,
  ).then(result => result?.[0]);
}

async function clickhouseQuery(websiteId: string, sessionId: string) {
  const { rawQuery, getDateStringSQL } = clickhouse;

  return rawQuery(
    `
    select id,
      any(websiteId) as websiteId,
      argMax(distinctId, max_time) as distinctId,
      argMax(browser, max_time) as browser,
      argMax(os, max_time) as os,
      argMax(device, max_time) as device,
      argMax(screen, max_time) as screen,
      argMax(language, max_time) as language,
      ${getClickHouseCountrySQL('argMax(t.country, t.max_time)', 'argMax(t.region, t.max_time)')} as country,
      ${getClickHouseRegionSQL('argMax(t.country, t.max_time)', 'argMax(t.region, t.max_time)')} as region,
      argMax(city, max_time) as city,
      ${getDateStringSQL('min(min_time)')} as firstAt,
      ${getDateStringSQL('max(max_time)')} as lastAt,
      uniq(visit_id) visits,
      sum(views) as views,
      sum(events) as events,
      sum(max_time-min_time) as totaltime
    from (select
              session_id as id,
              distinct_id as distinctId,
              visit_id,
              website_id as websiteId,
              browser,
              os,
              device,
              screen,
              language,
              country,
              region,
              city,
              min(min_time) as min_time,
              max(max_time) as max_time,
              sum(views) as views,
              length(groupArrayArray(event_name)) as events
        from website_event_stats_hourly
        where website_id = {websiteId:UUID}
          and session_id = {sessionId:UUID}
          and event_type != ${EVENT_TYPE.performance}
        group by session_id, distinct_id, visit_id, website_id, browser, os, device, screen, language, country, region, city) t
    group by id;
    `,
    { websiteId, sessionId },
    FUNCTION_NAME,
  ).then(result => result?.[0]);
}
