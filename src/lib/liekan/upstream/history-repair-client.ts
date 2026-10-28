'use client';
import { getApiUrl } from '@/lib/api-url';
import { getClientAuthToken } from '@/lib/client';
import { FeatureApiError } from './features-client';
import { isLiekanLocale, storageLiekanLocale } from '../i18n/locale';

export async function downloadHistoryRepair(
  websiteId: string,
  generation: string,
  locale: string,
  signal?: AbortSignal,
) {
  const url = new URL(
    getApiUrl(`/liekan/websites/${websiteId}/history-repair/export`),
    window.location.origin,
  );
  url.searchParams.set('generation', generation);
  url.searchParams.set('locale', isLiekanLocale(locale) ? storageLiekanLocale(locale) : locale);
  const response = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: { authorization: `Bearer ${getClientAuthToken() || ''}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new FeatureApiError(data?.error?.message || '修复记录导出失败', response.status);
  }
  return { csv: await response.text(), filename: 'geoinflow-history-repair.csv' };
}
