import type { Metadata } from 'next';
import { liekanProduct } from '@/lib/liekan/contracts/product';
import { SettingsLayout } from './SettingsLayout';

export default function ({ children }) {
  if (process.env.cloudMode) {
    return null;
  }

  return <SettingsLayout>{children}</SettingsLayout>;
}

export const metadata: Metadata = {
  title: {
    template: `%s | Settings | ${liekanProduct.title}`,
    default: `Settings | ${liekanProduct.title}`,
  },
};
