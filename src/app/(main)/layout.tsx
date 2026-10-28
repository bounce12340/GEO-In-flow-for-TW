import type { Metadata } from 'next';
import { Suspense } from 'react';
import { App } from './App';
import { liekanProduct } from '@/lib/liekan/contracts/product';

export default function ({ children }) {
  return (
    <Suspense>
      <App>{children}</App>
    </Suspense>
  );
}

export const metadata: Metadata = {
  title: {
    template: `%s | ${liekanProduct.title}`,
    default: liekanProduct.title,
  },
};
