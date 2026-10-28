/**
 * Generates the Traditional Chinese (Taiwan) catalogs from the Simplified source catalogs.
 *
 *   pnpm liekan:zh-tw            rewrite src/lib/liekan/i18n/{messages,help-messages}/zh-TW.json
 *   pnpm liekan:zh-tw --check    fail when the committed catalogs differ from a fresh generation
 *
 * OpenCC (cn → twp) supplies character and phrase conversion. The glossary below applies Taiwan
 * product wording that OpenCC leaves in mainland form. Hand-reviewed sentences live in
 * config/liekan/zh-TW-overrides.json and always win. Proper names, executable query literals and
 * publisher names are protected and stay byte-identical.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

/** Byte-identical in every locale (publisher names, people, demo identity, query literals). */
const preservedTerms = [
  '北京日报社智源GEO',
  '猎看官网（示例数据）',
  '猎看科技',
  '向阳乔木',
  '姚金刚',
  'eq.AI 搜索引荐',
  'select[aria-label="分析网站"]',
  'textarea[aria-label="分析问题"]',
  '猎看',
];

/** Applied in order after OpenCC; each entry is [pattern, replacement]. */
const taiwanGlossary = [
  [/許可權/g, '權限'],
  [/例項/g, '實例'],
  [/映象/g, '映像'],
  [/回撥/g, '回呼'],
  [/賬/g, '帳'],
  [/臺/g, '台'],
  [/質量/g, '品質'],
  [/渠道/g, '管道'],
  [/運營/g, '營運'],
  [/獲取/g, '取得'],
  [/域名/g, '網域'],
  [/服務端/g, '伺服器端'],
  [/客戶端/g, '用戶端'],
  [/模板/g, '範本'],
  [/示例/g, '範例'],
  [/會話/g, '工作階段'],
  [/訪問(?=權限|控制|令牌|金鑰|位址|地址|憑證|日誌|記錄|紀錄)/g, '存取'],
  [/當前/g, '目前'],
  [/訪問/g, '造訪'],
  [/(?<!郵件|電子郵件|寄送)地址/g, '位址'],
  [/二維碼/g, 'QR Code'],
  [/時間戳(?!記)/g, '時間戳記'],
  [/郵箱/g, '電子郵件信箱'],
  [/轉化/g, '轉換'],
  [/儀表盤/g, '儀表板'],
  [/退出登入/g, '登出'],
  [/(?<=[上下本當該整每一兩幾個]|自然|按|跨)周(?![邊圍全到詳])/g, '週'],
  [/周(?=[一二三四五六日末報期])/g, '週'],
  [/配置/g, '設定'],
  [/設定設定/g, '設定'],
  [/默認/g, '預設'],
  [/數據/g, '資料'],
  [/實時/g, '即時'],
  [/視頻/g, '影片'],
  [/文檔/g, '文件'],
  [/緩存/g, '快取'],
  [/字符/g, '字元'],
  // OpenCC twp phrase forms that read as mainland or wrong-sense wording in Taiwan product UI.
  [/引數/g, '參數'],
  [/釋出/g, '發布'],
  [/稽覈/g, '審核'],
  [/自定義/g, '自訂'],
  [/響應(?!式)/g, '回應'],
];

const placeholder = index => `\uE000${index}\uE001`;

function toTaiwan(source) {
  let text = source;
  const kept = [];
  for (const term of preservedTerms) text = text.split(term).join(placeholder(kept.push(term) - 1));
  text = converter(text);
  for (const [pattern, replacement] of taiwanGlossary) text = text.replace(pattern, replacement);
  return text.replace(/\uE000(\d+)\uE001/g, (_match, index) => kept[Number(index)]);
}

const overrides = JSON.parse(readFileSync('config/liekan/zh-TW-overrides.json', 'utf8'));

function generateCatalog(chinese) {
  return Object.fromEntries(
    Object.entries(chinese).map(([key, source]) => [key, overrides[key] ?? toTaiwan(source)]),
  );
}

const roots = ['messages', 'help-messages'];
const check = process.argv.includes('--check');
let stale = 0;
for (const directory of roots) {
  const base = `src/lib/liekan/i18n/${directory}`;
  const chinese = JSON.parse(readFileSync(`${base}/zh-CN.json`, 'utf8'));
  const output = `${JSON.stringify(generateCatalog(chinese), null, 2)}\n`;
  const target = `${base}/zh-TW.json`;
  if (check) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      /* Missing catalog is reported below. */
    }
    if (current !== output) {
      stale++;
      console.error(`Stale Traditional Chinese catalog: ${target}`);
    }
  } else writeFileSync(target, output);
}
// Geography display names (provinces, reviewed cities, Simplified country names) for zh-TW.
const geography = JSON.parse(
  readFileSync('src/lib/liekan/contracts/geography-catalog.json', 'utf8'),
);
const countryNames = JSON.parse(readFileSync('public/intl/country/zh-CN.json', 'utf8'));
const names = [
  ...geography.provinces.map(province => province.name),
  ...geography.cities.map(city => city.name),
  ...Object.values(countryNames),
].filter(name => /[\u3400-\u9fff]/.test(name));
const geographyMap = Object.fromEntries(
  [...new Set(names)]
    .sort()
    .map(name => [name, toTaiwan(name)])
    .filter(([name, traditional]) => name !== traditional),
);
const geographyTarget = 'src/lib/liekan/i18n/geography-zh-TW.json';
const geographyOutput = `${JSON.stringify(geographyMap, null, 2)}\n`;
if (check) {
  let current = '';
  try {
    current = readFileSync(geographyTarget, 'utf8');
  } catch {
    /* Missing map is reported below. */
  }
  if (current !== geographyOutput) {
    stale++;
    console.error(`Stale Traditional Chinese geography names: ${geographyTarget}`);
  }
} else writeFileSync(geographyTarget, geographyOutput);
for (const key of Object.keys(overrides))
  if (!/^m_[0-9a-f]{12}$/.test(key)) throw new Error(`Invalid zh-TW override key: ${key}`);
if (stale) {
  console.error('Run `pnpm liekan:zh-tw` and review the diff.');
  process.exit(1);
}
console.log(
  check ? 'Traditional Chinese catalogs are current.' : 'Traditional Chinese catalogs generated.',
);
