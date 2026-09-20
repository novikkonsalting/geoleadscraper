#!/usr/bin/env node
// Builds extension/content/index.iife.js from the upstream vendor bundle plus
// the GeoLeadScraper Yandex module, then packs the unpacked extension.
// Run: node tools/build.mjs [--zip]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = readFileSync(join(root, 'vendor/mapscan-content.iife.js'), 'utf8');
const module_ = readFileSync(join(root, 'src/yandex-module.js'), 'utf8');
const out = join(root, 'extension/content/index.iife.js');

writeFileSync(out, vendor + module_, 'utf8');
const version = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8')).version;
console.log(`built ${out} (${vendor.length} vendor + ${module_.length} module bytes), manifest ${version}`);

if (process.argv.includes('--zip')) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) mkdirSync(dist);
  const zip = join(dist, `geoleadscraper-extension-v${version}.zip`);
  execFileSync('rm', ['-f', zip]);
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: join(root, 'extension') });
  console.log(`packed ${zip}`);
}
