import { beforeEach, expect, test, vi } from 'vitest';
import { LEGACY_TAIWAN_REGION_CODE, TAIWAN_COUNTRY_CODE } from './country';
import { getClientInfo, getDevice, getLocation, hasBlockedIp } from './detect';
import { getIpAddress } from './ip';

const IP = '127.0.0.1';

const isLocalhost = vi.mocked(await import('is-localhost-ip'));

vi.mock('is-localhost-ip', () => ({
  default: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();

  delete process.env.CLIENT_IP_HEADER;
  delete process.env.IGNORE_IP;
  delete process.env.SKIP_LOCATION_HEADERS;
});

test('getIpAddress: Custom header', () => {
  process.env.CLIENT_IP_HEADER = 'x-custom-ip-header';

  expect(getIpAddress(new Headers({ 'x-custom-ip-header': IP }))).toEqual(IP);
});

test('getIpAddress: Custom header set to x-forwarded-for uses leftmost IP in chain', () => {
  process.env.CLIENT_IP_HEADER = 'x-forwarded-for';

  expect(getIpAddress(new Headers({ 'x-forwarded-for': `${IP}, 10.0.0.1, 10.0.0.2` }))).toEqual(IP);
});

test('getIpAddress: CloudFlare header', () => {
  expect(getIpAddress(new Headers({ 'cf-connecting-ip': IP }))).toEqual(IP);
});

test('getIpAddress: Standard header', () => {
  expect(getIpAddress(new Headers({ 'x-forwarded-for': IP }))).toEqual(IP);
});

test('getIpAddress: No header', () => {
  expect(getIpAddress(new Headers())).toEqual(undefined);
});

test('getLocation: returns null for malformed ip', async () => {
  await expect(
    getLocation(
      'not-an-ip',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual(null);
});

test('getLocation: treats localhost check errors as non-local', async () => {
  isLocalhost.default.mockRejectedValue(new Error('DNS Lookup failed.'));

  await expect(
    getLocation(
      '8.8.8.8',
      new Headers({
        'cf-ipcountry': 'US',
        'cf-region-code': 'CA',
        'cf-ipcity': 'Los Angeles',
      }),
      false,
    ),
  ).resolves.toEqual({
    country: 'US',
    region: 'US-CA',
    city: 'Los Angeles',
  });
});

test.each([`${TAIWAN_COUNTRY_CODE}-TPE`, 'TPE'])(
  'getLocation: stores Taiwan geolocation as TW with ISO county %s',
  async region => {
    await expect(
      getLocation(
        '8.8.8.8',
        new Headers({
          'cf-ipcountry': TAIWAN_COUNTRY_CODE,
          'cf-region-code': region,
          'cf-ipcity': 'Taipei',
        }),
        false,
      ),
    ).resolves.toEqual({
      country: 'TW',
      region: 'TW-TPE',
      city: 'Taipei',
    });
  },
);

test('getLocation: stores a legacy China-Taiwan province header as TW without a county', async () => {
  await expect(
    getLocation(
      '8.8.8.8',
      new Headers({
        'cf-ipcountry': 'CN',
        'cf-region-code': LEGACY_TAIWAN_REGION_CODE,
        'cf-ipcity': 'Taipei',
      }),
      false,
    ),
  ).resolves.toMatchObject({ country: 'TW', region: null, city: 'Taipei' });
});

test.each(['TW', 'TWN'])(
  'getLocation: keeps country %s as TW without inventing a county',
  async country => {
    const location = await getLocation('8.8.8.8', new Headers({ 'cf-ipcountry': country }), false);
    expect(location?.country).toBe('TW');
    expect(location?.region ?? null).toBeNull();
  },
);

test('hasBlockedIp: returns false for malformed client ip with cidr block', () => {
  process.env.IGNORE_IP = '10.0.0.0/8';

  expect(hasBlockedIp('not-an-ip')).toBe(false);
});

test.each([
  [
    'iPhone',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1',
    'mobile',
  ],
  ['iPod', 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) Mobile/15E148', 'mobile'],
  [
    'Android phone',
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0.0.0 Mobile Safari/537.36',
    'mobile',
  ],
  [
    'Android tablet',
    'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) Chrome/130.0.0.0 Safari/537.36',
    'tablet',
  ],
  [
    'Android tablet without a model',
    'Mozilla/5.0 (Linux; Android 10; K) Chrome/130.0.0.0 Safari/537.36',
    'tablet',
  ],
  ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile/15E148 Safari/604.1', 'tablet'],
  [
    'iPad with Macintosh token',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148 Safari/604.1',
    'tablet',
  ],
  ['Kindle', 'Mozilla/5.0 (Linux; U; en-US; Kindle/3.0+) AppleWebKit/533.1', 'tablet'],
  ['Fire tablet', 'Mozilla/5.0 (Linux; Android 9; KFMAWI) Silk/80.1 Safari/537.36', 'tablet'],
  [
    'Fire phone',
    'Mozilla/5.0 (Linux; Android 4.2.2; SD4930UR) Silk/44.1 Mobile Safari/537.36',
    'mobile',
  ],
  [
    'Windows Phone',
    'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Mobile Safari/537.36',
    'mobile',
  ],
  [
    'Windows Phone without Mobile token',
    'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1)',
    'mobile',
  ],
  ['BlackBerry', 'Mozilla/5.0 (BB10; Touch) Version/10.3.3.3216 Mobile Safari/537.35+', 'mobile'],
  ['Opera Mini', 'Opera/9.80 (J2ME/MIDP; Opera Mini/9.80) Presto/2.12.423', 'mobile'],
  ['HarmonyOS phone', 'Mozilla/5.0 (Phone; HarmonyOS 4.0) Mobile Safari/537.36', 'mobile'],
  ['HarmonyOS tablet', 'Mozilla/5.0 (Tablet; HarmonyOS 4.0) Safari/537.36', 'tablet'],
  ['Smart TV', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) TV Safari/537.36', 'smarttv'],
  ['Android TV', 'Mozilla/5.0 (Linux; Android TV 12) Chrome/130.0.0.0 Safari/537.36', 'smarttv'],
  ['Fire TV', 'Mozilla/5.0 (Linux; Android 9; AFTT) Chrome/130.0.0.0 Safari/537.36', 'smarttv'],
  ['Xbox', 'Mozilla/5.0 (Windows NT 10.0; Xbox; Xbox One) Chrome/130.0.0.0', 'console'],
  ['PlayStation', 'Mozilla/5.0 (PlayStation 5/SmartTV) AppleWebKit/605.1.15', 'console'],
  ['Nintendo', 'Mozilla/5.0 (Nintendo Switch; WebApplet) AppleWebKit/609.4', 'console'],
  ['Wear OS', 'Mozilla/5.0 (Linux; Android 9; Wear OS) Mobile Safari/537.36', 'wearable'],
  ['Chromecast', 'Mozilla/5.0 (CrKey armv7l) Chrome/130.0.0.0 Safari/537.36', 'embedded'],
  [
    'Windows desktop',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36',
    'desktop',
  ],
  [
    'Mac desktop',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',
    'desktop',
  ],
  ['Linux desktop', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0', 'desktop'],
  ['unknown agent', 'ExampleClient/1.0', 'desktop'],
  ['missing agent', '', 'desktop'],
])('getDevice: %s', (_name, userAgent, expected) => {
  expect(getDevice(userAgent)).toBe(expected);
});

test.each([null, undefined])('getDevice: handles absent agent %s', userAgent => {
  expect(getDevice(userAgent)).toBe('desktop');
});

test.each([
  ['1366x768', 'laptop'],
  ['1920x1080', 'laptop'],
  ['1921x1080', 'desktop'],
  ['2560x1440', 'desktop'],
  ['', 'desktop'],
  ['unknown', 'desktop'],
])('getDevice: preserves desktop screen classification for %s', (screen, expected) => {
  expect(getDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', screen)).toBe(expected);
});

test('getDevice: screen width does not override mobile and tablet agents', () => {
  expect(getDevice('Mozilla/5.0 (iPhone) Mobile/15E148', '2560x1440')).toBe('mobile');
  expect(getDevice('Mozilla/5.0 (iPad) Mobile/15E148', '1024x768')).toBe('tablet');
});

test('getClientInfo: derives device from request while retaining browser and OS detection', async () => {
  isLocalhost.default.mockResolvedValue(true);
  const userAgent =
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130.0.0.0 Mobile Safari/537.36';
  const request = new Request('https://example.com/api/send', {
    headers: { 'user-agent': userAgent },
  });

  await expect(getClientInfo(request, { ip: IP, screen: '1920x1080' })).resolves.toMatchObject({
    userAgent,
    browser: 'chrome',
    os: 'Android OS',
    device: 'mobile',
  });
});

test('getClientInfo: retains explicitly supplied client metadata', async () => {
  isLocalhost.default.mockResolvedValue(true);
  const request = new Request('https://example.com/api/send', {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile/15E148' },
  });

  await expect(
    getClientInfo(request, { ip: IP, device: 'tablet', browser: 'custom', os: 'custom' }),
  ).resolves.toMatchObject({ device: 'tablet', browser: 'custom', os: 'custom' });
});
