import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import { GeographyAttribution } from './GeographyAttribution';
import Link from '@/components/liekan/Link';
import {
  liekanFooterLinks,
  liekanProduct,
  liekanPublisherLinks,
} from '@/lib/liekan/contracts/product';
import styles from '@/styles/liekan/ProductFooter.module.css';

export function ProductFooter() {
  const i18n = useLiekanI18n();
  return (
    <footer
      className={styles.footer}
      data-liekan-product-footer
      aria-label={i18n.text('GEOInflow项目信息')}
    >
      <div className={styles.inner}>
        <div className={styles.identity}>
          <Link className={styles.version} prefetch={false} href={liekanProduct.links.changelog}>
            {liekanProduct.title} v{liekanProduct.displayVersion}
          </Link>
          <span className={styles.publishers} data-product-publishers>
            <span>{i18n.text('联合发布：')}</span>
            {liekanPublisherLinks.map(({ label, href }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                {label}
              </a>
            ))}
          </span>
          <span className={styles.attribution}>
            <a href={liekanProduct.links.license} target="_blank" rel="noopener noreferrer">
              {liekanProduct.license}
            </a>
            <a href={liekanProduct.links.upstream} target="_blank" rel="noopener noreferrer">
              Umami
            </a>
          </span>
        </div>
        <nav className={styles.links} aria-label={i18n.text('项目相关链接')}>
          <GeographyAttribution />
          {liekanFooterLinks
            .filter(link => link.label !== 'IP Geolocation by DB-IP')
            .map(({ label, href }) =>
              href.startsWith('https://') ? (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer">
                  {i18n.system(label)}
                </a>
              ) : (
                <Link key={label} prefetch={false} href={href}>
                  {i18n.system(label)}
                </Link>
              ),
            )}
        </nav>
      </div>
    </footer>
  );
}
