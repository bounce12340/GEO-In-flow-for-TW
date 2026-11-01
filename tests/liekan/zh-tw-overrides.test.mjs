import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const roots = ['messages', 'help-messages'];
const preserved = [
  '北京日报社智源GEO',
  '猎看官网（示例数据）',
  '猎看科技',
  '向阳乔木',
  '姚金刚',
  '猎看',
];

/** Structure a Taiwan wording pass may not change: placeholders, markup, code and Latin terms. */
const shape = text => ({
  placeholders: text.match(/\{[^{}]+\}/g) || [],
  tags: (text.match(/<\/?[A-Za-z][^>]*>/g) || []).sort(),
  code: (text.match(/`[^`]*`/g) || []).sort(),
  latin: (text.match(/[A-Za-z0-9]+/g) || []).sort(),
  preserved: preserved.map(term => text.split(term).length - 1),
});

test('zh-TW overrides keep the source catalog keys, placeholders, markup and literals', () => {
  const overrides = read('config/liekan/zh-TW-overrides.json');
  const sources = {};
  for (const root of roots) Object.assign(sources, read(`src/lib/liekan/i18n/${root}/zh-CN.json`));
  for (const [key, value] of Object.entries(overrides)) {
    assert.ok(key in sources, `override without source message: ${key}`);
    assert.equal(typeof value, 'string');
    assert.ok(value.trim(), `empty override: ${key}`);
    assert.deepEqual(shape(value), shape(sources[key]), `override structure differs: ${key}`);
  }
});

test('zh-TW catalogs mirror the zh-CN source keys and placeholders exactly', () => {
  for (const root of roots) {
    const source = read(`src/lib/liekan/i18n/${root}/zh-CN.json`);
    const taiwan = read(`src/lib/liekan/i18n/${root}/zh-TW.json`);
    assert.deepEqual(Object.keys(taiwan), Object.keys(source), `${root} key order`);
    for (const [key, text] of Object.entries(source))
      assert.deepEqual(
        taiwan[key].match(/\{[^{}]+\}/g) || [],
        text.match(/\{[^{}]+\}/g) || [],
        `${root} placeholders: ${key}`,
      );
  }
});
