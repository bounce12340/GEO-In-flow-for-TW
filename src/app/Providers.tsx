'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, ZenProvider } from '@umami/react-zen';
import { NextIntlClientProvider } from 'next-intl';
import { Suspense, useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useLocale } from '@/components/hooks';
import { initializeLocale } from '@/components/hooks/useLocale';
import { ManualRefreshProvider } from '@/lib/liekan/contracts/manual-refresh';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { defaultLiekanLocale, type LiekanLocale } from '@/lib/liekan/i18n/locale';
import { liekanMessages } from '@/lib/liekan/i18n/text';
import { BrowserCacheProvider } from '@/lib/liekan/upstream/cache-client';
import 'chartjs-adapter-date-fns';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60,
    },
  },
});

function MessagesProvider({ children, initialLocale, storedLocale }) {
  const current = useLocale();
  const [initialized, setInitialized] = useState(false);
  const locale = initialized ? current.locale : initialLocale;
  const dir = initialized ? current.dir : 'ltr';
  useEffect(() => {
    initializeLocale(initialLocale);
    setInitialized(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('dir', dir);
    document.documentElement.setAttribute('lang', locale);
  }, [locale, dir]);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{
        ...current.messages[locale],
        liekan: liekanMessages[defaultLiekanLocale(locale)],
      }}
      onError={() => null}
    >
      <LiekanLocaleContext.Provider value={defaultLiekanLocale(locale)}>
        {initialized || storedLocale ? (
          children
        ) : (
          <div aria-busy="true" style={{ minHeight: '100dvh', background: '#fafafa' }} />
        )}
      </LiekanLocaleContext.Provider>
    </NextIntlClientProvider>
  );
}

export function Providers({
  children,
  initialLocale = 'zh-TW',
  storedLocale = false,
}: {
  children: React.ReactNode;
  initialLocale?: LiekanLocale;
  storedLocale?: boolean;
}) {
  return (
    <ZenProvider>
      <RouterProvider>
        <MessagesProvider initialLocale={initialLocale} storedLocale={storedLocale}>
          <QueryClientProvider client={client}>
            <Suspense>
              <BrowserCacheProvider>
                <ManualRefreshProvider>
                  <ErrorBoundary>{children}</ErrorBoundary>
                </ManualRefreshProvider>
              </BrowserCacheProvider>
            </Suspense>
          </QueryClientProvider>
        </MessagesProvider>
      </RouterProvider>
    </ZenProvider>
  );
}
