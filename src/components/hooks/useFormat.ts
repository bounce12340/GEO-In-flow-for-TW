import { BROWSERS, OS_NAMES } from '@/lib/constants';
import { normalizeCountryCode, normalizeRegionCode } from '@/lib/country';
import { useRegionNames } from './useRegionNames';
import { useCountryNames } from './useCountryNames';
import { useLanguageNames } from './useLanguageNames';
import { useLocale } from './useLocale';
import { useMessages } from './useMessages';

export function useFormat() {
  const { t, labels } = useMessages();
  const { locale } = useLocale();
  const { countryNames } = useCountryNames(locale);
  const { languageNames } = useLanguageNames(locale);
  const { getRegionName } = useRegionNames(locale);

  const formatOS = (value: string): string => {
    return OS_NAMES[value] || value;
  };

  const formatBrowser = (value: string): string => {
    return BROWSERS[value] || value;
  };

  const formatDevice = (value: string): string => {
    return t(labels[value] || labels.unknown);
  };

  const formatCountry = (value: string): string => {
    const country = normalizeCountryCode(value);

    return countryNames[country] || country || value;
  };

  const formatRegion = (value?: string): string => {
    const [country] = value?.split('-') || [];
    const normalizedCountry = normalizeCountryCode(country, value);
    const region = normalizeRegionCode(value, country);
    return getRegionName(region, normalizedCountry) || region;
  };

  const formatCity = (value: string, country?: string): string => {
    const countryCode = normalizeCountryCode(country);

    return countryNames[countryCode] ? `${value}, ${countryNames[countryCode]}` : value;
  };

  const formatLanguage = (value: string): string => {
    return languageNames[value?.split('-')[0]] || value;
  };

  const formatValue = (value: string, type: string, data?: Record<string, any>): string => {
    switch (type) {
      case 'os':
        return formatOS(value);
      case 'browser':
        return formatBrowser(value);
      case 'device':
        return formatDevice(value);
      case 'country':
        return formatCountry(value);
      case 'region':
        return formatRegion(value);
      case 'city':
        return formatCity(value, data?.country);
      case 'language':
        return formatLanguage(value);
      default:
        return typeof value === 'string' ? value : undefined;
    }
  };

  return {
    formatOS,
    formatBrowser,
    formatDevice,
    formatCountry,
    formatRegion,
    formatCity,
    formatLanguage,
    formatValue,
  };
}
