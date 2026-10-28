import { useMemo } from 'react';
import { useLocale } from '@/components/hooks/useLocale';
import { useNavigation } from '@/components/hooks/useNavigation';
import { DEFAULT_DATE_RANGE_VALUE } from '@/lib/constants';
import { getCompareDate, getOffsetDateRange, parseDateRange } from '@/lib/date';
import { useDateRangeClock } from '@/lib/liekan/upstream/date-range-clock';
import { useApp } from '@/store/app';
import { usePathname } from 'next/navigation';
import { toZonedTime } from 'date-fns-tz';
import { useShare } from './context/useShare';
import { resolveSharedDateRange, sharedTimezone } from '@/lib/liekan/contracts/shared-report';

export function useDateRange(options: { ignoreOffset?: boolean; timezone?: string } = {}) {
  const {
    query: { date = '', unit = '', offset = 0, compare = 'prev' },
  } = useNavigation();
  const { locale } = useLocale();
  const share = useShare();
  const pathname = usePathname();
  const publicView = !!share || pathname?.startsWith('/share/');
  const accountTimezone = useApp(state => state.timezone);
  const timezone = publicView
    ? sharedTimezone(share?.parameters)
    : options.timezone || accountTimezone || 'Asia/Taipei';
  const defaultRange = useApp(state => state.dateRangeValue);
  const publicDefault =
    typeof share?.parameters?.range === 'string'
      ? share.parameters.range
      : typeof share?.parameters?.date === 'string'
        ? share.parameters.date
        : share?.parameters?.startAt != null || typeof share?.parameters?.range === 'object'
          ? 'range:fixed'
          : '30day';
  const selectedDate =
    date || (publicView ? publicDefault : defaultRange) || DEFAULT_DATE_RANGE_VALUE;
  const readTime = useDateRangeClock(timezone, !selectedDate.startsWith('range:'));
  const sharedRange = publicView
    ? resolveSharedDateRange(share?.parameters || {}, readTime, date || undefined)
    : undefined;
  const dateRange = useMemo(() => {
    if (sharedRange)
      return {
        value:
          date ||
          (typeof share?.parameters?.range === 'string'
            ? share.parameters.range
            : `range:${sharedRange.startAt}:${sharedRange.endAt}`),
        startDate: toZonedTime(sharedRange.startAt, sharedRange.timezone),
        endDate: toZonedTime(sharedRange.endAt, sharedRange.timezone),
        unit: sharedRange.unit,
        num: 1,
        offset: 0,
      };
    const dateRangeObject = parseDateRange(
      date || defaultRange || DEFAULT_DATE_RANGE_VALUE,
      unit,
      locale,
      timezone,
      readTime,
    );

    return !options.ignoreOffset && offset
      ? getOffsetDateRange(dateRangeObject, +offset)
      : dateRangeObject;
  }, [
    date,
    unit,
    offset,
    defaultRange,
    locale,
    options.ignoreOffset,
    timezone,
    readTime,
    sharedRange?.startAt,
    sharedRange?.endAt,
    sharedRange?.timezone,
  ]);

  const dateCompare = getCompareDate(
    compare,
    dateRange.startDate,
    dateRange.endDate,
    selectedDate === '0day',
  );
  const sharedCompare = sharedRange
    ? getCompareDate(
        compare,
        new Date(sharedRange.startAt),
        new Date(sharedRange.endAt),
        sharedRange.timezone,
      )
    : undefined;

  return {
    date,
    unit,
    offset,
    compare,
    isAllTime: date.endsWith(`:all`),
    isCustomRange: selectedDate.startsWith('range:'),
    dateRange,
    sharedRange,
    sharedCompare,
    dateCompare,
  };
}
