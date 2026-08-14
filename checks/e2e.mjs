#!/usr/bin/env node
// End-to-end functional test: the real site served with the real api/parse.js
// handler, driven through the full user journey in headless Chrome.
//
//   node checks/e2e.mjs
//
// Covers everything that doesn't need a live API key:
//   - /api/parse contract: method/origin/size/type validation, upstream-error
//     and no-key responses (the handler runs for real; only a valid key call
//     leaves the machine, and this file never makes one)
//   - the paste → confirm → price → verdict flow, all four verdict states
//   - skip/caveat behavior, manual entry, back/edit/restart navigation
//   - graceful degradation when a capture is uploaded and no key is configured
//
// The live vision path (real screenshot → real model) is checks/parse-live.mjs.
// Exit code 0 = all pass, 1 = failures.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CHROME, launchChrome, Cdp, newPage, evalIn } from './lib/cdp.mjs';
import { startDevServer } from './dev-server.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

const FIXTURE_TEXT = [
  'BIOL 115 01',
  'Campbell Biology',
  'ISBN: 9780134093413',
  'Format: Hardcover',
  'Mastering Biology Access Card',
  'ISBN: 9780134446417',
].join('\n');
const UNITS = 10; // bundle = $210.00

// 1×1 transparent PNG — a syntactically valid capture for plumbing tests.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}\n      ${err.message.split('\n')[0]}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ── /api/parse contract ─────────────────────────────────────────────────────

async function apiContract(base) {
  const post = (body, headers = {}) => fetch(`${base}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  // With a (fake) key set: the handler's own validation runs; nothing valid
  // ever reaches the model because the key is rejected upstream.
  process.env.ANTHROPIC_API_KEY = 'e2e-fake-key-never-valid';

  await check('api: GET is rejected with 405', async () => {
    const r = await fetch(`${base}/api/parse`);
    expect(r.status === 405, `got ${r.status}`);
  });
  await check('api: empty body → 400 missing capture', async () => {
    const r = await post({});
    expect(r.status === 400, `got ${r.status}`);
    expect((await r.json()).error.includes('Missing capture'), 'wrong message');
  });
  await check('api: five images → 400 with paste-text advice', async () => {
    const img = { data: TINY_PNG, mediaType: 'image/png' };
    const r = await post({ images: [img, img, img, img, img] });
    expect(r.status === 400, `got ${r.status}`);
    expect((await r.json()).error.includes('paste'), 'should point at paste path');
  });
  await check('api: oversized images → 413', async () => {
    const r = await post({ images: [{ data: 'x'.repeat(4 * 1024 * 1024 + 1), mediaType: 'image/png' }] });
    expect(r.status === 413, `got ${r.status}`);
  });
  await check('api: oversized pdf → 413', async () => {
    const r = await post({ pdf: 'x'.repeat(4 * 1024 * 1024 + 1) });
    expect(r.status === 413, `got ${r.status}`);
  });
  await check('api: unsupported media type → 400', async () => {
    const r = await post({ images: [{ data: TINY_PNG, mediaType: 'image/tiff' }] });
    expect(r.status === 400, `got ${r.status}`);
  });
  await check('api: cross-origin POST → 403', async () => {
    const r = await post({ images: [{ data: TINY_PNG, mediaType: 'image/png' }] },
      { Origin: 'https://evil.example' });
    expect(r.status === 403, `got ${r.status}`);
  });
  await check('api: legacy single-image body accepted (bad key → clean 502)', async () => {
    const r = await post({ image: TINY_PNG, mediaType: 'image/png' });
    expect(r.status === 502, `got ${r.status}`);
    expect((await r.json()).error.includes('Paste the page text'), 'error should offer the paste fallback');
  });
  await check('api: upstream auth failure → 502 with fallback advice, not a crash', async () => {
    const r = await post({ images: [{ data: TINY_PNG, mediaType: 'image/png' }] });
    expect(r.status === 502, `got ${r.status}`);
    expect((await r.json()).error.includes('Paste the page text'), 'error should offer the paste fallback');
  });

  // Without a key: the deployment-not-configured path.
  delete process.env.ANTHROPIC_API_KEY;
  await check('api: no key configured → 503 with paste fallback', async () => {
    const r = await post({ images: [{ data: TINY_PNG, mediaType: 'image/png' }] });
    expect(r.status === 503, `got ${r.status}`);
    expect((await r.json()).error.includes('Paste the page text'), 'error should offer the paste fallback');
  });
}

async function priceApiContract(base) {
  const post = (body, headers = {}) => fetch(`${base}/api/price`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  process.env.BOOKSRUN_API_KEY = 'e2e-fake-key-never-valid';
  await check('price: GET is rejected with 405', async () => {
    const r = await fetch(`${base}/api/price`);
    expect(r.status === 405, `got ${r.status}`);
  });
  await check('price: missing/invalid ISBNs → 400', async () => {
    expect((await post({})).status === 400, 'empty body accepted');
    expect((await post({ isbns: [] })).status === 400, 'empty list accepted');
    expect((await post({ isbns: ['not-an-isbn'] })).status === 400, 'garbage ISBN accepted');
    expect((await post({ isbns: Array(21).fill('9780134093413') })).status === 400, '21 ISBNs accepted');
  });
  await check('price: cross-origin POST → 403', async () => {
    const r = await post({ isbns: ['9780134093413'] }, { Origin: 'https://evil.example' });
    expect(r.status === 403, `got ${r.status}`);
  });
  await check('price: upstream key rejection → 200 with null offers, not a crash', async () => {
    const r = await post({ isbns: ['9780134093413'] });
    expect(r.status === 200, `got ${r.status}`);
    const body = await r.json();
    expect(body.offers['9780134093413'] === null, 'expected null offer');
  });

  delete process.env.BOOKSRUN_API_KEY;
  await check('price: no key configured → 503', async () => {
    const r = await post({ isbns: ['9780134093413'] });
    expect(r.status === 503, `got ${r.status}`);
  });
}

async function resolveApiContract(base) {
  const post = (body, headers = {}) => fetch(`${base}/api/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  await check('resolve: GET is rejected with 405', async () => {
    const r = await fetch(`${base}/api/resolve`);
    expect(r.status === 405, `got ${r.status}`);
  });
  await check('resolve: malformed bodies → 400', async () => {
    expect((await post({})).status === 400, 'empty body accepted');
    expect((await post({ items: [] })).status === 400, 'empty list accepted');
    expect((await post({ items: Array(11).fill({ title: 'x', author: 'y' }) })).status === 400, '11 items accepted');
    expect((await post({ items: ['not-an-object'] })).status === 400, 'string entry accepted');
  });
  await check('resolve: cross-origin POST → 403', async () => {
    const r = await post({ items: [{ title: 'x', author: 'y' }] }, { Origin: 'https://evil.example' });
    expect(r.status === 403, `got ${r.status}`);
  });
  await check('resolve: authorless items resolve to null without an upstream call', async () => {
    const r = await post({ items: [{ title: 'Some Book With No Author' }] });
    expect(r.status === 200, `got ${r.status}`);
    const body = await r.json();
    expect(Array.isArray(body.resolved) && body.resolved[0] === null, 'expected [null]');
  });
}

// ── Browser flow ────────────────────────────────────────────────────────────

const sleep = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;

function pasteToVerdict(prices /* array of numbers|null, or 'skip' */) {
  const priceLines = prices.map((p, i) => {
    if (p === 'skip') {
      return `document.querySelector('[data-skip-idx="${i}"]').click();`;
    }
    if (p == null) return '';
    return `{
      const el = document.querySelector('[data-price-idx="${i}"]');
      el.value = '${p}';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }`;
  }).join('\n');
  return `(async () => {
    document.getElementById('units-input').value = '${UNITS}';
    document.getElementById('units-input').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
    document.getElementById('go-btn').click();
    ${sleep(250)}
    const confirm = {
      visible: !document.getElementById('step-confirm').hidden,
      titles: [...document.querySelectorAll('#items-list input[data-field="title"]')].map((i) => i.value),
      accessFlags: document.querySelectorAll('#items-list [data-audit="access-flag"]').length,
    };
    document.getElementById('confirm-btn').click();
    ${sleep(250)}
    ${priceLines}
    ${sleep(250)}
    return {
      confirm,
      verdictVisible: !document.getElementById('step-verdict').hidden,
      panelText: document.getElementById('verdict-panel').textContent.replace(/\\s+/g, ' '),
      figureText: document.querySelector('[data-audit="verdict-figure"]')?.textContent.trim() ?? '',
      pending: Boolean(document.querySelector('.fig-pending')),
      deadlineText: document.getElementById('deadline-note').textContent,
    };
  })()`;
}

async function browserFlows(base) {
  const { proc, wsUrl } = await launchChrome();
  const cdp = await Cdp.connect(wsUrl);
  try {
    const page = async (expr) => {
      const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
      const value = await evalIn(cdp, sessionId, expr);
      await cdp.send('Target.closeTarget', { targetId });
      return value;
    };

    await check('flow: boot lands on input step with live bill figure', async () => {
      const r = await page(`(async () => { ${sleep(200)} return {
        step: document.body.dataset.step,
        bill: document.getElementById('bill-amount').textContent,
      }; })()`);
      expect(r.step === 'input', `step=${r.step}`);
      expect(r.bill === '$315.00', `bill=${r.bill} (15 units default)`);
    });

    await check('flow: paste → confirm shows both items, flags the access code', async () => {
      const r = await page(pasteToVerdict([11.08, 80]));
      expect(r.confirm.visible, 'confirm step not shown');
      expect(r.confirm.titles.length === 2, `parsed ${r.confirm.titles.length} items`);
      expect(r.confirm.titles[0] === 'Campbell Biology', `title[0]=${r.confirm.titles[0]}`);
      expect(r.confirm.accessFlags >= 1, 'access-code flag missing on confirm');
    });

    await check('flow: cheap prices → opt_out verdict with exact difference', async () => {
      const r = await page(pasteToVerdict([11.08, 80])); // buy $91.08 vs $210
      expect(r.verdictVisible, 'verdict step not shown');
      expect(r.figureText === 'No.', `answer word: ${r.figureText}`);
      expect(r.panelText.includes('keeps $118.92 in your pocket'), `panel: ${r.panelText.slice(0, 140)}`);
      expect(r.panelText.includes('$118.92'), 'difference $118.92 missing');
      expect(r.deadlineText.includes('September 4, 2026'), 'deadline missing from verdict');
    });

    await check('flow: expensive prices → stay_in verdict, plainly', async () => {
      const r = await page(pasteToVerdict([150, 120])); // buy $270 vs $210
      expect(r.figureText === 'Yes.', `answer word: ${r.figureText}`);
      expect(r.panelText.includes('better deal for your cart'), `panel: ${r.panelText.slice(0, 140)}`);
      expect(r.panelText.includes('$60.00'), 'saving $60.00 missing');
    });

    await check('flow: near-tie → close verdict, refuses to call a winner', async () => {
      const r = await page(pasteToVerdict([100, 95])); // buy $195, within $21 band
      expect(r.figureText === 'Close.', `answer word: ${r.figureText}`);
      expect(r.panelText.includes('$21.00'), 'band size missing');
    });

    await check('flow: one item skipped → verdict carries the caveat', async () => {
      const r = await page(pasteToVerdict([11.08, 'skip'])); // $210 − $11.08 on 1 of 2
      expect(r.panelText.includes('$198.92'), 'difference on priced items missing');
      expect(r.panelText.includes('Caveat'), 'skip caveat missing');
      expect(r.panelText.includes('find it'), 'receipt should mark the skipped item');
    });

    await check('flow: all items skipped → no verdict is invented', async () => {
      const r = await page(pasteToVerdict(['skip', 'skip']));
      expect(r.panelText.includes('nothing to compare'), `panel: ${r.panelText.slice(0, 120)}`);
      expect(r.pending, 'figure should stay pending, not show a number');
    });

    await check('flow: unpriced items → incomplete with break-even guidance', async () => {
      const r = await page(pasteToVerdict([null, null]));
      expect(r.panelText.includes('still need a price'), `panel: ${r.panelText.slice(0, 120)}`);
      expect(r.panelText.includes('cost more than $231.00'), 'break-even should include the close band');
      expect(r.pending, 'figure should stay pending');
    });

    await check('flow: an access code links to its publisher, not book marketplaces', async () => {
      const r = await page(`(async () => {
        document.getElementById('units-input').value = '3';
        document.getElementById('units-input').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('text-input').value = 'CS 315 01\\nzyBooks: Data Structures and Algorithms\\nFormat: Access code';
        document.getElementById('go-btn').click();
        ${sleep(300)}
        document.getElementById('confirm-btn').click();
        ${sleep(400)}
        return {
          accessFlags: document.querySelectorAll('.v-item [data-audit="access-flag"]').length,
          links: [...document.querySelectorAll('.retailer-links a')].map((a) => a.href),
        };
      })()`);
      expect(r.accessFlags >= 1, 'zyBooks item not flagged as an access code');
      expect(r.links.some((h) => h.includes('zybooks.com')), `links: ${r.links.join(', ')}`);
      expect(!r.links.some((h) => h.includes('amazon')), 'an access code must not link to Amazon');
    });

    await check('flow: manual entry opens an editable empty item', async () => {
      const r = await page(`(async () => {
        document.getElementById('manual-entry-link').click();
        ${sleep(250)}
        const before = document.querySelectorAll('#items-list input[data-field="title"]').length;
        document.getElementById('add-item-btn').click();
        ${sleep(150)}
        return {
          visible: !document.getElementById('step-confirm').hidden,
          before,
          after: document.querySelectorAll('#items-list input[data-field="title"]').length,
        };
      })()`);
      expect(r.visible, 'confirm step not shown');
      expect(r.before === 1 && r.after === 2, `items ${r.before}→${r.after}`);
    });

    await check('flow: empty cart is a real result, answered plainly', async () => {
      const r = await page(`(async () => {
        document.getElementById('manual-entry-link').click();
        ${sleep(200)}
        document.querySelector('[data-remove="0"]').click();
        ${sleep(150)}
        document.getElementById('confirm-btn').click();
        ${sleep(250)}
        return {
          word: document.querySelector('[data-audit="verdict-figure"]')?.textContent.trim(),
          panelText: document.getElementById('verdict-panel').textContent.replace(/\\s+/g, ' '),
        };
      })()`);
      expect(r.word === 'No.', `answer word: ${r.word}`);
      expect(r.panelText.includes('nothing included'), `panel: ${r.panelText.slice(0, 120)}`);
    });

    await check('flow: invalid units on confirm are rejected, not computed', async () => {
      const r = await page(`(async () => {
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('go-btn').click();
        ${sleep(250)}
        const u = document.getElementById('confirm-units-input');
        u.value = '99';
        u.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('confirm-btn').click();
        ${sleep(200)}
        return {
          stillOnConfirm: !document.getElementById('step-confirm').hidden,
          err: document.getElementById('confirm-errors').textContent,
        };
      })()`);
      expect(r.stillOnConfirm, 'moved on despite invalid units');
      expect(r.err.includes('between 1 and'), `error was: ${r.err}`);
    });

    await check('trust page: why.html serves with the sourced content', async () => {
      const r = await fetch(`${base}/why.html`);
      expect(r.status === 200, `got ${r.status}`);
      const body = await r.text();
      expect(body.includes('PRA%202026-495.pdf'), 'contract link missing');
      expect(body.includes('average price across all courses'), 'contract quote missing');
    });

    await check('flow: back / edit / restart navigation', async () => {
      const r = await page(`(async () => {
        const out = {};
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('go-btn').click();
        ${sleep(250)}
        document.getElementById('back-btn').click();
        ${sleep(100)}
        out.backToInput = !document.getElementById('step-input').hidden;
        document.getElementById('go-btn').click();
        ${sleep(250)}
        document.getElementById('confirm-btn').click();
        ${sleep(250)}
        document.getElementById('edit-items-btn').click();
        ${sleep(100)}
        out.editToConfirm = !document.getElementById('step-confirm').hidden;
        document.getElementById('confirm-btn').click();
        ${sleep(250)}
        document.getElementById('restart-btn').click();
        ${sleep(100)}
        out.restartToInput = !document.getElementById('step-input').hidden;
        return out;
      })()`);
      expect(r.backToInput, 'Back did not return to input');
      expect(r.editToConfirm, 'Edit my items did not return to confirm');
      expect(r.restartToInput, 'Start over did not return to input');
    });

    await check('flow: auto-filled offer lands on the receipt, and "change" overrides it', async () => {
      // Intercept /api/price in the browser and answer with a fixed offer, so
      // the auto-fill UI is tested deterministically and offline.
      const mock = {
        source: 'BooksRun',
        fetchedAt: '2026-08-11T00:00:00.000Z',
        offers: {
          9780134093413: {
            total: 48.99, price: 44.0, shipping: 4.99, kind: 'used', rentDays: null,
            seller: 'Walker Bookstore', condition: 'VeryGood', url: 'https://booksrun.com/user/buy/cart/add/0134093413-11-1',
          },
          // A USED offer for an access card: the client must refuse it — a
          // used code is usually consumed. The item must stay manual.
          9780134446417: {
            total: 12.5, price: 8.51, shipping: 3.99, kind: 'used', rentDays: null,
            seller: 'SketchySeller', condition: 'Good', url: 'https://booksrun.com/9780134446417',
          },
        },
      };
      const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
      await cdp.send('Fetch.enable', {
        patterns: [{ urlPattern: '*/api/price', requestStage: 'Request' }],
      }, sessionId);
      const paused = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, `(async () => {
        document.getElementById('units-input').value = '${UNITS}';
        document.getElementById('units-input').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('go-btn').click();
        ${sleep(250)}
        document.getElementById('confirm-btn').click();
        return true;
      })()`);
      const { requestId } = await paused;
      await cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(mock)).toString('base64'),
      }, sessionId);
      await new Promise((r) => setTimeout(r, 500));
      const r1 = await evalIn(cdp, sessionId, `({
        panelText: document.getElementById('verdict-panel').textContent.replace(/\\s+/g, ' '),
        foundText: [...document.querySelectorAll('.price-found')].map((el) => el.textContent.replace(/\\s+/g, ' ')).join(' | '),
        offerLink: document.querySelector('.price-found a')?.href ?? '',
        manualVisible: [...document.querySelectorAll('.price-manual')].map((el) => !el.hidden),
      })`);
      expect(r1.foundText.includes('$48.99'), `found: ${r1.foundText}`);
      expect(r1.foundText.includes('Walker Bookstore'), 'offer provenance missing');
      expect(r1.offerLink === 'https://booksrun.com/9780134093413-campbell-biology', `link: ${r1.offerLink}`);
      expect(!r1.offerLink.includes('afk'), 'affiliate parameter leaked into UI');
      expect(r1.panelText.includes('$48.99'), 'receipt missing the fetched price');
      expect(r1.panelText.includes('cost more than $182.01'), `break-even wrong: ${r1.panelText.slice(0, 160)}`);
      expect(!r1.foundText.includes('$12.50'), 'used offer must be refused for an access code');
      expect(r1.manualVisible.filter(Boolean).length === 1, 'refused-offer item should offer manual entry, found one should not');

      const r2 = await evalIn(cdp, sessionId, `(async () => {
        document.querySelector('[data-edit-idx]').click();
        ${sleep(100)}
        const input = document.querySelector('[data-price-idx="0"]');
        const prefilled = input.value;
        input.value = '500';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        ${sleep(200)}
        return {
          prefilled,
          panelText: document.getElementById('verdict-panel').textContent.replace(/\\s+/g, ' '),
        };
      })()`);
      expect(r2.prefilled === '48.99', `input should be prefilled with the offer, got ${r2.prefilled}`);
      expect(r2.panelText.includes('better deal for your cart'), 'user override should drive an early stay_in');
      const rows = await evalIn(cdp, sessionId, "document.querySelectorAll('.v-item')[0].querySelectorAll('.retailer-links').length");
      expect(rows === 1, `retailer link rows after change: ${rows}`);
      await cdp.send('Target.closeTarget', { targetId });
    });

    await check('flow: ISBN-less portal item resolves on confirm and prices on the verdict', async () => {
      const PORTAL_TEXT = ['INCLUDED', 'Physical Item', 'INTRO.TO THEORY OF COMPUTATION (PB)', 'REQUIRED', '',
        'INTRO.TO THEORY OF COMPUTATION (PB)', 'by SIPSER | Edition: 3RD 13'].join('\n');
      const resolveMock = {
        source: 'OpenLibrary',
        resolved: [{ isbn: '9781133187790', isbn13s: ['9781133187790'], title: 'Introduction to the theory of computation', author: 'Michael Sipser', year: 2013 }],
      };
      const priceMock = {
        source: 'BooksRun',
        fetchedAt: '2026-08-12T00:00:00.000Z',
        offers: {
          9781133187790: {
            total: 41.89, price: 41.89, shipping: 0, kind: 'used', rentDays: null,
            seller: null, condition: null, url: 'https://booksrun.com/9781133187790',
          },
        },
      };
      const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
      await cdp.send('Fetch.enable', {
        patterns: [{ urlPattern: '*/api/resolve', requestStage: 'Request' }, { urlPattern: '*/api/price', requestStage: 'Request' }],
      }, sessionId);
      const fulfill = (requestId, body) => cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      }, sessionId);

      const pausedResolve = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, `(async () => {
        document.getElementById('text-input').value = ${JSON.stringify(PORTAL_TEXT)};
        document.getElementById('go-btn').click();
        return true;
      })()`);
      await fulfill((await pausedResolve).requestId, resolveMock);
      await new Promise((r) => setTimeout(r, 400));
      const confirm = await evalIn(cdp, sessionId, `({
        itemsText: document.getElementById('items-list').textContent.replace(/\\s+/g, ' ').trim(),
        isbnValue: document.querySelector('#items-list input[data-field="isbn"]')?.value ?? '',
      })`);
      expect(confirm.itemsText.includes('Matched to Introduction to the theory of computation'), `confirm: ${confirm.itemsText.slice(0, 160)}`);
      expect(confirm.isbnValue === '9781133187790', `isbn field: ${confirm.isbnValue}`);

      const pausedPrice = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, "document.getElementById('confirm-btn').click(); true");
      await fulfill((await pausedPrice).requestId, priceMock);
      await new Promise((r) => setTimeout(r, 500));
      const verdict = await evalIn(cdp, sessionId, `({
        foundText: [...document.querySelectorAll('.price-found')].map((el) => el.textContent.replace(/\\s+/g, ' ')).join(' | '),
        panelText: document.getElementById('verdict-panel').textContent.replace(/\\s+/g, ' '),
      })`);
      expect(verdict.foundText.includes('$41.89'), `found: ${verdict.foundText}`);
      expect(verdict.panelText.includes('$41.89'), 'receipt missing the resolved-then-priced amount');
      await cdp.send('Target.closeTarget', { targetId });
    });

    await check('flow: failed resolution offers a retry button that succeeds and prices', async () => {
      const PORTAL_TEXT = ['INCLUDED', 'Physical Item', 'INTRO.TO THEORY OF COMPUTATION (PB)', 'REQUIRED', '',
        'INTRO.TO THEORY OF COMPUTATION (PB)', 'by SIPSER | Edition: 3RD 13'].join('\n');
      const nullResolve = { source: 'OpenLibrary', resolved: [null] };
      const goodResolve = {
        source: 'OpenLibrary',
        resolved: [{ isbn: '9781133187790', isbn13s: ['9781133187790'], title: 'Introduction to the theory of computation', author: 'Michael Sipser', year: 2013 }],
      };
      const priceMock = {
        source: 'BooksRun',
        fetchedAt: '2026-08-13T00:00:00.000Z',
        offers: { 9781133187790: { total: 41.89, price: 41.89, shipping: 0, kind: 'used', rentDays: null, seller: null, condition: null, url: 'https://booksrun.com/9781133187790' } },
      };
      const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
      await cdp.send('Fetch.enable', {
        patterns: [{ urlPattern: '*/api/resolve', requestStage: 'Request' }, { urlPattern: '*/api/price', requestStage: 'Request' }],
      }, sessionId);
      const fulfill = (requestId, body) => cdp.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body)).toString('base64'),
      }, sessionId);

      // Attempt 1 fails; the automatic retry (2s later) fails too.
      let paused = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, `(async () => {
        document.getElementById('text-input').value = ${JSON.stringify(PORTAL_TEXT)};
        document.getElementById('go-btn').click();
        return true;
      })()`);
      await fulfill((await paused).requestId, nullResolve);
      paused = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, "document.getElementById('confirm-btn').click(); true");
      await fulfill((await paused).requestId, nullResolve); // the auto-retry
      await new Promise((r) => setTimeout(r, 600));
      const failed = await evalIn(cdp, sessionId, `({
        hint: [...document.querySelectorAll('.price-manual p')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()).join(' | '),
        hasRetry: Boolean(document.querySelector('[data-relookup]')),
      })`);
      expect(failed.hasRetry, `no retry button; hint was: ${failed.hint.slice(0, 140)}`);

      // The tap: resolution succeeds, pricing follows.
      paused = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await evalIn(cdp, sessionId, "document.querySelector('[data-relookup]').click(); true");
      await fulfill((await paused).requestId, goodResolve);
      paused = cdp.waitEvent('Fetch.requestPaused', sessionId, 15000);
      await fulfill((await paused).requestId, priceMock);
      await new Promise((r) => setTimeout(r, 600));
      const done = await evalIn(cdp, sessionId, `({
        foundText: [...document.querySelectorAll('.price-found')].map((el) => el.textContent.replace(/\\s+/g, ' ')).join(' | '),
      })`);
      expect(done.foundText.includes('$41.89'), `found: ${done.foundText}`);
      await cdp.send('Target.closeTarget', { targetId });
    });

    await check('flow: uploading a capture with no key shows the paste fallback, site keeps working', async () => {
      const pngPath = path.join(ROOT, 'checks/results', 'e2e-tiny.png');
      await mkdir(path.dirname(pngPath), { recursive: true });
      await writeFile(pngPath, Buffer.from(TINY_PNG, 'base64'));

      const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
      await cdp.send('DOM.enable', {}, sessionId);
      const { root } = await cdp.send('DOM.getDocument', {}, sessionId);
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId, selector: '#file-input',
      }, sessionId);
      await cdp.send('DOM.setFileInputFiles', { files: [pngPath], nodeId }, sessionId);
      const r = await evalIn(cdp, sessionId, `(async () => {
        // CDP sets the file list without firing events; nudge the app's listener.
        document.getElementById('file-input').dispatchEvent(new Event('change', { bubbles: true }));
        ${sleep(150)}
        document.getElementById('go-btn').click();
        ${sleep(700)}
        const err = document.getElementById('input-errors');
        const errShown = !err.hidden;
        const errText = err.textContent;
        // The paste path must still work after the failed upload (it hides
        // the error banner as it starts, so the state above is read first).
        // Staged files stick around after a failure and outrank pasted text,
        // so clear them the way a user would.
        document.getElementById('clear-staged')?.click();
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('go-btn').click();
        ${sleep(250)}
        return {
          errShown,
          errText,
          confirmVisible: !document.getElementById('step-confirm').hidden,
        };
      })()`);
      await cdp.send('Target.closeTarget', { targetId });
      expect(r.errShown, 'no error message surfaced');
      expect(r.errText.includes('Paste the page text'), `error was: ${r.errText}`);
      expect(r.confirmVisible, 'paste path broken after failed upload');
    });
  } finally {
    proc.kill();
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

if (!CHROME) {
  console.error('No Chrome/Chromium found — browser flow tests need one.');
  process.exit(2);
}
delete process.env.ANTHROPIC_API_KEY; // this file never makes a live model call
delete process.env.BOOKSRUN_API_KEY; // nor a live price lookup

const server = await startDevServer();
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await apiContract(base);
  await priceApiContract(base);
  await resolveApiContract(base);
  await browserFlows(base);
} finally {
  server.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
