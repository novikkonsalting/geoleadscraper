#!/usr/bin/env node
// Builds extension/content/index.iife.js from the upstream vendor bundle plus
// the GeoLeadScraper Yandex module, then packs the unpacked extension.
// Run: node tools/build.mjs [--zip] [--project-zip]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');

// Two bundles, each assembled as vendor code + shared record helpers + our own
// module. shared-record.js must come first in both: the content module and the
// store worker read globalThis.GLSRecord at their top level.
const targets = [
  { out: 'extension/content/index.iife.js', parts: ['vendor/mapscan-content.iife.js', 'src/shared-record.js', 'src/shared-entities.js', 'src/yandex-module.js'] },
  { out: 'extension/service-worker.js', parts: ['vendor/mapscan-service-worker.js', 'src/shared-record.js', 'src/store-worker.js'] },
  // Runs in the page's own world, injected by the content script.
  { out: 'extension/page-hook.js', parts: ['src/shared-entities.js', 'src/page-hook.js'] },
];
for (const target of targets) {
  const body = target.parts.map(read).join('\n');
  writeFileSync(join(root, target.out), body, 'utf8');
  console.log(`built ${target.out} (${body.length} bytes from ${target.parts.length} parts)`);
}
const version = JSON.parse(read('extension/manifest.json')).version;
console.log(`manifest ${version}`);

if (process.argv.includes('--project-zip')) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) mkdirSync(dist);
  const zip = join(dist, `geoleadscraper-project-v${version}.zip`);
  execFileSync('rm', ['-f', zip]);
  execFileSync('zip', ['-r', '-q', zip, '.', '-x', '.git/*', 'dist/*.zip'], { cwd: root });
  console.log(`packed ${zip}`);
}

if (process.argv.includes('--zip')) {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) mkdirSync(dist);
  const zip = join(dist, `geoleadscraper-extension-v${version}.zip`);
  execFileSync('rm', ['-f', zip]);
  execFileSync('zip', ['-r', '-q', zip, '.'], { cwd: join(root, 'extension') });
  console.log(`packed ${zip}`);
}
