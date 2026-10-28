import clickhouse from '@/lib/clickhouse';
import {
  EMAIL_DOMAINS,
  EVENT_TYPE,
  LLM_DOMAINS,
  PAID_AD_PARAMS,
  SEARCH_DOMAINS,
  SHOPPING_DOMAINS,
  SOCIAL_DOMAINS,
  VIDEO_DOMAINS,
} from '@/lib/constants';
import { getClickHouseCountrySQL, getClickHouseRegionSQL } from '@/lib/country';
import { CLICKHOUSE, PRISMA, runQuery } from '@/lib/db';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';
import type { RevenuParameters } from './getRevenueChart';
import { postgresVisitGeographyColumn } from '@/lib/liekan/upstream/geography-query';

export interface RevenueMetricsResult {
  country: { name: string; value: number }[];
  region: { name: string; value: number; country: string }[];
  referrer: { name: string; value: number }[];
  channel: { name: string; value: number }[];
}

export type RevenueMetricType = keyof RevenueMetricsResult;

export async function getRevenueMetrics(
  ...args: [
    websiteId: string,
    parameters: RevenuParameters,
    filters: QueryFilters,
    type: RevenueMetricType,
  ]
): Promise<RevenueMetricsResult[RevenueMetricType]> {
  return runQuery({
    [PRISMA]: () => relationalQuery(...args),
    [CLICKHOUSE]: () => clickhouseQuery(...args),
  });
}

async function relationalQuery(
  websiteId: string,
  parameters: RevenuParameters,
  filters: QueryFilters,
  type: RevenueMetricType,
): Promise<RevenueMetricsResult[RevenueMetricType]> {
  const { startDate, endDate, currency } = parameters;
  const { rawQuery, parseFilters } = prisma;
  const { queryParams, filterQuery, cohortQuery, joinSessionQuery, excludeBounceQuery, dateQuery } =
    parseFilters({
      ...filters,
      websiteId,
      startDate,
      endDate,
      currency,
    });
  const filteredSessionsQuery = `
    filtered_sessions as (
      select distinct website_event.website_id, website_event.session_id
      from website_event
      ${cohortQuery}
      ${excludeBounceQuery}
      ${joinSessionQuery}
      where website_event.website_id = {{websiteId::uuid}}
        and website_event.event_type != ${EVENT_TYPE.performance}
      ${dateQuery}
      ${filterQuery}
    )
  `;
  const filteredRevenueQuery = `
    filtered_revenue as (
      select revenue.website_id, revenue.session_id, revenue.event_id, revenue.created_at, revenue.revenue
      from revenue
      join filtered_sessions
        on filtered_sessions.website_id = revenue.website_id
       and filtered_sessions.session_id = revenue.session_id
      where revenue.website_id = {{websiteId::uuid}}
        and revenue.created_at between {{startDate}} and {{endDate}}
        and upper(revenue.currency) = {{currency}}
    )
  `;

  const firstEventsQuery = `
    first_events as (
      select distinct on (website_id, session_id)
        website_id, session_id, referrer_domain, url_query, utm_medium, utm_source, hostname
      from website_event
      where website_id = {{websiteId::uuid}}
        and created_at between {{startDate}} and {{endDate}}
      order by website_id, session_id, created_at, event_id
    )
  `;

  // Bind the final visit projection to each revenue event before expanding its geography.
  if (type === 'country') {
    return rawQuery(
      `
      with
      ${filteredSessionsQuery},
      ${filteredRevenueQuery}
      select
        ${postgresVisitGeographyColumn('country')} as "name",
        sum(filtered_revenue.revenue) as "value"
      from filtered_revenue
      join lateral (
        select * from website_event revenue_event
        where revenue_event.website_id = filtered_revenue.website_id
          and revenue_event.event_id = filtered_revenue.event_id
        offset 0
      ) website_event on true
      group by 1
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  if (type === 'region') {
    return rawQuery(
      `
      with
      ${filteredSessionsQuery},
      ${filteredRevenueQuery}
      select
        ${postgresVisitGeographyColumn('country')} as country,
        ${postgresVisitGeographyColumn('region')} as "name",
        sum(filtered_revenue.revenue) as "value"
      from filtered_revenue
      join lateral (
        select * from website_event revenue_event
        where revenue_event.website_id = filtered_revenue.website_id
          and revenue_event.event_id = filtered_revenue.event_id
        offset 0
      ) website_event on true
      group by 1, 2
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  if (type === 'referrer') {
    return rawQuery(
      `
      with
      ${filteredSessionsQuery},
      ${firstEventsQuery},
      events as (
        select
          revenue.website_id,
          revenue.session_id,
          sum(revenue.revenue) as "value"
        from revenue
        join filtered_sessions
          on filtered_sessions.website_id = revenue.website_id
         and filtered_sessions.session_id = revenue.session_id
        where revenue.website_id = {{websiteId::uuid}}
          and revenue.created_at between {{startDate}} and {{endDate}}
          and upper(revenue.currency) = {{currency}}
        group by revenue.website_id, revenue.session_id)

      select
        we.referrer_domain as "name",
        sum(events.value) as "value"
      from events
      join first_events we
        on we.website_id = events.website_id
       and we.session_id = events.session_id
      group by we.referrer_domain
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  return rawQuery(
    `
    with
    ${filteredSessionsQuery},
    ${firstEventsQuery},
    events as (
      select
        revenue.website_id,
        revenue.session_id,
        sum(revenue.revenue) as "value"
      from revenue
      join filtered_sessions
        on filtered_sessions.website_id = revenue.website_id
       and filtered_sessions.session_id = revenue.session_id
      where revenue.website_id = {{websiteId::uuid}}
        and revenue.created_at between {{startDate}} and {{endDate}}
        and upper(revenue.currency) = {{currency}}
      group by revenue.website_id, revenue.session_id),

    revenue_prefix as (
      select
        case when we.utm_medium ilike '%cp%' OR
              we.utm_medium ilike '%ppc%' OR
              we.utm_medium ilike '%retargeting%' OR
              we.utm_medium ilike '%paid%' then 'paid' else 'organic' end AS prefix,
        coalesce(we.referrer_domain, '') as referrer_domain,
        coalesce(we.url_query, '') as url_query,
        we.utm_medium,
        we.utm_source,
        we.hostname,
        r.value
      from events r
      join first_events we
        on we.website_id = r.website_id
       and we.session_id = r.session_id),

    channels AS (
      select
        case
          when referrer_domain = '' and url_query = '' then 'direct'
          when ${toPostgresLikeClause('url_query', PAID_AD_PARAMS)} then 'paidAds'
          when ${toPostgresLikeClause('utm_medium', ['referral', 'app', 'link'])} then 'referral'
          when utm_medium ilike '%affiliate%' then 'affiliate'
          when utm_medium ilike '%sms%' or utm_source ilike '%sms%' then 'sms'
          when ${toPostgresLikeClause('referrer_domain', LLM_DOMAINS)} then 'llm'
          when ${toPostgresLikeClause('referrer_domain', SEARCH_DOMAINS)} or utm_medium ilike '%organic%' then concat(prefix, 'Search')
          when ${toPostgresLikeClause('referrer_domain', SOCIAL_DOMAINS)} then concat(prefix, 'Social')
          when ${toPostgresLikeClause('referrer_domain', EMAIL_DOMAINS)} or utm_medium ilike '%mail%' then 'email'
          when ${toPostgresLikeClause('referrer_domain', SHOPPING_DOMAINS)} or utm_medium ilike '%shop%' then concat(prefix, 'Shopping')
          when ${toPostgresLikeClause('referrer_domain', VIDEO_DOMAINS)} or utm_medium ilike '%video%' then concat(prefix, 'Video')
          when referrer_domain != regexp_replace(hostname, '^www.', '') and referrer_domain != '' then 'referral'
          else 'Unknown' end AS "name",
        value
      from revenue_prefix)

    select name, sum(value) as value
    from channels
    group by name
    order by value desc
    `,
    queryParams,
    'getRevenueMetrics',
  );
}

async function clickhouseQuery(
  websiteId: string,
  parameters: RevenuParameters,
  filters: QueryFilters,
  type: RevenueMetricType,
): Promise<RevenueMetricsResult[RevenueMetricType]> {
  const { startDate, endDate, currency } = parameters;
  const { rawQuery, parseFilters } = clickhouse;
  const { filterQuery, cohortQuery, excludeBounceQuery, dateQuery, queryParams } = parseFilters({
    ...filters,
    websiteId,
    startDate,
    endDate,
    currency,
  });
  const filteredSessionsQuery = `
    filtered_sessions as (
      select
        website_id,
        session_id,
        any(country) as country,
        any(region) as region
      from website_event
      ${cohortQuery}
      ${excludeBounceQuery}
      where website_id = {websiteId:UUID}
        and event_type != ${EVENT_TYPE.performance}
      ${dateQuery}
      ${filterQuery}
      group by website_id, session_id
    )
  `;
  const filteredRevenueQuery = `
    filtered_revenue as (
      select
        website_revenue.website_id,
        website_revenue.session_id,
        website_revenue.created_at,
        website_revenue.revenue
      from website_revenue
      inner join filtered_sessions
        on filtered_sessions.website_id = website_revenue.website_id
       and filtered_sessions.session_id = website_revenue.session_id
      where website_revenue.website_id = {websiteId:UUID}
        and website_revenue.created_at between {startDate:DateTime64} and {endDate:DateTime64}
        and upper(website_revenue.currency) = {currency:String}
    )
  `;

  const firstEventsQuery = `
    first_events as (
      select
        website_id,
        session_id,
        tupleElement(first_event, 1) as referrer_domain,
        tupleElement(first_event, 2) as url_query,
        tupleElement(first_event, 3) as utm_medium,
        tupleElement(first_event, 4) as utm_source,
        tupleElement(first_event, 5) as hostname
      from (
        select website_id, session_id,
          argMin(
            tuple(referrer_domain, url_query, utm_medium, utm_source, hostname),
            tuple(created_at, event_id)
          ) as first_event
        from website_event
        where website_id = {websiteId:UUID}
          and created_at between {startDate:DateTime64} and {endDate:DateTime64}
        group by website_id, session_id
      )
    )
  `;

  if (type === 'country') {
    return rawQuery<{ name: string; value: number }[]>(
      `
      with
      ${filteredSessionsQuery},
      ${filteredRevenueQuery}
      select
        ${getClickHouseCountrySQL('filtered_sessions.country', 'filtered_sessions.region')} as "name",
        sum(filtered_revenue.revenue) as "value"
      from filtered_revenue
      inner join filtered_sessions
        on filtered_sessions.website_id = filtered_revenue.website_id
       and filtered_sessions.session_id = filtered_revenue.session_id
      group by 1
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  if (type === 'region') {
    return rawQuery<{ name: string; value: number; country: string }[]>(
      `
      with
      ${filteredSessionsQuery},
      ${filteredRevenueQuery}
      select
        ${getClickHouseCountrySQL('filtered_sessions.country', 'filtered_sessions.region')} as country,
        ${getClickHouseRegionSQL('filtered_sessions.country', 'filtered_sessions.region')} as "name",
        sum(filtered_revenue.revenue) as "value"
      from filtered_revenue
      inner join filtered_sessions
        on filtered_sessions.website_id = filtered_revenue.website_id
       and filtered_sessions.session_id = filtered_revenue.session_id
      group by 1, 2
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  if (type === 'referrer') {
    return rawQuery<{ name: string; value: number }[]>(
      `
      with
      ${filteredSessionsQuery},
      ${firstEventsQuery},
      events as (
        select
          website_revenue.website_id,
          website_revenue.session_id,
          sum(website_revenue.revenue) as "value"
        from website_revenue
        inner join filtered_sessions
          on filtered_sessions.website_id = website_revenue.website_id
         and filtered_sessions.session_id = website_revenue.session_id
        where website_revenue.website_id = {websiteId:UUID}
          and website_revenue.created_at between {startDate:DateTime64} and {endDate:DateTime64}
          and upper(website_revenue.currency) = {currency:String}
        group by 1, 2
      )

      select
          website_event.referrer_domain as "name",
          sum(events.value) as "value"
      from events
      inner join first_events website_event
        on website_event.website_id = events.website_id
       and website_event.session_id = events.session_id
      group by 1
      order by value desc
      `,
      queryParams,
      'getRevenueMetrics',
    );
  }

  return rawQuery<{ name: string; value: number }[]>(
    `
    with
    ${filteredSessionsQuery},
    ${firstEventsQuery},
    events as (
      select
        website_revenue.website_id,
        website_revenue.session_id,
        sum(website_revenue.revenue) as "value"
      from website_revenue
      inner join filtered_sessions
        on filtered_sessions.website_id = website_revenue.website_id
       and filtered_sessions.session_id = website_revenue.session_id
      where website_revenue.website_id = {websiteId:UUID}
        and website_revenue.created_at between {startDate:DateTime64} and {endDate:DateTime64}
        and upper(website_revenue.currency) = {currency:String}
      group by 1, 2
    ),

    channels as (
      select
        case when multiSearchAny(lower(utm_medium), ['cp', 'ppc', 'retargeting', 'paid']) != 0 then 'paid' else 'organic' end prefix,
        case
          when referrer_domain = '' and url_query = '' then 'direct'
          when multiSearchAny(lower(url_query), [${toClickHouseStringArray(
            PAID_AD_PARAMS,
          )}]) != 0 then 'paidAds'
          when multiSearchAny(lower(utm_medium), ['referral', 'app','link']) != 0 then 'referral'
          when position(lower(utm_medium), 'affiliate') > 0 then 'affiliate'
          when position(lower(utm_medium), 'sms') > 0 or position(lower(utm_source), 'sms') > 0 then 'sms'
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            LLM_DOMAINS,
          )}]) != 0 then 'llm'
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            SEARCH_DOMAINS,
          )}]) != 0 or position(lower(utm_medium), 'organic') > 0 then concat(prefix, 'Search')
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            SOCIAL_DOMAINS,
          )}]) != 0 then concat(prefix, 'Social')
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            EMAIL_DOMAINS,
          )}]) != 0 or position(lower(utm_medium), 'mail') > 0 then 'email'
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            SHOPPING_DOMAINS,
          )}]) != 0 or position(lower(utm_medium), 'shop') > 0 then concat(prefix, 'Shopping')
          when multiSearchAny(lower(referrer_domain), [${toClickHouseStringArray(
            VIDEO_DOMAINS,
          )}]) != 0 or position(lower(utm_medium), 'video') > 0 then concat(prefix, 'Video')
          when referrer_domain != hostname and referrer_domain != '' then 'referral'
        else 'Unknown' end AS "name",
        sum(events.value) as "value"
      from events
      inner join first_events website_event
        on website_event.website_id = events.website_id
       and website_event.session_id = events.session_id
      group by 1, 2
    )

    select name, sum(value) value
    from channels
    group by 1
    order by value desc;
    `,
    queryParams,
    'getRevenueMetrics',
  );
}

function toClickHouseStringArray(arr: string[]): string {
  return arr.map(p => `'${p.replace(/'/g, "\\'")}'`).join(', ');
}

function toPostgresLikeClause(column: string, arr: string[]) {
  return arr.map(val => `${column} ilike '%${val.replace(/'/g, "''")}%'`).join(' OR\n  ');
}
