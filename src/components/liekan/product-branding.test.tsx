import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiekanLocaleContext } from '@/lib/liekan/i18n/client';
import { ShareBranding } from '@/app/share/[slug]/[[...path]]/ShareBranding';
import { LoginForm } from '@/app/login/LoginForm';
import { liekanProduct, liekanPublisherLinks } from '@/lib/liekan/contracts/product';
import { ProductFooter } from './ProductFooter';

const share = vi.hoisted(() => ({
  whiteLabel: undefined as
    | undefined
    | {
        displayName?: string;
        domainName?: string;
        logoUrl?: string;
      },
}));
vi.mock('@/components/hooks', () => ({
  useShare: () => share,
  useMessages: () => ({
    t: (value: string) => value,
    labels: { username: 'Username', password: 'Password', required: 'Required', login: 'Login' },
    getErrorMessage: () => undefined,
  }),
  useUpdateQuery: () => ({ mutateAsync: vi.fn(), error: undefined }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('./GeographyAttribution', () => ({
  GeographyAttribution: () => <span>IP Geolocation by DB-IP</span>,
}));

beforeEach(() => {
  share.whiteLabel = undefined;
});

it.each(['zh-CN', 'en-US'] as const)(
  'preserves the approved product and publisher names in %s',
  locale => {
    render(
      <LiekanLocaleContext.Provider value={locale}>
        <ProductFooter />
      </LiekanLocaleContext.Provider>,
    );
    expect(screen.getByRole('link', { name: 'GEOInflow TW v1.2' })).toHaveAttribute(
      'href',
      '/liekan/help?article=project-changelog',
    );
    const publishers = document.querySelector('[data-product-publishers]');
    expect(Array.from(publishers?.children || []).map(child => child.textContent)).toEqual([
      locale === 'zh-CN' ? '联合发布：' : 'Jointly published by:',
      '猎看科技',
      '北京日报社智源GEO',
    ]);
    const license = screen.getByRole('link', { name: 'MIT' });
    expect(license).toBeInTheDocument();
    expect(license.nextElementSibling).toBe(screen.getByRole('link', { name: 'Umami' }));
    expect(screen.getByText('IP Geolocation by DB-IP')).toBeInTheDocument();
    for (const [name, href] of [
      ['Umami', 'https://github.com/umami-software/umami'],
      ['猎看科技', 'https://www.liekan.com/?GEOInflow'],
      ['北京日报社智源GEO', 'https://geo.takefoto.cn/?GEOInflow'],
      ['姚金刚', 'https://x.com/yaojingang'],
      ['向阳乔木', 'https://x.com/vista8'],
    ]) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.queryByRole('link', { name: /作者 X|Author on X/ })).toBeNull();
  },
);

it('uses GEOInflow TW on an uncustomized share without an external branding destination', () => {
  const { container } = render(<ShareBranding />);
  expect(screen.getByText('GEOInflow TW')).toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('src', '/liekan/features/logo.svg');
  expect(container.querySelector('a')).toBeNull();
});

it('preserves all custom share branding values', () => {
  share.whiteLabel = {
    displayName: '客户统计',
    domainName: 'https://customer.example',
    logoUrl: 'https://customer.example/logo.svg',
  };
  const { container } = render(<ShareBranding />);
  expect(screen.getByRole('link', { name: '客户统计' })).toHaveAttribute(
    'href',
    'https://customer.example',
  );
  expect(container.querySelector('img')).toHaveAttribute('src', share.whiteLabel.logoUrl);
  expect(container.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByText('GEOInflow TW')).toBeNull();
});

it('fills only absent custom brand values', () => {
  share.whiteLabel = { displayName: '客户统计' };
  const { container } = render(<ShareBranding />);
  expect(screen.getByText('客户统计')).toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('src', '/liekan/features/logo.svg');
  expect(container.querySelector('a')).toBeNull();
});

it('shows GEOInflow TW as the login heading and keeps identifiers and publisher links', () => {
  render(
    <LiekanLocaleContext.Provider value="zh-TW">
      <LoginForm />
      <ProductFooter />
    </LiekanLocaleContext.Provider>,
  );
  expect(screen.getByRole('heading', { name: 'GEOInflow TW' })).toBeInTheDocument();
  expect(liekanProduct.name).toBe('GEOInflow');
  expect(liekanProduct.displayName).toBe('GEOInflow');
  expect(liekanPublisherLinks.map(({ label, href }) => [label, href])).toEqual([
    ['猎看科技', 'https://www.liekan.com/?GEOInflow'],
    ['北京日报社智源GEO', 'https://geo.takefoto.cn/?GEOInflow'],
  ]);
  for (const { label, href } of liekanPublisherLinks) {
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
  }
});
