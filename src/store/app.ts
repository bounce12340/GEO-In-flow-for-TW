import { create } from 'zustand';
import {
  DATE_RANGE_CONFIG,
  DEFAULT_DATE_RANGE_VALUE,
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  LOCALE_CONFIG,
  THEME_CONFIG,
  TIMEZONE_CONFIG,
} from '@/lib/constants';
import type { AccountPreferences } from '@/lib/liekan/contracts/account-preferences';
import { getItem } from '@/lib/storage';

const initialState = {
  locale: getItem(LOCALE_CONFIG) || process.env.defaultLocale || DEFAULT_LOCALE,
  theme: getItem(THEME_CONFIG) || DEFAULT_THEME,
  timezone: getItem(TIMEZONE_CONFIG) || 'Asia/Taipei',
  dateRangeValue: getItem(DATE_RANGE_CONFIG) || DEFAULT_DATE_RANGE_VALUE,
  accountPreferences: null as AccountPreferences | null,
  share: null,
  shareToken: null,
  user: null,
  config: null,
};

const store = create(() => ({ ...initialState }));

export function setTimezone(timezone: string) {
  store.setState({ timezone });
}

export function setLocale(locale: string) {
  store.setState({ locale });
}

export function setShareData(share: object | null, shareToken: { token?: string } | null) {
  store.setState({ share, shareToken });
}

export function setUser(user: object) {
  store.setState({ user });
}

export function setConfig(config: object) {
  store.setState({ config });
}

export function setDateRangeValue(dateRangeValue: string) {
  store.setState({ dateRangeValue });
}

export function setAccountPreferences(accountPreferences: AccountPreferences | null) {
  store.setState(
    accountPreferences
      ? {
          accountPreferences,
          timezone: accountPreferences.timezone,
          dateRangeValue: accountPreferences.range,
        }
      : { accountPreferences },
  );
}

export const useApp = store;
