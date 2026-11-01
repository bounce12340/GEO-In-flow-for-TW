import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { cookies, headers } from 'next/headers';
import { defaultLiekanLocale, isLiekanLocale, localeCookie } from '@/lib/liekan/i18n/locale';
import { Suspense } from 'react';
import { getBaseUrl } from '@/lib/get-base-url';
import { liekanProduct } from '@/lib/liekan/contracts/product';
import { Providers } from './Providers';
import '@umami/react-zen/styles.full.css';
import './global.css';

const inter = localFont({
  src: '../../public/liekan/fonts/inter-latin.woff2',
  weight: '400 800',
  display: 'swap',
  variable: '--font-inter',
});

export default async function ({ children }) {
  const stored = (await cookies()).get(localeCookie)?.value;
  const initialLocale = isLiekanLocale(stored)
    ? stored
    : defaultLiekanLocale(process.env.DEFAULT_LOCALE);
  if (process.env.DISABLE_UI) {
    return (
      <html>
        <body></body>
      </html>
    );
  }

  return (
    <html lang={initialLocale} className={`${inter.className} ${inter.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href="/liekan/favicon.svg" />
        <link rel="manifest" href="/site.webmanifest" crossOrigin="use-credentials" />
        <meta name="msapplication-TileColor" content="#da532c" />
        <meta name="theme-color" content="#fafafa" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#2f2f2f" media="(prefers-color-scheme: dark)" />
        <meta name="robots" content="noindex,nofollow" />
      </head>
      <body>
        <Suspense>
          <Providers initialLocale={initialLocale} storedLocale={isLiekanLocale(stored)}>
            {children}
          </Providers>
        </Suspense>
      </body>
    </html>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const name = liekanProduct.title;

  return {
    metadataBase: getBaseUrl(headerStore),
    title: {
      template: `%s | ${name}`,
      default: name,
    },
  };
}
