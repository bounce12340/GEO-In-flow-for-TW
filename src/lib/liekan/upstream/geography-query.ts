import {
  cityDefinitions,
  geographyAlias,
  provinceDefinitions,
  regionAliases,
  requiresRegion,
} from '../contracts/geography';
import {
  getClickHouseCountrySQL,
  getPostgresCountrySQL,
  getTaiwanCondition,
  getPostgresRegionSQL,
  getClickHouseRegionSQL,
} from '@/lib/country';

// PostgreSQL event reads expose the complete eligible visit anchor through the traffic policy.
export function postgresVisitGeographyColumn(name: string) {
  const country = 'website_event.liekan_country';
  const region = 'website_event.liekan_region';
  if (name === 'country') return getPostgresCountrySQL(country, region);
  if (name === 'region') return getPostgresRegionSQL(country, region);
  if (name === 'city') return 'website_event.liekan_city';
  return name;
}

// These literals come exclusively from the reviewed, bundled catalogue. Request values stay parameters.
const literal = (value: string) => `'${value.replaceAll("'", "''").replaceAll('\\', '\\\\')}'`;
// Match String.trim() at the lookup boundary; stored values and unknown output remain intact.
const trimCharacters =
  '\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const trimClass = `[${Array.from(trimCharacters, char => `\\x{${char.codePointAt(0).toString(16)}}`).join('')}]`;
function lookupTextSQL(column: string, dialect: 'postgres' | 'clickhouse') {
  return dialect === 'postgres'
    ? `btrim(normalize(${column}, NFC), ${literal(trimCharacters)})`
    : `replaceRegexpAll(normalizeUTF8NFC(${column}), ${literal(`^${trimClass}+|${trimClass}+$`)}, '')`;
}
const aliases = new Map<string, number>();
const contextualAliases = new Map<string, number>();
for (const city of cityDefinitions) {
  for (const alias of new Set(city.aliases.map(geographyAlias))) {
    const global = JSON.stringify([city.country, alias]);
    const context = JSON.stringify([city.country, city.region, alias]);
    aliases.set(global, (aliases.get(global) || 0) + 1);
    contextualAliases.set(context, (contextualAliases.get(context) || 0) + 1);
  }
}

export function geographyQueryParams() {
  const keys: string[] = [],
    indices: number[] = [];
  cityDefinitions.forEach((entry, index) => {
    for (const alias of new Set(entry.aliases.map(geographyAlias))) {
      if (contextualAliases.get(JSON.stringify([entry.country, entry.region, alias])) !== 1)
        continue;
      keys.push(`${entry.country}|${entry.region || ''}|${alias}`);
      indices.push(index + 1);
      if (
        entry.region &&
        aliases.get(JSON.stringify([entry.country, alias])) === 1 &&
        !requiresRegion(entry.country, alias)
      ) {
        keys.push(`${entry.country}||${alias}`);
        indices.push(index + 1);
      }
    }
  });
  return {
    liekan_geography_keys: keys,
    liekan_geography_indices: indices,
    liekan_geography_names: cityDefinitions.map(entry => entry.name),
    liekan_geography_aliases: cityDefinitions.map(entry => [
      ...new Set([...entry.aliases, entry.name]),
    ]),
    liekan_geography_region_codes: provinceDefinitions.map(entry => entry.code),
    liekan_geography_region_indices: provinceDefinitions.map((_, index) => index + 1),
    liekan_geography_region_aliases: provinceDefinitions.map(entry =>
      regionAliases(entry.code, 'CN'),
    ),
  };
}

function cityExpressionSQL(
  country: string,
  region: string,
  city: string,
  dialect: 'postgres' | 'clickhouse',
  allAliases = false,
  selectedValues?: unknown,
) {
  country = lookupTextSQL(country, dialect);
  region = lookupTextSQL(region, dialect);
  const rawCountry =
    dialect === 'postgres'
      ? getPostgresCountrySQL(country, region)
      : getClickHouseCountrySQL(country, region);
  const normalizedRegion =
    dialect === 'postgres'
      ? getPostgresRegionSQL(country, region)
      : getClickHouseRegionSQL(country, region);
  const cc = `case when ${rawCountry} = 'CN' and upper(${region}) in ('CN-91','CN-HK','91','HK') then 'HK' when ${rawCountry} = 'CN' and upper(${region}) in ('CN-92','CN-MO','92','MO') then 'MO' else ${rawCountry} end`;
  // HK, MO and TW catalogue places carry no province.
  const rg = `case when ${cc} in ('HK','MO','TW') then '' else ${normalizedRegion} end`;
  const lowerCity =
    dialect === 'postgres'
      ? `lower(${lookupTextSQL(city, dialect)})`
      : `lowerUTF8(${lookupTextSQL(city, dialect)})`;
  if (dialect === 'clickhouse') {
    const index = `transform(concat(${cc}, '|', coalesce(${rg}, ''), '|', ${lowerCity}), {liekan_geography_keys:Array(String)}, {liekan_geography_indices:Array(UInt32)}, 0) + 1`;
    return allAliases
      ? `arrayElement(arrayConcat([[${city}]], {liekan_geography_aliases:Array(Array(String))}), ${index})`
      : `arrayElement(arrayConcat([${city}], {liekan_geography_names:Array(String)}), ${index})`;
  }
  const values =
    selectedValues === undefined
      ? null
      : (Array.isArray(selectedValues) ? selectedValues : [selectedValues])
          .filter(value => typeof value === 'string')
          .map(geographyAlias);
  const entries = values
    ? cityDefinitions.filter(entry =>
        entry.aliases.some(alias => values.includes(geographyAlias(alias))),
      )
    : cityDefinitions;
  const fallback = allAliases ? `${dialect === 'postgres' ? 'ARRAY' : ''}[${city}]` : city;
  if (!entries.length) return fallback;
  const keys: string[] = [],
    ids: number[] = [],
    results: string[] = [];
  for (const entry of entries) {
    const safe = [...new Set(entry.aliases.map(geographyAlias))].filter(
      alias => contextualAliases.get(JSON.stringify([entry.country, entry.region, alias])) === 1,
    );
    for (const alias of safe) {
      keys.push(literal(`${entry.country}|${entry.region || ''}|${alias}`));
      ids.push(entry.id);
      if (
        entry.region &&
        aliases.get(JSON.stringify([entry.country, alias])) === 1 &&
        !requiresRegion(entry.country, alias)
      ) {
        keys.push(literal(`${entry.country}||${alias}`));
        ids.push(entry.id);
      }
    }
    const result = allAliases
      ? `${dialect === 'postgres' ? 'ARRAY' : ''}[${[...new Set([...entry.aliases, entry.name])].map(literal).join(',')}]`
      : literal(entry.name);
    results.push(`when ${entry.id} then ${result}`);
  }
  const key = `concat(${cc}, '|', coalesce(${rg}, ''), '|', ${lowerCity})`;
  const identity = `case ${key} ${keys.map((key, i) => `when ${key} then ${ids[i]}`).join(' ')} else 0 end`;
  return `case (${identity}) ${results.join(' ')} else ${fallback} end`;
}

export function cityFilterValues(value: unknown) {
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    if (typeof item !== 'string') return item;
    const matches = cityDefinitions.filter(city =>
      city.aliases.some(alias => geographyAlias(alias) === geographyAlias(item)),
    );
    const names = [...new Set(matches.map(city => city.name))];
    return names.length ? names : [item];
  });
}

export function cityNameSQL(
  country: string,
  region: string,
  city: string,
  dialect: 'postgres' | 'clickhouse',
  selectedValues?: unknown,
) {
  if (dialect === 'clickhouse') return `_liekan_geography_city(${country}, ${region}, ${city})`;
  return cityExpressionSQL(country, region, city, dialect, false, selectedValues);
}

// Bind all lookup inputs explicitly so cohort/subquery columns keep their own scope.
export function withClickHouseGeographySQL(query: string) {
  const definitions = [
    ['_liekan_geography_city', false],
    ['_liekan_geography_city_aliases', true],
  ] as const;
  const used = definitions.filter(([name]) => query.includes(`${name}(`));
  if (!used.length) return query;
  const inputs = ['_liekan_geo_country', '_liekan_geo_region', '_liekan_geo_city'] as const;
  const prefix = used
    .map(
      ([name, allAliases]) =>
        `(${inputs.join(',')}) -> ${cityExpressionSQL(...inputs, 'clickhouse', allAliases)} AS ${name}`,
    )
    .join(', ');
  return /^\s*with\b/i.test(query)
    ? query.replace(/^\s*with\b/i, () => `WITH ${prefix},`)
    : `WITH ${prefix} ${query}`;
}
export function citySearchSQL(
  country: string,
  region: string,
  city: string,
  dialect: 'postgres' | 'clickhouse',
  operator: string,
  value: string,
) {
  const negative = operator === 'dnc' || operator === 'nre';
  const regex = operator === 're' || operator === 'nre';
  const array =
    dialect === 'clickhouse'
      ? `_liekan_geography_city_aliases(${country}, ${region}, ${city})`
      : cityExpressionSQL(country, region, city, dialect, true);
  const nfc = (column: string) =>
    dialect === 'postgres' ? `normalize(${column}, NFC)` : `normalizeUTF8NFC(${column})`;
  const comparison =
    dialect === 'postgres'
      ? `${nfc('alias')} ${regex ? '~*' : 'ilike'} ${nfc(value)}`
      : regex
        ? `match(${nfc('alias')}, concat('(?i)', ${nfc(value)}))`
        : `positionCaseInsensitiveUTF8(${nfc('alias')}, ${nfc(value)}) > 0`;
  // SQL NULL behavior remains consistent with existing search operators.
  return dialect === 'postgres'
    ? `(${city} is not null and ${negative ? 'not ' : ''}exists (select 1 from unnest(${array}) as aliases(alias) where ${comparison} or ${nfc(city)} ${regex ? '~*' : 'ilike'} ${nfc(value)}))`
    : `(${city} is not null and ${negative ? 'not ' : ''}arrayExists(alias -> ${comparison}, arrayConcat(${array}, [${city}])))`;
}

export function regionSearchSQL(
  country: string,
  region: string,
  dialect: 'postgres' | 'clickhouse',
  operator: string,
  value: string,
) {
  const normalized =
    dialect === 'postgres'
      ? getPostgresRegionSQL(country, region)
      : getClickHouseRegionSQL(country, region);
  const cases = provinceDefinitions
    .map(
      p =>
        `when '${p.code}' then ${dialect === 'postgres' ? 'ARRAY' : ''}[${regionAliases(p.code, 'CN').map(literal).join(',')}]`,
    )
    .join(' ');
  const taiwan = getTaiwanCondition(country, region);
  const context = `(upper(${country}) = 'CN' or (coalesce(${country}, '') = '' and upper(${region}) like 'CN-%'))`;
  // Taiwan records also match their ISO 3166-2:TW code and the names of the former province.
  const taiwanAliases = ['Taiwan', '台湾', '台灣'].map(literal).join(',');
  const array =
    dialect === 'postgres'
      ? `case when ${taiwan} then ARRAY[${normalized},${region},${taiwanAliases}] when ${context} then case ${normalized} ${cases} else ARRAY[${region}] end else ARRAY[${region}] end`
      : `case when ${taiwan} then [${normalized},${region},${taiwanAliases}] when ${context} then arrayElement(arrayConcat([[${region}]], {liekan_geography_region_aliases:Array(Array(String))}), transform(${normalized}, {liekan_geography_region_codes:Array(String)}, {liekan_geography_region_indices:Array(UInt32)}, 0) + 1) else [${region}] end`;
  const negative = operator === 'dnc' || operator === 'nre',
    regex = operator === 're' || operator === 'nre';
  return dialect === 'postgres'
    ? `((${normalized} is not null or ${taiwan}) and ${negative ? 'not ' : ''}exists (select 1 from unnest(${array}) as aliases(alias) where alias ${regex ? '~*' : 'ilike'} ${value} or ${region} ${regex ? '~*' : 'ilike'} ${value}))`
    : `(${normalized} is not null and ${negative ? 'not ' : ''}arrayExists(alias -> ${regex ? `match(alias, concat('(?i)', ${value}))` : `positionCaseInsensitiveUTF8(alias, ${value}) > 0`}, arrayConcat(${array}, [${region}])))`;
}
