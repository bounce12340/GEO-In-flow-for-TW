import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Rebuild from the extracted official IANA tzdata release; no service is used at runtime.
const directory = process.argv[2];
assert(directory, 'Usage: node scripts/liekan-account-timezones.mjs <extracted-tzdata> [--check]');
const output = 'src/lib/liekan/contracts/country-timezones.json';
const names = JSON.parse(readFileSync('public/intl/country/zh-CN.json', 'utf8'));
const files = [
  'version',
  'zone.tab',
  'zone1970.tab',
  'africa',
  'antarctica',
  'asia',
  'australasia',
  'europe',
  'northamerica',
  'southamerica',
  'etcetera',
  'backward',
];
const source = Object.fromEntries(
  files.map(file => [file, readFileSync(resolve(directory, file))]),
);
const version = source.version.toString('utf8').trim();
assert.match(version, /^\d{4}[a-z]+$/);
const aliases = {};
const zones = new Set();
for (const file of files.slice(3)) {
  for (const line of source[file].toString('utf8').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] === 'Zone') zones.add(fields[1]);
    if (fields[0] === 'Link') aliases[fields[2]] = fields[1];
  }
}
const canonical = value => {
  const visited = new Set();
  while (aliases[value]) {
    assert(!visited.has(value), `Timezone alias cycle: ${value}`);
    visited.add(value);
    value = aliases[value];
  }
  assert(zones.has(value), `Missing canonical timezone: ${value}`);
  return value;
};
const countries = Object.fromEntries(
  Object.keys(names)
    .sort()
    .map(code => [code, []]),
);
for (const file of ['zone.tab', 'zone1970.tab']) {
  for (const line of source[file].toString('utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [codes, , zone] = line.split('\t');
    for (const code of codes.split(',')) {
      assert(code in countries, `Country missing from project names: ${code}`);
      const equivalent = canonical(zone);
      if (!countries[code].some(value => canonical(value) === equivalent))
        countries[code].push(zone);
    }
  }
}
const supplementalMappings = {
  BV: {
    zones: ['Etc/UTC'],
    reason: 'Explicit UTC choice for an uninhabited territory omitted by IANA tables',
  },
  HM: {
    zones: ['Etc/UTC'],
    reason: 'Explicit UTC choice for an uninhabited territory omitted by IANA tables',
  },
  XK: {
    zones: ['Europe/Belgrade'],
    reason: 'Project country code uses the shared Kosovo civil timezone',
  },
};
for (const [code, value] of Object.entries(supplementalMappings)) countries[code] = value.zones;
for (const [code, choices] of Object.entries(countries))
  assert(choices.length, `No timezone for ${code}`);
const result = {
  version,
  license: 'Public Domain',
  sourceArchive: `https://data.iana.org/time-zones/releases/tzdata${version}.tar.gz`,
  sources: files.map(file => ({
    file,
    sha256: createHash('sha256').update(source[file]).digest('hex'),
  })),
  countryCodeMappings: {},
  supplementalMappings,
  countries,
  zones: [...zones].sort(),
  aliases: Object.fromEntries(
    Object.keys(aliases)
      .sort()
      .map(key => [key, canonical(key)]),
  ),
};
const content = `${JSON.stringify(result, null, 2)}\n`;
if (process.argv.includes('--check')) assert.equal(readFileSync(output, 'utf8'), content);
else writeFileSync(output, content);
console.log(
  `Account timezone catalog ${version}: ${Object.keys(countries).length} countries/regions`,
);
