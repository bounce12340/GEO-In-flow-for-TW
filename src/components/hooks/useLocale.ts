import { useEffect } from 'react';
import { LOCALE_CONFIG } from '@/lib/constants';
import { httpGet } from '@/lib/fetch';
import { getDateLocale, getTextDirection } from '@/lib/lang';
import { languages } from '@/lib/lang';
import { setItem } from '@/lib/storage';
import { getItem } from '@/lib/storage';
import { setLocale, useApp } from '@/store/app';
import enUS from '../../../public/intl/messages/en-US.json';
import zhCN from '../../../public/intl/messages/zh-CN.json';
import zhTW from '../../../public/intl/messages/zh-TW.json';
import {
  isLiekanLocale,
  localeCookie,
  readLocaleCookie,
  resolveLiekanLocale,
  type LiekanLocale,
} from '@/lib/liekan/i18n/locale';
import { useForceUpdate } from './useForceUpdate';

const messages: Record<string, typeof enUS | typeof zhCN | typeof zhTW> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};
const pending = new Map<string, Promise<void>>();

function persistLocale(value: string) {
  let persisted = false;
  try {
    setItem(LOCALE_CONFIG, value);
    persisted = getItem(LOCALE_CONFIG) === value;
  } catch {
    /* Storage can be disabled by browser policy. */
  }
  if (isLiekanLocale(value)) {
    try {
      const path = process.env.basePath || '/';
      document.cookie = `${localeCookie}=${encodeURIComponent(value)}; Path=${path}; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch {
      /* The current page still uses the selected language. */
    }
    try {
      const cookie = readLocaleCookie(document.cookie);
      // A readable canonical cookie decides the language on the next visit.
      persisted = cookie ? cookie === value : persisted;
    } catch {
      persisted = false;
    }
  }
  return persisted;
}

export function initializeLocale(initial: LiekanLocale) {
  let stored: unknown;
  try {
    stored = getItem(LOCALE_CONFIG);
  } catch {
    /* Browser storage is unavailable. */
  }
  let cookie: LiekanLocale | undefined;
  try {
    cookie = readLocaleCookie(document.cookie);
  } catch {
    /* Browser policy can block reads. */
  }
  const hint = new URL(window.location.href).searchParams.get('locale');
  const locale = resolveLiekanLocale({ cookie, stored, hint, configured: initial });
  setLocale(locale);
  if (cookie || isLiekanLocale(stored)) persistLocale(locale);
}

const selector = (state: { locale: string }) => state.locale;

export function useLocale() {
  const locale = useApp(selector);
  const forceUpdate = useForceUpdate();
  const dir = getTextDirection(locale);
  const dateLocale = getDateLocale(locale);

  async function loadMessages(locale: string) {
    if (!(locale in languages)) throw new Error('Unsupported locale');
    let request = pending.get(locale);
    if (!request) {
      request = httpGet(
        `${process.env.basePath || ''}/intl/messages/${encodeURIComponent(locale)}.json`,
      )
        .then(({ data }) => {
          messages[locale] = data;
        })
        .finally(() => pending.delete(locale));
      pending.set(locale, request);
    }
    await request;
  }

  async function saveLocale(value: string) {
    if (!(value in languages)) throw new Error('Unsupported locale');
    if (!messages[value]) {
      await loadMessages(value);
    }

    const persisted = persistLocale(value);

    if (locale !== value) {
      setLocale(value);
    } else {
      forceUpdate();
    }
    return { persisted };
  }

  useEffect(() => {
    if (!messages[locale]) {
      loadMessages(locale)
        .then(forceUpdate)
        .catch(() => {});
    }
  }, [locale]);

  return { locale, saveLocale, messages, dir, dateLocale };
}
