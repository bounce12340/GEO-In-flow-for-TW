import geographyCatalog from './liekan/contracts/geography-catalog.json' with { type: 'json' };
export const CHINA_COUNTRY_CODE = 'CN';
// GEOInflow TW：台湾以独立国家编码 TW 统计，县市使用 ISO 3166-2:TW 编码（TW-TPE、TW-KHH 等）。
// TWN、旧的 CN-71 / CN-TW 和 CN-县市编码仅用于兼容地理数据源与已有记录，在查询时归一化。
export const TAIWAN_COUNTRY_CODE = 'TW';
export const TAIWAN_ALPHA3_CODE = 'TWN';
export const LEGACY_TAIWAN_REGION_CODE = 'CN-71';
// Region filter value produced for the former Taiwan province; it selects every Taiwan record.
export const TAIWAN_REGION_FILTER_VALUE = TAIWAN_COUNTRY_CODE;

// ISO 3166-2:TW subdivision suffixes.
export const taiwanSubdivisionCodes = [
  'CHA',
  'CYI',
  'CYQ',
  'HSQ',
  'HSZ',
  'HUA',
  'ILA',
  'KEE',
  'KHH',
  'KIN',
  'LIE',
  'MIA',
  'NAN',
  'NWT',
  'PEN',
  'PIF',
  'TAO',
  'TNN',
  'TPE',
  'TTT',
  'TXG',
  'YUN',
];
// Region values that identify Taiwan without a county or city.
const taiwanLevelCodes = ['71', TAIWAN_COUNTRY_CODE, TAIWAN_ALPHA3_CODE];
const legacyChinaRegionCodes = [...taiwanLevelCodes, ...taiwanSubdivisionCodes];
const taiwanCountryCodes = [TAIWAN_COUNTRY_CODE, TAIWAN_ALPHA3_CODE];
const taiwanRegionPrefixes = taiwanCountryCodes.map(code => `${code}-`);
const regionPrefix = /^(TWN|TW|CN)-/;
const sqlList = (values: string[]) => values.map(value => `'${value}'`).join(', ');

/** Whether a stored country/region pair identifies Taiwan, including legacy rows filed under China. */
export function isTaiwanGeography(country?: string | null, region?: string | null) {
  const countryCode = country?.toUpperCase() || '';
  const regionCode = region?.toUpperCase() || '';
  if (taiwanCountryCodes.includes(countryCode)) return true;
  if (countryCode && countryCode !== CHINA_COUNTRY_CODE) return false;
  return (
    taiwanRegionPrefixes.some(prefix => regionCode.startsWith(prefix)) ||
    legacyChinaRegionCodes.some(code => regionCode === `${CHINA_COUNTRY_CODE}-${code}`) ||
    (countryCode === CHINA_COUNTRY_CODE && legacyChinaRegionCodes.includes(regionCode))
  );
}

/** ISO 3166-2:TW code for a Taiwan record, or no region when the input names Taiwan only. */
function taiwanRegionCode(region?: string | null) {
  if (!region) return region;
  const code = region.toUpperCase().replace(regionPrefix, '');
  return taiwanSubdivisionCodes.includes(code) ? `${TAIWAN_COUNTRY_CODE}-${code}` : null;
}

export function normalizeCountryCode(country?: string | null, region?: string | null) {
  if (isTaiwanGeography(country, region)) {
    return TAIWAN_COUNTRY_CODE;
  }

  return country ? country.toUpperCase() : country;
}

export function normalizeRegionCode(region?: string | null, country?: string | null) {
  if (isTaiwanGeography(country, region)) {
    return taiwanRegionCode(region);
  }
  const regionCountry = region?.includes('-') ? region.split('-')[0].toUpperCase() : undefined;
  const countryCode = normalizeCountryCode(country || regionCountry);

  if (!region || !countryCode) {
    return region;
  }

  const regionCode = region.includes('-') ? region.split('-').slice(1).join('-') : region;

  return `${countryCode}-${regionCode}`;
}

export function getCountryFilterValues(value: any) {
  const values = Array.isArray(value) ? value : [value];
  const result = new Set<any>();

  values.forEach(item => {
    if (typeof item !== 'string') {
      result.add(item);
      return;
    }

    const code = normalizeCountryCode(item);

    if (code) {
      result.add(code);
    }
  });

  return [...result];
}

const formerTaiwanProvinceNames = ['台湾', '台灣'];
const wholeTaiwanFilterValues = [
  TAIWAN_REGION_FILTER_VALUE,
  ...taiwanSubdivisionCodes.map(code => `${TAIWAN_COUNTRY_CODE}-${code}`),
];

/**
 * Normalized region values for an equality filter. Old links keep working: CN-TPE and TWN-KHH
 * select their ISO 3166-2:TW county, and the former Taiwan province (CN-71, CN-TW, 台湾) selects
 * every Taiwan record. Records that identify Taiwan without a county have no region, as for other
 * countries.
 */
export function getRegionFilterValues(value: any) {
  const values = Array.isArray(value) ? value : [value];
  const result = new Set<any>();

  values.forEach(item => {
    if (typeof item !== 'string') {
      result.add(item);
      return;
    }

    const [country] = item.split('-');
    if (formerTaiwanProvinceNames.includes(item) || isTaiwanGeography(country, item)) {
      const region = taiwanRegionCode(item);
      (region ? [region] : wholeTaiwanFilterValues).forEach(code => result.add(code));
      return;
    }
    const named = geographyCatalog.provinces.find(p => p.name === item);
    if (named) {
      result.add(named.code);
      return;
    }
    const region = normalizeRegionCode(item, country);

    if (region) {
      result.add(
        geographyCatalog.provinces.find(p => p.alias === region || p.code === region)?.code ||
          region,
      );
    }
  });

  return [...result];
}

/** SQL predicate matching {@link isTaiwanGeography}; PostgreSQL and ClickHouse share the syntax. */
export function getTaiwanCondition(countryColumn: string, regionColumn: string) {
  const country = `upper(${countryColumn})`;
  const region = `upper(${regionColumn})`;
  const chinaOrMissing = `(${country} = '${CHINA_COUNTRY_CODE}' or coalesce(${countryColumn}, '') = '')`;
  const prefixed = taiwanRegionPrefixes.map(prefix => `${region} like '${prefix}%'`).join(' or ');
  const legacy = sqlList(legacyChinaRegionCodes.map(code => `${CHINA_COUNTRY_CODE}-${code}`));
  return `(${country} in (${sqlList(taiwanCountryCodes)}) or (${chinaOrMissing} and (${prefixed} or ${region} in (${legacy}))) or (${country} = '${CHINA_COUNTRY_CODE}' and ${region} in (${sqlList(legacyChinaRegionCodes)})))`;
}

export function getPostgresCountrySQL(countryColumn: string, regionColumn: string) {
  return `case when ${getTaiwanCondition(countryColumn, regionColumn)} then '${TAIWAN_COUNTRY_CODE}' else upper(${countryColumn}) end`;
}

export function getClickHouseCountrySQL(countryColumn: string, regionColumn: string) {
  return `if(${getTaiwanCondition(countryColumn, regionColumn)}, '${TAIWAN_COUNTRY_CODE}', upper(${countryColumn}))`;
}

const taiwanInputs = taiwanSubdivisionCodes.flatMap(code =>
  [code, ...taiwanRegionPrefixes.map(prefix => `${prefix}${code}`), `CN-${code}`].map(input => [
    input,
    `${TAIWAN_COUNTRY_CODE}-${code}`,
  ]),
);
const provinceInputs = geographyCatalog.provinces.flatMap(p =>
  [p.code, p.alias, p.code.slice(3), p.alias.slice(3)].map(alias => [alias, p.code]),
);
function chinaRegionCondition(country: string, region: string) {
  return `(upper(${country}) = 'CN' or (coalesce(${country}, '') = '' and upper(${region}) like 'CN-%'))`;
}
export function getPostgresRegionSQL(countryColumn: string, regionColumn: string) {
  const taiwan = taiwanInputs.map(([input, code]) => `when '${input}' then '${code}'`).join(' ');
  const cases = provinceInputs.map(([alias, code]) => `when '${alias}' then '${code}'`).join(' ');
  return `case when ${getTaiwanCondition(countryColumn, regionColumn)} then case upper(${regionColumn}) ${taiwan} else case when ${regionColumn} = '' then ${regionColumn} end end when ${chinaRegionCondition(countryColumn, regionColumn)} then case upper(${regionColumn}) ${cases} else ${regionColumn} end else ${regionColumn} end`;
}
export function getClickHouseRegionSQL(countryColumn: string, regionColumn: string) {
  const taiwanInput = sqlList(taiwanInputs.map(([input]) => input));
  const taiwanOutput = sqlList(taiwanInputs.map(([, code]) => code));
  const input = sqlList(provinceInputs.map(([alias]) => alias));
  const output = sqlList(provinceInputs.map(([, code]) => code));
  return `if(${getTaiwanCondition(countryColumn, regionColumn)}, transform(upper(${regionColumn}), [${taiwanInput}], [${taiwanOutput}], ''), if(${chinaRegionCondition(countryColumn, regionColumn)}, transform(upper(${regionColumn}), [${input}], [${output}], ${regionColumn}), ${regionColumn}))`;
}

/** Extra region equality condition selecting all Taiwan records for {@link TAIWAN_REGION_FILTER_VALUE}. */
export function getTaiwanRegionFilterSQL(
  countryColumn: string,
  regionColumn: string,
  hasValue: (value: string) => string,
) {
  return `(${getTaiwanCondition(countryColumn, regionColumn)} and ${hasValue(`'${TAIWAN_REGION_FILTER_VALUE}'`)})`;
}
