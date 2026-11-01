'use client';
import { useState } from 'react';
import { useFeatureLocale } from '@/lib/liekan/upstream/locale-client';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import styles from '@/styles/liekan/LanguageSelector.module.css';

export function LanguageSelector({
  compact = false,
  field = false,
  toolbar = false,
}: {
  compact?: boolean;
  field?: boolean;
  toolbar?: boolean;
}) {
  const { saveLocale } = useFeatureLocale();
  const { locale } = useLiekanI18n();
  const [persistenceError, setPersistenceError] = useState(false);
  return (
    <div
      data-language-selector
      data-language-placement={toolbar || compact ? 'header' : undefined}
      className={`${styles.root} ${compact ? styles.compact : ''} ${field ? styles.field : ''} ${toolbar ? styles.toolbar : ''}`}
    >
      <label>
        <span className={toolbar ? styles.srOnly : undefined}>Language / 语言</span>
        {toolbar && (
          <svg
            className={styles.globe}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z" />
          </svg>
        )}
        <select
          aria-label="Language / 语言"
          value={locale}
          onChange={async event => {
            event.stopPropagation();
            const { persisted } = await saveLocale(event.currentTarget.value);
            setPersistenceError(!persisted);
          }}
        >
          <option value="zh-TW">繁體中文</option>
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English</option>
        </select>
      </label>
      {persistenceError && (
        <small role="status">
          {locale === 'en-US'
            ? 'Language changed for this page. Browser settings prevented saving your preference.'
            : locale === 'zh-TW'
              ? '本頁語言已切換，瀏覽器設定阻止了偏好儲存。'
              : '本页语言已切换，浏览器设置阻止了偏好保存。'}
        </small>
      )}
    </div>
  );
}
