import { normalizeCountryCode, normalizeRegionCode } from '@/lib/country';
import { provinceDefinitions, traditionalGeographyName } from '@/lib/liekan/contracts/geography';
import regions from '../../../public/iso-3166-2.json';
import { useCountryNames } from './useCountryNames';

export function useRegionNames(locale: string) {
  const { countryNames } = useCountryNames(locale);
  const regionNames = { ...regions };
  for (const province of provinceDefinitions) {
    const name =
      locale === 'zh-CN'
        ? province.name
        : locale === 'zh-TW'
          ? traditionalGeographyName(province.name)
          : regions[province.alias] || regions[province.code];
    if (name) {
      regionNames[province.code] = name;
      regionNames[province.alias] = name;
    }
  }

  const getRegionName = (regionCode: string, countryCode?: string) => {
    if (!regionCode) {
      return null;
    }

    if (!countryCode) {
      const [country] = regionCode.split('-');
      const normalizedCountry = normalizeCountryCode(country, regionCode);
      const region = normalizeRegionCode(regionCode, country);
      const regionName = regionNames[region];

      return regionName && normalizedCountry
        ? `${regionName}, ${countryNames[normalizedCountry]}`
        : regionName || region;
    }

    const country = normalizeCountryCode(countryCode, regionCode);
    const region = normalizeRegionCode(regionCode, countryCode);
    const regionName = regionNames[region];

    return regionName ? `${regionName}, ${countryNames[country]}` : region;
  };

  return { regionNames, getRegionName };
}
