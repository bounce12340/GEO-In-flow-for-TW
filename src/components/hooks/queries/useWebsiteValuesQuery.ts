import { cityValueOptions } from '@/lib/liekan/contracts/geography';
import { useCountryNames } from '@/components/hooks/useCountryNames';
import { useRegionNames } from '@/components/hooks/useRegionNames';
import { useApi } from '../useApi';
import { useLocale } from '../useLocale';
import { useDateParameters } from '../useDateParameters';
import { calendarDateTimeToUtc } from '@/lib/liekan/contracts/calendar';

export function useWebsiteValuesQuery({
  websiteId,
  type,
  startDate,
  endDate,
  search,
}: {
  websiteId: string;
  type: string;
  startDate: Date;
  endDate: Date;
  search?: string;
}) {
  const { get, useQuery } = useApi();
  const { locale } = useLocale();
  const calendar = useDateParameters({ calendarMetadata: true });
  const { timezone, datesAreLocal } = calendar;
  const startAt =
    datesAreLocal && Number.isFinite(+startDate)
      ? +startDate === calendar.displayStartAt
        ? calendar.startAt
        : calendarDateTimeToUtc(startDate, timezone)
      : +startDate;
  const endAt =
    datesAreLocal && Number.isFinite(+endDate)
      ? +endDate === calendar.displayEndAt
        ? calendar.endAt
        : calendarDateTimeToUtc(endDate, timezone)
      : +endDate;
  const { countryNames } = useCountryNames(locale);
  const { regionNames } = useRegionNames(locale);

  const names = {
    country: countryNames,
    region: regionNames,
  };

  const getSearch = (type: string, value: string) => {
    if (value) {
      const values = names[type];

      if (values) {
        return (
          Object.keys(values)
            .reduce((arr: string[], key: string) => {
              if (values[key].toLowerCase().includes(value.toLowerCase())) {
                return arr.concat(key);
              }
              return arr;
            }, [])
            .slice(0, 5)
            .join(',') || value
        );
      }

      return value;
    }
  };

  return useQuery({
    queryKey: ['websites:values', { websiteId, type, startAt, endAt, timezone, search, locale }],
    queryFn: async ({ signal }: { signal?: AbortSignal } = {}) => {
      const rows = await get(
        `/websites/${websiteId}/values`,
        {
          type,
          startAt,
          endAt,
          search: getSearch(type, search),
        },
        {},
        signal,
      );
      return type === 'city' ? cityValueOptions(rows, locale === 'zh-CN' || locale === 'zh-TW') : rows;
    },
    enabled: !!(websiteId && type && startDate && endDate),
  });
}
