import catalog from './geography-catalog.json' with { type: 'json' };
import { normalizeCountryCode, normalizeRegionCode } from '../upstream/geography-codes';
import countries from '../../../../public/intl/country/zh-CN.json' with { type: 'json' };
import englishCountries from '../../../../public/intl/country/en-US.json' with { type: 'json' };
import traditionalCountries from '../../../../public/intl/country/zh-TW.json' with { type: 'json' };
import traditionalNames from '../i18n/geography-zh-TW.json' with { type: 'json' };
import regions from '../../../../public/iso-3166-2.json' with { type: 'json' };
import type { LiekanLocale } from '../i18n/locale';

export const geographyDisplayRuleVersion = 'city-known-1';
export const geographyVersion = `geo-${catalog.version}-rules-5-${geographyDisplayRuleVersion}`;
export const provinceDefinitions = catalog.provinces;
export const cityDefinitions = catalog.cities;
const citiesById = new Map(cityDefinitions.map(city => [city.id, city]));
// Display names reuse the reviewed aliases attached to each stable GeoNames ID.
const englishCityNames = new Map(
  cityDefinitions.map(city => [
    city.id,
    city.id === 1529102
      ? city.aliases.find(alias => alias === 'Urumqi')
      : city.aliases.find(alias => /^[\p{Script=Latin}\p{Mark}\s.'’\-]+$/u.test(alias)),
  ]),
);
const englishProvinceNames: Record<string, string> = {
  'CN-71': 'Taiwan',
  'CN-91': 'Hong Kong',
  'CN-92': 'Macao',
};
/** Taiwan Traditional display form of a Simplified catalog name; other values pass through. */
export const traditionalGeographyName = (name: string) =>
  (traditionalNames as Record<string, string>)[name] ?? name;
const localizeChinese = (name: string, locale: LiekanLocale) =>
  locale === 'zh-TW' ? traditionalGeographyName(name) : name;
export const geographyAlias = (value: string) => value.normalize('NFC').trim().toLowerCase();
export const requiresRegion = (country: string, alias: string) =>
  country === 'CN' &&
  ['taizhou', 'suzhou', 'yichun', 'yulin', 'fuzhou', "ji'an", 'jian'].includes(
    geographyAlias(alias).replaceAll('’', "'"),
  );
const provinceCodes = new Map(
  provinceDefinitions.flatMap(
    p =>
      [
        [p.code, p.code],
        [p.alias, p.code],
      ] as [string, string][],
  ),
);
const cityAliases = new Map<string, typeof cityDefinitions>();
for (const city of cityDefinitions) {
  for (const alias of new Set(city.aliases.map(geographyAlias))) {
    const key = JSON.stringify([city.country, alias]);
    cityAliases.set(key, [...(cityAliases.get(key) || []), city]);
  }
}

export function geographyRegion(region?: string | null, country?: string | null) {
  const prefix = region?.includes('-') ? normalizeCountryCode(region.trim().split('-')[0]) : null;
  const cc = normalizeCountryCode(country?.trim());
  if (prefix && cc && prefix !== cc) return region.trim().toUpperCase();
  const normalized = normalizeRegionCode(region?.trim().toUpperCase(), country?.trim());
  return provinceCodes.get(normalized) || normalized || null;
}

export function isCountryCode(code?: string | null) {
  return !!countries[normalizeCountryCode(code?.trim())];
}
export function knownChinaProvince(region?: string | null) {
  return provinceDefinitions.some(p => p.code === geographyRegion(region, 'CN'));
}
export function cityNameValue(value?: string | null) {
  const text = value?.normalize('NFC').trim();
  return !text ||
    ['0', 'unknown', '未知', '城市未知', '未知城市', 'n/a', '-'].includes(text.toLowerCase())
    ? null
    : text;
}

export function countryName(code?: string | null, locale: LiekanLocale = 'zh-CN') {
  const country = normalizeCountryCode(code?.trim());
  if (locale === 'zh-TW')
    return (
      traditionalCountries[country] ||
      localizeChinese(countries[country] || '', locale) ||
      country ||
      '未知'
    );
  const names = locale === 'en-US' ? englishCountries : countries;
  return names[country] || country || (locale === 'en-US' ? 'Unknown' : '未知');
}

export function regionName(
  code?: string | null,
  country?: string | null,
  locale: LiekanLocale = 'zh-CN',
) {
  const region = geographyRegion(code, country);
  if (
    region?.includes('-') &&
    country &&
    normalizeCountryCode(region.split('-')[0]) !== normalizeCountryCode(country.trim())
  )
    return region;
  const province = provinceDefinitions.find(p => p.code === region);
  return locale === 'en-US'
    ? englishProvinceNames[region] ||
        regions[province?.alias || region] ||
        regions[region] ||
        region ||
        'Unknown'
    : localizeChinese(province?.name || '', locale) || regions[region] || region || '未知';
}

export function regionAliases(code?: string | null, country?: string | null) {
  const region = geographyRegion(code, country);
  if (
    region?.includes('-') &&
    country &&
    normalizeCountryCode(region.split('-')[0]) !== normalizeCountryCode(country.trim())
  )
    return [code, region].filter(Boolean);
  const p = provinceDefinitions.find(p => p.code === region);
  return p
    ? [
        ...new Set(
          [p.code, p.alias, p.code.slice(3), p.alias.slice(3), p.name, regions[p.alias]].filter(
            Boolean,
          ),
        ),
      ]
    : [code, region].filter(Boolean);
}

export function cityValueOptions(
  rows: (Geography & { value: string; count: number })[],
  chinese = true,
) {
  const grouped = new Map<string, { value: string; count: number; labels: Set<string> }>();
  for (const row of rows) {
    const group = grouped.get(row.value) || {
      value: row.value,
      count: 0,
      labels: new Set<string>(),
    };
    group.count += Number(row.count || 0);
    group.labels.add(chinese ? geographyLabel({ ...row, city: row.value }) : row.value);
    // A raw city equality condition also selects its explicit homonyms across provinces.
    if (chinese) {
      for (const entry of cityDefinitions) {
        if (entry.aliases.some(alias => geographyAlias(alias) === geographyAlias(row.value || '')))
          group.labels.add(entry.name);
      }
    }
    grouped.set(row.value, group);
  }
  return [...grouped.values()].map(({ value, count, labels }) => ({
    value,
    count,
    label: [...labels].join(' / '),
  }));
}

export type Geography = { country?: string | null; region?: string | null; city?: string | null };
export type GeographyDisplay = {
  country: string | null;
  region: string | null;
  city: string | null;
  cityId: number | null;
};
export function identifyCity(value: Geography) {
  const country = normalizeCountryCode(value.country?.trim());
  const region = geographyRegion(value.region, value.country);
  const catalogueCountry =
    country === 'CN' && region === 'CN-91'
      ? 'HK'
      : country === 'CN' && region === 'CN-92'
        ? 'MO'
        : country;
  const rawCity = cityNameValue(value.city);
  const candidates = rawCity
    ? (cityAliases.get(JSON.stringify([catalogueCountry, geographyAlias(rawCity)])) || []).filter(
        city =>
          region
            ? city.region === region || (!city.region && city.country !== 'CN')
            : !requiresRegion(city.country, rawCity),
      )
    : [];
  const known = candidates.length === 1 ? candidates[0] : undefined;
  return {
    country: country || null,
    region,
    city: rawCity,
    cityId: known?.id || null,
    name: known?.name || rawCity,
    // Observed province remains part of identity, including when it is missing.
    key: JSON.stringify([country || null, region, known?.id || rawCity]),
  };
}

export function geographyDisplay(value: Geography): GeographyDisplay {
  const { country, region, city, cityId } = identifyCity(value);
  return { country, region, city, cityId };
}

export function cityName(
  value: Geography & { cityId?: number | null },
  locale: LiekanLocale = 'zh-CN',
) {
  const identity = identifyCity(value);
  const cityId = value.cityId ?? identity.cityId;
  return locale === 'en-US'
    ? englishCityNames.get(cityId) || identity.city
    : localizeChinese(citiesById.get(cityId)?.name || identity.name || '', locale) || identity.name;
}

export function geographyLabel(
  value: Geography & { cityId?: number | null },
  locale: LiekanLocale = 'zh-CN',
) {
  const city = identifyCity(value);
  const name = cityName(value, locale);
  if (name) return name;
  const unknown = locale === 'en-US' ? 'Unknown city' : '城市未知';
  if (city.region) return `${regionName(city.region, city.country, locale)} · ${unknown}`;
  if (city.country) return `${countryName(city.country, locale)} · ${unknown}`;
  return locale === 'en-US' ? 'Unknown location' : '地域未知';
}

export function visitorGeographyLabel(
  value: Geography & { cityId?: number | null },
  locale: LiekanLocale = 'zh-CN',
) {
  const city = identifyCity(value);
  const name = cityName(value, locale);
  if (!name) return geographyLabel(value, locale);
  return [
    name,
    city.region ? regionName(city.region, city.country, locale) : null,
    city.country ? countryName(city.country, locale) : null,
  ]
    .filter(Boolean)
    .join(locale === 'en-US' ? ', ' : '，');
}

export type GeographyFact = Geography & {
  sessions: number;
  pv?: number;
  bounces: number;
  conversions: number;
  duration: number | null;
  durationTotal?: number;
  durationSamples?: number;
};

export type GeographyCoverage = {
  displayRuleVersion: string;
  totalVisits: number;
  cityKnownVisits: number;
  cityUnknownVisits: number;
  cityCoverage: number | null;
  chinaVisits: number;
  chinaProvinceKnownVisits: number;
  chinaProvinceUnknownVisits: number;
  chinaProvinceCoverage: number | null;
  cityDisplayState: 'empty' | 'unidentified' | 'available';
  provinceDisplayState: 'empty' | 'unidentified' | 'available';
};

export function geographyCoverage(rows: GeographyFact[], totalVisits: number): GeographyCoverage {
  const count = (predicate: (row: GeographyFact) => boolean) =>
    rows.reduce(
      (sum, row) => sum + (predicate(row) ? Math.max(0, Number(row.sessions) || 0) : 0),
      0,
    );
  const total = Math.max(0, totalVisits);
  const cityKnownVisits = Math.min(
    total,
    count(row => !!identifyCity(row).city),
  );
  const chinaVisits = count(row => normalizeCountryCode(row.country) === 'CN');
  const chinaProvinceKnownVisits = count(
    row => normalizeCountryCode(row.country) === 'CN' && knownChinaProvince(row.region),
  );
  const percent = (a: number, b: number) => (b ? Math.round((a / b) * 10000) / 100 : null);
  return {
    displayRuleVersion: geographyDisplayRuleVersion,
    totalVisits: total,
    cityKnownVisits,
    cityUnknownVisits: total - cityKnownVisits,
    cityCoverage: percent(cityKnownVisits, total),
    chinaVisits,
    chinaProvinceKnownVisits,
    chinaProvinceUnknownVisits: chinaVisits - chinaProvinceKnownVisits,
    chinaProvinceCoverage: percent(chinaProvinceKnownVisits, chinaVisits),
    cityDisplayState: !total ? 'empty' : cityKnownVisits ? 'available' : 'unidentified',
    provinceDisplayState: !chinaVisits
      ? 'empty'
      : chinaProvinceKnownVisits
        ? 'available'
        : 'unidentified',
  };
}

export function geographyCoverageText(coverage?: GeographyCoverage) {
  const rule = '仅展示有城市信息的访问，占比按全部有效访问计算。';
  if (!coverage) return `${rule} 城市覆盖情况暂不可用`;
  if (!coverage.totalVisits) return `${rule} 当前期间暂无访问数据`;
  return `${rule} 城市覆盖 ${coverage.cityCoverage}% · ${coverage.cityUnknownVisits.toLocaleString('zh-CN')} 次访问城市未识别`;
}

export function geographyEmptyText(coverage?: GeographyCoverage, search = '') {
  if (!coverage) return '城市覆盖情况暂不可用';
  if (!coverage.totalVisits) return '当前期间暂无访问数据';
  if (!coverage.cityKnownVisits) return '已收到访问数据，城市信息尚未识别';
  return search ? '没有匹配的城市' : '当前期间暂无城市记录';
}
export function mergeGeography(rows: GeographyFact[]) {
  const groups = new Map<
    string,
    GeographyFact &
      ReturnType<typeof identifyCity> & {
        durationTotal: number;
        durationSamples: number;
      }
  >();
  for (const row of rows) {
    const identity = identifyCity(row);
    const group = groups.get(identity.key) || {
      ...identity,
      sessions: 0,
      pv: 0,
      bounces: 0,
      conversions: 0,
      duration: null,
      durationTotal: 0,
      durationSamples: 0,
    };
    for (const key of ['sessions', 'pv', 'bounces', 'conversions'] as const)
      group[key] += Number(row[key] || 0);
    group.durationTotal += Number(row.durationTotal ?? (row.duration ?? 0) * row.sessions);
    group.durationSamples += Number(
      row.durationSamples ?? (row.duration == null ? 0 : row.sessions),
    );
    group.duration = group.durationSamples ? group.durationTotal / group.durationSamples : null;
    groups.set(identity.key, group);
  }
  return [...groups.values()].sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
}

export const geographySorts = [
  'city',
  'sessions',
  'share',
  'duration',
  'bounceRate',
  'conversionRate',
] as const;
export type GeographySelection = {
  search?: string;
  geoSort?: (typeof geographySorts)[number];
  direction?: 'asc' | 'desc';
};
export function geographyTable(
  rows: GeographyFact[],
  visits: number,
  hasGoals: boolean,
  selection: GeographySelection = {},
  locale: LiekanLocale = 'zh-CN',
) {
  return geographyTableDisplay(rows, visits, hasGoals, selection, locale).rows;
}

export function geographyTableDisplay(
  rows: GeographyFact[],
  visits: number,
  hasGoals: boolean,
  selection: GeographySelection = {},
  locale: LiekanLocale = 'zh-CN',
) {
  const percent = (count: number, total: number) =>
    total ? Math.round((count / total) * 10000) / 100 : null;
  const query = geographyAlias(selection.search || '');
  const facts = mergeGeography(rows)
    .filter(row => !!row.city)
    .filter(
      row =>
        !query ||
        [
          geographyLabel(row),
          geographyLabel(row, 'en-US'),
          row.city,
          ...regionAliases(row.region, row.country),
          regionName(row.region, row.country),
          countryName(row.country),
          countryName(row.country, 'en-US'),
          ...(cityDefinitions.find(city => city.id === row.cityId)?.aliases || []),
        ].some(value => value && geographyAlias(value).includes(query)),
    );
  const selected = facts.map(row => ({
    city: geographyLabel(row),
    sessions: row.sessions,
    share: percent(row.sessions, visits),
    duration: row.duration,
    bounceRate: percent(row.bounces, row.sessions),
    conversionRate: hasGoals ? percent(row.conversions, row.sessions) : null,
    key: row.key,
    location: geographyDisplay(row),
  }));
  const field = selection.geoSort || 'sessions',
    direction = selection.direction === 'asc' ? 1 : -1;
  selected.sort((a, b) => {
    const left = a[field],
      right = b[field];
    if (left == null || right == null)
      return left == null && right == null ? a.key.localeCompare(b.key) : left == null ? 1 : -1;
    return (
      (typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, 'zh-CN')
        : Number(left) - Number(right)) * direction || a.key.localeCompare(b.key)
    );
  });
  return {
    rows: selected.map(({ key, location, ...row }) => ({
      ...row,
      city: locale === 'zh-CN' ? row.city : geographyLabel(location, locale),
    })),
    locations: selected.map(row => row.location),
  };
}
