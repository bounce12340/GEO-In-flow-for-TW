import { geographyBundle, enrichChina, type GeographyBundle } from './liekan/geography/bundle';
import {
  GEOGRAPHY_RULE_VERSION,
  consistentFill,
  geographyPrecision,
  providerText,
  type GeographyEvidence,
} from './liekan/geography/evidence';
import { identifyCity, isCountryCode } from './liekan/contracts/geography';
import { geographyRegion } from './liekan/contracts/geography';
import path from 'node:path';
import { browserName, detectOS } from 'detect-browser';
import maxmind from 'maxmind';
import { normalizeCountryCode, normalizeRegionCode } from '@/lib/country';
import { normalizeIp, resolveClientIp, hasIgnoredIp, isGeolocatable } from '@/lib/ip';

const MAXMIND = 'maxmind';
let locationRetryAt = 0;
let locationDatabaseLoading: Promise<any> | undefined;
type LocationTrace = {
  usedHeader?: boolean;
  usedDatabase?: boolean;
  reason?: string;
  databaseVersion?: string;
  countryBasis?: GeographyEvidence['countryBasis'];
  accuracyRadius?: number;
};

function unavailableLocation() {
  delete globalThis[MAXMIND];
  locationRetryAt = Date.now() + 60_000;
  // eslint-disable-next-line no-console
  console.warn('City geography unavailable; collection continues with missing location fields.');
}

const PROVIDER_HEADERS = [
  // Umami custom headers (cloud mode only)
  ...(process.env.CLOUD_MODE
    ? [
        {
          countryHeader: 'x-umami-client-country',
          regionHeader: 'x-umami-client-region',
          cityHeader: 'x-umami-client-city',
        },
      ]
    : []),
  // Cloudflare headers
  {
    countryHeader: 'cf-ipcountry',
    regionHeader: 'cf-region-code',
    cityHeader: 'cf-ipcity',
  },
  // Vercel headers
  {
    countryHeader: 'x-vercel-ip-country',
    regionHeader: 'x-vercel-ip-country-region',
    cityHeader: 'x-vercel-ip-city',
  },
  // CloudFront headers
  {
    countryHeader: 'cloudfront-viewer-country',
    regionHeader: 'cloudfront-viewer-country-region',
    cityHeader: 'cloudfront-viewer-city',
  },
  // EdgeOne headers (requires custom request headers in Rule Priorities, see: https://edgeone.ai/document/46151)
  {
    countryHeader: 'eo-ipcountry',
    regionHeader: 'eo-region-code',
    cityHeader: 'eo-ipcity',
  },
];

export function getDevice(userAgent: string | null | undefined, screen: string = '') {
  const ua = userAgent || '';

  // Classify device families from public user-agent tokens; no external device database is used.
  if (/playstation|xbox|nintendo/i.test(ua)) {
    return 'console';
  }

  if (
    /smart[- ]?tv|hbbtv|googletv|appletv|android[- ]?tv|roku|\baft\w+\b|web0s|bravia|viera|netcast/i.test(
      ua,
    )
  ) {
    return 'smarttv';
  }

  if (/applewatch|\bwatch\b|\bwear ?os\b|\bglass\b/i.test(ua)) {
    return 'wearable';
  }

  if (/crkey|chromecast/i.test(ua)) {
    return 'embedded';
  }

  if (
    /ipad|tablet|kindle|playbook|touchpad/i.test(ua) ||
    (/macintosh/i.test(ua) && /\bmobile\b/i.test(ua))
  ) {
    return 'tablet';
  }

  if (/windows phone|windows ce|iemobile/i.test(ua)) {
    return 'mobile';
  }

  if (/\bandroid\b|silk\//i.test(ua)) {
    return /\bmobile\b/i.test(ua) ? 'mobile' : 'tablet';
  }

  if (/iphone|ipod|blackberry|bb10|opera mini|opera mobi|\bmobile\b/i.test(ua)) {
    return 'mobile';
  }

  const [width] = screen.split('x');

  if (screen && +width <= 1920) {
    return 'laptop';
  }

  return 'desktop';
}

function getRegionCode(country: string | null | undefined, region: string | null | undefined) {
  const clean = providerText(region);
  if (clean && !/^[A-Z0-9-]{1,20}$/i.test(clean)) return undefined;
  const normalized = normalizeRegionCode(clean, country);
  return normalized?.length > 20 ? undefined : normalized;
}

function decodeHeader(s: string | undefined | null): string | undefined | null {
  if (s === undefined || s === null) {
    return s;
  }

  return Buffer.from(s, 'latin1').toString('utf-8');
}

export async function getLocation(
  ip: string = '',
  headers: Headers,
  skipHeaders: boolean,
  bundle?: GeographyBundle | null,
  trace?: LocationTrace,
) {
  const cleanIp = normalizeIp(ip);

  // Ignore local or invalid ips
  if (!cleanIp || !isGeolocatable(cleanIp)) {
    return null;
  }

  if (!skipHeaders && !process.env.SKIP_LOCATION_HEADERS) {
    for (const provider of PROVIDER_HEADERS) {
      const countryHeader = headers.get(provider.countryHeader);
      if (countryHeader) {
        const sourceCountry = decodeHeader(countryHeader);
        const region = decodeHeader(headers.get(provider.regionHeader));
        const normalizedCountry = normalizeCountryCode(sourceCountry, providerText(region));
        const country = isCountryCode(normalizedCountry) ? normalizedCountry : undefined;
        if (!country) continue;
        if (trace) trace.usedHeader = true;
        const city = providerText(decodeHeader(headers.get(provider.cityHeader)));

        const header = { country, region: getRegionCode(sourceCountry, region), city };
        if (header.region && header.city) return header;
        const database = await getLocation(cleanIp, headers, true, bundle, trace);
        if (!database) {
          if (trace) trace.reason ??= 'database_unavailable';
          return header;
        }
        if (database.country !== header.country) {
          if (trace) trace.reason = 'country_conflict';
          return header;
        }
        if (
          header.region &&
          geographyRegion(header.region, header.country) !==
            geographyRegion(database.region, database.country)
        ) {
          if (trace) trace.reason = 'province_conflict';
          return header;
        }
        if (header.city && consistentFill(header, database).reason === 'city_context_conflict') {
          if (trace) trace.reason = 'city_context_conflict';
          return header;
        }
        if (trace) trace.usedDatabase = true;
        return {
          country: header.country,
          region: header.region || database.region,
          city: header.city || database.city,
        };
      }
    }
  }

  // A lookup pins the complete managed generation. A valid user MMDB takes precedence.
  if (bundle === undefined) bundle = await geographyBundle();
  if (bundle && !process.env.GEOLITE_DB_PATH) {
    delete globalThis[MAXMIND];
    try {
      return readLocation(bundle.mmdb, cleanIp, trace);
    } catch {
      if (trace) trace.reason = 'database_corrupt';
      return null;
    }
  }

  const reader = await fallbackLocationReader();
  if (!reader) return null;

  try {
    return readLocation(reader, cleanIp, trace);
  } catch {
    // A readable database can still contain a corrupt tree or invalid field types.
    unavailableLocation();
    if (trace) trace.reason = 'database_corrupt';
    return null;
  }
}

async function fallbackLocationReader() {
  if (globalThis[MAXMIND]) return globalThis[MAXMIND];
  if (Date.now() < locationRetryAt) return null;
  locationDatabaseLoading ??= maxmind
    .open(process.env.GEOLITE_DB_PATH || path.resolve('geo/GeoLite2-City.mmdb'))
    .then(reader => {
      if (reader.metadata && !/city/i.test(reader.metadata.databaseType))
        throw new Error('city-database-required');
      globalThis[MAXMIND] = reader;
      return reader;
    })
    .catch(() => {
      unavailableLocation();
      return null;
    })
    .finally(() => {
      locationDatabaseLoading = undefined;
    });
  return locationDatabaseLoading;
}

function readLocation(reader: any, ip: string, trace?: LocationTrace) {
  const result = reader.get(ip);
  if (trace) {
    trace.databaseVersion = reader.metadata
      ? `${reader.metadata.databaseType}:${reader.metadata.buildEpoch}`
      : undefined;
    trace.countryBasis = result?.country?.iso_code
      ? 'located'
      : result?.registered_country?.iso_code
        ? 'registered'
        : 'missing';
    const radius = result?.location?.accuracy_radius;
    trace.accuracyRadius = Number.isInteger(radius) && radius >= 0 ? radius : undefined;
    if (!result) trace.reason = 'database_no_match';
  }
  return databaseLocation(result);
}

function databaseLocation(result: any) {
  if (!result) return null;
  const sourceCountry = result.country?.iso_code ?? result.registered_country?.iso_code;
  const region = result.subdivisions?.[0]?.iso_code;
  const city = result.city?.names?.en ?? result.city?.names?.['zh-CN'];
  if (
    [sourceCountry, region, city].some(v => v != null && typeof v !== 'string') ||
    (sourceCountry && !/^[A-Z]{2}$/.test(normalizeCountryCode(sourceCountry) || ''))
  )
    throw new Error('invalid-geography-fields');
  return {
    country: normalizeCountryCode(sourceCountry, region),
    region: getRegionCode(sourceCountry, region),
    city: providerText(city) ?? undefined,
  };
}

export async function getGeographyEvidence(
  ipEvidence: ReturnType<typeof resolveClientIp>,
  headers = new Headers(),
  skipHeaders = true,
): Promise<GeographyEvidence> {
  const ip = ipEvidence.ip;
  const bundle = await geographyBundle();
  if (bundle && !process.env.GEOLITE_DB_PATH) delete globalThis[MAXMIND];
  const trace: LocationTrace = {};
  const baseline = await getLocation(ip, headers, skipHeaders, bundle, trace);
  const filled =
    ip && isGeolocatable(ip) && !trace.reason?.includes('conflict')
      ? await enrichChina(baseline, ip, bundle)
      : {
          location: baseline || {},
          reason: trace.reason || (ip ? 'special_address' : 'missing_ip'),
          shadow: null,
          source: 'missing',
        };
  const location = filled.location;
  const usedHeader = !!trace.usedHeader;
  const usedXdb = ['mmdb+ip2region', 'ip2region'].includes(filled.source);
  const countryBasis: GeographyEvidence['countryBasis'] = usedHeader
    ? 'header'
    : usedXdb && !baseline?.country && location.country
      ? 'located'
      : trace.countryBasis || 'missing';
  const radius = trace.accuracyRadius ?? null;
  return {
    location,
    source: usedHeader
      ? [
          'ingress_header',
          ...(trace.usedDatabase ? ['mmdb'] : []),
          ...(usedXdb ? ['ip2region'] : []),
        ].join('+')
      : ['mmdb+ip2region', 'ip2region'].includes(filled.source)
        ? filled.source
        : location.country || location.city
          ? 'mmdb'
          : 'missing',
    trust: ipEvidence.source,
    ipFamily: ip ? (ip.includes(':') ? 'ipv6' : 'ipv4') : 'missing',
    precision: geographyPrecision(location),
    reason:
      (filled.reason === 'compatible_fill' ? filled.reason : trace.reason) ||
      (filled.reason === 'baseline_preserved'
        ? location.city
          ? 'city_present'
          : location.region
            ? 'city_missing'
            : location.country
              ? 'province_city_missing'
              : 'database_unavailable'
        : filled.reason),
    ruleVersion: GEOGRAPHY_RULE_VERSION,
    dataVersion:
      usedHeader && !trace.usedDatabase && !filled.shadow
        ? null
        : process.env.GEOLITE_DB_PATH
          ? trace.databaseVersion
            ? `${trace.databaseVersion}${bundle ? `:shadow-${bundle.manifest.version}` : ''}`
            : null
          : bundle?.manifest.version || trace.databaseVersion || null,
    cityId: identifyCity(location).cityId == null ? null : String(identifyCity(location).cityId),
    accuracyRadius: radius,
    countryBasis,
    processedAt: new Date().toISOString(),
    shadow: filled.shadow,
  };
}

export async function getClientInfo(
  request: Request,
  payload: Record<string, any>,
  authenticated = false,
) {
  const userAgent = payload?.userAgent || request.headers.get('user-agent');
  const ipEvidence = resolveClientIp(request.headers, payload?.ip, authenticated);
  const ip = ipEvidence.ip;
  const geographyEvidence = await getGeographyEvidence(
    ipEvidence,
    request.headers,
    !!payload?.ip && ipEvidence.source !== 'trusted_ingress',
  );
  const location = geographyEvidence.location;
  const country = normalizeCountryCode(location?.country, location?.region);
  const region = normalizeRegionCode(location?.region, location?.country);
  const city = location?.city;
  const browser = payload?.browser ?? browserName(userAgent);
  const os = payload?.os ?? (detectOS(userAgent) as string);
  const device = payload?.device ?? getDevice(userAgent, payload?.screen);

  return {
    userAgent,
    browser,
    os,
    ip,
    country,
    region,
    city,
    device,
    ipEvidence,
    geographyEvidence,
  };
}

export const hasBlockedIp = hasIgnoredIp;

export async function geographyAttribution() {
  const bundle = await geographyBundle();
  if (bundle && !process.env.GEOLITE_DB_PATH) delete globalThis[MAXMIND];
  let type =
    bundle && !process.env.GEOLITE_DB_PATH
      ? bundle.mmdb.metadata.databaseType
      : globalThis[MAXMIND]?.metadata?.databaseType;
  if (!type) type = (await fallbackLocationReader())?.metadata?.databaseType;
  const links = [];
  if (/dbip|db-ip/i.test(type || ''))
    links.push({ label: 'IP Geolocation by DB-IP', href: 'https://db-ip.com' });
  else if (/geolite|geoip/i.test(type || ''))
    links.push({ label: 'IP Geolocation by MaxMind', href: 'https://www.maxmind.com' });
  else if (type)
    links.push({ label: '已授权 IP 地理库', href: '/liekan/help?article=project-about' });
  if (bundle?.readers.length)
    links.push({ label: 'IP 查询：ip2region', href: 'https://github.com/lionsoul2014/ip2region' });
  return { links };
}
