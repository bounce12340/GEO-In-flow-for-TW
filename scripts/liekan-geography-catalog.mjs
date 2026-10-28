import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = 'src/lib/liekan/contracts/geography-catalog.json';
const bytes = readFileSync(file);
const catalog = JSON.parse(bytes);
const manifest = JSON.parse(readFileSync('config/liekan/geography.json', 'utf8'));
assert.equal(
  createHash('sha256').update(bytes).digest('hex'),
  manifest.sha256,
  'Reviewed geography catalogue changed',
);
assert.equal(catalog.version, manifest.version);
assert.equal(catalog.cities.length, manifest.cities);
assert.equal(catalog.license, 'CC-BY-4.0');
assert.equal(catalog.provinces.length, 33);
const provinceCodes = new Set(catalog.provinces.map(row => row.code));
const fips = new Set();
for (const province of catalog.provinces) {
  assert.match(province.code, /^CN-\d{2}$/);
  assert.match(province.alias, /^CN-[A-Z]{2}$/);
  if (province.geonamesAdmin1) {
    assert(!fips.has(province.geonamesAdmin1), 'Ambiguous GeoNames province crosswalk');
    fips.add(province.geonamesAdmin1);
  }
}
const ids = new Set(),
  aliases = new Map();
for (const city of catalog.cities) {
  assert(Number.isInteger(city.id) && city.id > 0 && !ids.has(city.id));
  ids.add(city.id);
  assert.match(city.name, /^[\u3400-\u9fff]+$/);
  assert(['CN', 'HK', 'MO', 'TW'].includes(city.country));
  assert(city.country === 'CN' || city.region === null);
  assert(city.country !== 'CN' || provinceCodes.has(city.region));
  assert(city.aliases.includes(city.name));
  for (const alias of new Set(
    city.aliases.map(value => value.normalize('NFC').trim().toLowerCase()),
  )) {
    assert(alias && alias.length <= 100);
    const key = JSON.stringify([city.country, city.region, alias]);
    assert(!aliases.has(key), `Ambiguous contextual city alias: ${key}`);
    aliases.set(key, city.id);
  }
}
for (const source of catalog.sources) {
  assert(source.url.startsWith('https://download.geonames.org/export/dump/'));
  assert.match(source.sha256, /^[a-f0-9]{64}$/);
}
// Fixed coverage gate for prefecture-level cities; county and district names retain their own identities.
const prefectures = {
  13: '石家庄 唐山 秦皇岛 邯郸 邢台 保定 张家口 承德 沧州 廊坊 衡水',
  14: '太原 大同 阳泉 长治 晋城 朔州 晋中 运城 忻州 临汾 吕梁',
  15: '呼和浩特 包头 乌海 赤峰 通辽 鄂尔多斯 呼伦贝尔 巴彦淖尔 乌兰察布',
  21: '沈阳 大连 鞍山 抚顺 本溪 丹东 锦州 营口 阜新 辽阳 盘锦 铁岭 朝阳 葫芦岛',
  22: '长春 吉林 四平 辽源 通化 白山 松原 白城',
  23: '哈尔滨 齐齐哈尔 鸡西 鹤岗 双鸭山 大庆 伊春 佳木斯 七台河 牡丹江 黑河 绥化',
  32: '南京 无锡 徐州 常州 苏州 南通 连云港 淮安 盐城 扬州 镇江 泰州 宿迁',
  33: '杭州 宁波 温州 嘉兴 湖州 绍兴 金华 衢州 舟山 台州 丽水',
  34: '合肥 芜湖 蚌埠 淮南 马鞍山 淮北 铜陵 安庆 黄山 滁州 阜阳 宿州 六安 亳州 池州 宣城',
  35: '福州 厦门 莆田 三明 泉州 漳州 南平 龙岩 宁德',
  36: '南昌 景德镇 萍乡 九江 新余 鹰潭 赣州 吉安 宜春 抚州 上饶',
  37: '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽',
  41: '郑州 开封 洛阳 平顶山 安阳 鹤壁 新乡 焦作 濮阳 许昌 漯河 三门峡 南阳 商丘 信阳 周口 驻马店',
  42: '武汉 黄石 十堰 宜昌 襄阳 鄂州 荆门 孝感 荆州 黄冈 咸宁 随州',
  43: '长沙 株洲 湘潭 衡阳 邵阳 岳阳 常德 张家界 益阳 郴州 永州 怀化 娄底',
  44: '广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮',
  45: '南宁 柳州 桂林 梧州 北海 防城港 钦州 贵港 玉林 百色 贺州 河池 来宾 崇左',
  46: '海口 三亚 三沙 儋州',
  51: '成都 自贡 攀枝花 泸州 德阳 绵阳 广元 遂宁 内江 乐山 南充 眉山 宜宾 广安 达州 雅安 巴中 资阳',
  52: '贵阳 六盘水 遵义 安顺 毕节 铜仁',
  53: '昆明 曲靖 玉溪 保山 昭通 丽江 普洱 临沧',
  54: '拉萨 日喀则 昌都 林芝 山南 那曲',
  61: '西安 铜川 宝鸡 咸阳 渭南 延安 汉中 榆林 安康 商洛',
  62: '兰州 嘉峪关 金昌 白银 天水 武威 张掖 平凉 酒泉 庆阳 定西 陇南',
  63: '西宁 海东',
  64: '银川 石嘴山 吴忠 固原 中卫',
  65: '乌鲁木齐 克拉玛依 吐鲁番 哈密',
};
let prefectureCount = 0;
for (const [province, names] of Object.entries(prefectures)) {
  for (const name of names.split(' ')) {
    assert(
      catalog.cities.some(
        city => city.country === 'CN' && city.region === `CN-${province}` && city.name === name,
      ),
      `Missing reviewed prefecture city: CN-${province}/${name}`,
    );
    prefectureCount++;
  }
}
assert.equal(prefectureCount, 293);
for (const [province, name] of [
  ['11', '北京'],
  ['12', '天津'],
  ['31', '上海'],
  ['50', '重庆'],
])
  assert(catalog.cities.some(city => city.region === `CN-${province}` && city.name === name));
console.log(
  `Geography catalogue verified: ${catalog.provinces.length} provinces, ${catalog.cities.length} places, ${prefectureCount} mainland prefecture cities, version ${catalog.version}`,
);
