import { Button, ListItem, Row, Select } from '@umami/react-zen';
import { useState } from 'react';
import {
  accountCountryCodes,
  accountTimezoneForCountry,
  countryTimezoneChoices,
} from '@/lib/liekan/contracts/account-preferences';
import { countryName } from '@/lib/liekan/contracts/geography';
import { useLiekanI18n } from '@/lib/liekan/i18n/client';
import {
  saveAccountPreferences,
  useAccountPreferences,
} from '@/lib/liekan/upstream/account-preferences-client';

export function TimezoneSetting() {
  const i18n = useLiekanI18n();
  const preferences = useAccountPreferences();
  const [country, setCountry] = useState(preferences?.countryCode || 'CN');
  const [timezone, setTimezone] = useState(
    accountTimezoneForCountry(country, preferences?.timezone || 'Asia/Taipei') || '',
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (countryCode: string, zone: string) => {
    setBusy(true);
    try {
      await saveAccountPreferences({ countryCode, timezone: zone });
      setCountry(countryCode);
      setTimezone(zone);
      setError('');
    } catch (error) {
      setError(i18n.system(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row gap wrap="wrap">
      <Select
        aria-label={i18n.text('国家或地区')}
        value={country}
        onChange={(value: any) => {
          setCountry(value);
          const zones = countryTimezoneChoices(value);
          setTimezone(value === 'CN' ? 'Asia/Shanghai' : zones.length === 1 ? zones[0] : '');
        }}
        buttonProps={{ style: { minWidth: '180px' } }}
      >
        {accountCountryCodes.map(code => (
          <ListItem key={code} id={code}>
            {countryName(code, i18n.locale)}
          </ListItem>
        ))}
      </Select>
      <Select
        aria-label={i18n.text('分析时区')}
        value={timezone}
        onChange={(value: any) => setTimezone(value)}
        buttonProps={{ style: { minWidth: '250px' } }}
      >
        {countryTimezoneChoices(country).map(zone => (
          <ListItem key={zone} id={zone}>
            {zone}
          </ListItem>
        ))}
      </Select>
      <Button isDisabled={busy || !timezone} onPress={() => save(country, timezone)}>
        {i18n.text('保存')}
      </Button>
      <Button isDisabled={busy} onPress={() => save('CN', 'Asia/Taipei')}>
        {i18n.text('重置')}
      </Button>
      {error && <span role="alert">{error}</span>}
    </Row>
  );
}
