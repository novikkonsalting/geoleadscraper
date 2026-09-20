#!/usr/bin/env node
// Runs page-hook.js in a real Chromium page.
//
// The hook wraps window.fetch and XMLHttpRequest in the page's own world, so
// the thing that matters most is that it stays transparent: the page must get
// exactly the response it would have got without the hook, including on
// errors. Node cannot prove that - a browser can.
//   node tools/browser-check.mjs
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hook = readFileSync(join(root, 'extension/page-hook.js'), 'utf8');

const searchPayload = {
  stack: [{ results: { items: [
    { id: '1175665694', title: 'Штолле', address: 'Профсоюзная ул., 4', coordinates: [37.572078, 55.687149],
      categories: [{ name: 'Пекарня' }, { name: 'ресторан' }], phones: [{ value: '+74956444045' }],
      urls: ['https://msk.stolle.ru/'], ratingData: { ratingValue: 4.5, ratingCount: 1060 } },
    { id: '231950595809', title: 'Ривьера', address: 'просп. 60-летия Октября, 8А', coordinates: [37.57812, 55.700545],
      categories: [{ name: 'Ресторан' }] },
  ] } }],
};

const server = createServer((req, res) => {
  if (req.url === '/search.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(searchPayload));
  }
  if (req.url === '/boom') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('server error'); }
  if (req.url === '/image') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from([137, 80, 78, 71])); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta charset="utf-8"><title>hook test</title><body>page</body>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name} ${detail}`); }
};

// Use the Chromium that is already on the machine rather than downloading one.
const candidates = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
const { existsSync } = await import('node:fs');
const executablePath = candidates.find(existsSync);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(base);

  // Baseline: what the page sees without the hook.
  const before = await page.evaluate(async b => (await (await fetch(`${b}/search.json`)).json()).stack[0].results.items.length, base);

  await page.addScriptTag({ content: hook });

  const result = await page.evaluate(async b => {
    const seen = [];
    window.addEventListener('message', e => { if (e.data?.__glsEntities) seen.push(...e.data.__glsEntities); });
    const wait = () => new Promise(r => setTimeout(r, 150));

    const viaFetch = await (await fetch(`${b}/search.json`)).json();
    await wait();
    const afterFetch = seen.length;

    const viaXhr = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('GET', `${b}/search.json`);
      x.onload = () => resolve(JSON.parse(x.responseText));
      x.onerror = reject;
      x.send();
    });
    await wait();
    const afterXhr = seen.length;

    // A failing request and a binary response must pass through untouched.
    const failed = await fetch(`${b}/boom`).then(r => r.status);
    const binary = await fetch(`${b}/image`).then(r => r.arrayBuffer()).then(b => b.byteLength);
    let networkError = 'none';
    try { await fetch('http://127.0.0.1:1/nope'); } catch (e) { networkError = 'threw'; }
    await wait();

    return {
      fetchItems: viaFetch.stack[0].results.items.length,
      xhrItems: viaXhr.stack[0].results.items.length,
      afterFetch, afterXhr, total: seen.length,
      titles: seen.map(x => x.title), places: seen.map(x => x.place_id),
      failed, binary, networkError,
      hookReady: typeof window.__glsPageHookInstalled === 'boolean',
    };
  }, base);

  check('the page still reads its own fetch response in full',
    result.fetchItems === before && before === 2, `${result.fetchItems} vs ${before}`);
  check('the page still reads its own XHR response in full', result.xhrItems === 2, `${result.xhrItems}`);
  check('organisations are harvested from a fetch response', result.afterFetch === 2, `${result.afterFetch}`);
  check('organisations are harvested from an XHR response', result.afterXhr === 4, `${result.afterXhr}`);
  check('the harvested rows are the right ones',
    result.places.includes('1175665694') && result.titles.includes('Ривьера'), JSON.stringify(result.titles));
  check('an error response is passed through unchanged', result.failed === 500, `${result.failed}`);
  check('a binary response is passed through unchanged', result.binary === 4, `${result.binary}`);
  check('a network failure still rejects for the page', result.networkError === 'threw', result.networkError);
  check('the hook marks itself installed', result.hookReady === true);
  check('the hook raises no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // Installing twice must not double-wrap.
  await page.addScriptTag({ content: hook });
  const doubled = await page.evaluate(async b => {
    const seen = [];
    window.addEventListener('message', e => { if (e.data?.__glsEntities) seen.push(...e.data.__glsEntities); });
    await fetch(`${b}/search.json`).then(r => r.json());
    await new Promise(r => setTimeout(r, 150));
    return seen.length;
  }, base);
  check('injecting the hook twice does not double-wrap', doubled === 2, `${doubled}`);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures ? `${failures} FAILURES` : 'all browser checks passed'}`);
process.exit(failures ? 1 : 0);
