import type { Metadata } from 'next';
import { liekanProduct } from '@/lib/liekan/contracts/product';
import { AdminLayout } from './AdminLayout';

export default function ({ children }) {
  if (process.env.cloudMode) {
    return null;
  }

  return <AdminLayout>{children}</AdminLayout>;
}

export const metadata: Metadata = {
  title: {
    template: `%s | Admin | ${liekanProduct.title}`,
    default: `Admin | ${liekanProduct.title}`,
  },
};
