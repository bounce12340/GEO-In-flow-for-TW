'use client';
import { Row, Text } from '@umami/react-zen';
import { useShare } from '@/components/hooks';
import { liekanProduct } from '@/lib/liekan/contracts/product';

const LOGO_SIZE = { sm: 24, md: 32, lg: 40 };
const TEXT_SIZE = { sm: 'sm', md: 'base', lg: 'lg' } as const;

export function ShareBranding({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const share = useShare();
  const logoDomain = share?.whiteLabel?.domainName;
  const logoName = share?.whiteLabel?.displayName || liekanProduct.title;
  const logoImage =
    share?.whiteLabel?.logoUrl || `${process.env.basePath || ''}/liekan/features/logo.svg`;
  const height = LOGO_SIZE[size];

  const content = (
    <Row alignItems="center" gap>
      <img src={logoImage} alt="" style={{ height }} />
      <Text size={TEXT_SIZE[size]} weight="bold">
        {logoName}
      </Text>
    </Row>
  );
  return logoDomain ? (
    <a href={logoDomain} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 12 }}>
      {content}
    </a>
  ) : (
    <div style={{ marginLeft: 12 }}>{content}</div>
  );
}
