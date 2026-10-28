import {
  geographyAlias,
  geographyRegion,
  identifyCity,
  provinceDefinitions,
  cityDefinitions,
  cityNameValue,
  type Geography,
} from '../contracts/geography';
import { normalizeCountryCode } from '../upstream/geography-codes';

export const GEOGRAPHY_RULE_VERSION = 'geography-evidence-2';
export const GEOGRAPHY_ANCHOR_VERSION = 'first-eligible-pv-1';
export type GeographyEvidence = {
  location: Geography;
  source: string;
  trust: 'trusted_ingress' | 'authenticated_server' | 'legacy_override' | 'unverified' | 'missing';
  ipFamily: 'ipv4' | 'ipv6' | 'missing';
  precision: 'city' | 'province' | 'country' | 'missing';
  reason: string;
  ruleVersion: string;
  dataVersion: string | null;
  cityId: string | null;
  accuracyRadius: number | null;
  countryBasis: 'located' | 'registered' | 'header' | 'missing';
  processedAt: string;
  shadow: { precision: string; reason: string; cityId: string | null } | null;
};

// Provider-specific sentinel values never become apparent cities.
export function providerText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.normalize('NFC').trim();
  try {
    text = decodeURIComponent(text).normalize('NFC');
  } catch {
    /* Preserve non-encoded names. */
  }
  if (
    /\b\d{1,3}(?:\.\d{1,3}){3}\b|(?:[a-f\d]{0,4}:){2,}[a-f\d:.]+|Mozilla\/|AppleWebKit\//i.test(
      text,
    )
  )
    return null;
  return cityNameValue(text);
}
const provinceNames = new Map(
  provinceDefinitions.flatMap(p => {
    const full =
      p.name === '内蒙古'
        ? '内蒙古自治区'
        : p.name === '广西'
          ? '广西壮族自治区'
          : p.name === '宁夏'
            ? '宁夏回族自治区'
            : p.name === '新疆'
              ? '新疆维吾尔自治区'
              : p.name === '西藏'
                ? '西藏自治区'
                : ['北京', '天津', '上海', '重庆'].includes(p.name)
                  ? `${p.name}市`
                  : `${p.name}省`;
    return [
      [p.name, p.code],
      [full, p.code],
    ];
  }),
);

export function parseXdbRegion(raw: unknown): Geography | null {
  if (typeof raw !== 'string') return null;
  const fields = raw.split('|');
  if (fields.length !== 5) return null;
  const [countryName, province, city, , iso] = fields.map(providerText);
  if (iso !== 'CN' || countryName !== '中国') return null;
  const region = provinceNames.get(province) || null;
  if (province && !region) return null;
  if (['CN-71', 'CN-91', 'CN-92'].includes(region)) return null;
  // A city candidate requires a recognized mainland province from the same record.
  if (!region) return { country: 'CN', region: null, city: null };
  const known =
    city &&
    cityDefinitions.filter(
      c =>
        c.country === 'CN' &&
        (!region || c.region === region) &&
        (c.aliases.some(a => geographyAlias(a) === geographyAlias(city)) || `${c.name}市` === city),
    );
  // Administrative suffix removal is allowed only for reviewed catalogue entries.
  const mappedCity = known?.length === 1 ? known[0].name : city;
  return { country: 'CN', region, city: mappedCity };
}

export function geographyPrecision(location?: Geography) {
  return location?.city
    ? 'city'
    : location?.region
      ? 'province'
      : location?.country
        ? 'country'
        : 'missing';
}
export function consistentFill(base: Geography | null, candidate: Geography | null) {
  if (!candidate) return { location: base || {}, reason: 'no_candidate' };
  if (
    base?.country &&
    normalizeCountryCode(base.country, base.region) !==
      normalizeCountryCode(candidate.country, candidate.region)
  )
    return { location: base, reason: 'country_conflict' };
  if (
    base?.region &&
    geographyRegion(base.region, base.country) !==
      geographyRegion(candidate.region, candidate.country)
  )
    return { location: base, reason: 'province_conflict' };
  if (base?.city && !base.region) {
    const observed = identifyCity(base),
      proposed = identifyCity({ ...candidate, city: base.city });
    if (
      !observed.cityId ||
      observed.cityId !== proposed.cityId ||
      proposed.cityId !== identifyCity(candidate).cityId
    )
      return { location: base, reason: 'city_context_conflict' };
  }
  return {
    location: {
      country: base?.country || candidate.country,
      region: base?.region || candidate.region,
      city: base?.city || candidate.city,
    },
    reason: 'compatible_fill',
  };
}
