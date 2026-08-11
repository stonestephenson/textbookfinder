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
    document.getElementById('parse-text-btn').click();
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
      progressText: document.getElementById('price-progress').textContent,
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
      expect(r.panelText.includes('cheaper'), `panel: ${r.panelText.slice(0, 120)}`);
      expect(r.panelText.includes('$118.92'), 'difference $118.92 missing');
      expect(r.figureText.includes('$118.92'), `figure: ${r.figureText}`);
      expect(r.deadlineText.includes('September 4, 2026'), 'deadline missing from verdict');
    });

    await check('flow: expensive prices → stay_in verdict, plainly', async () => {
      const r = await page(pasteToVerdict([150, 120])); // buy $270 vs $210
      expect(r.panelText.includes('bundle looks like the better deal'), `panel: ${r.panelText.slice(0, 120)}`);
      expect(r.panelText.includes('$60.00'), 'saving $60.00 missing');
    });

    await check('flow: near-tie → close verdict, refuses to call a winner', async () => {
      const r = await page(pasteToVerdict([100, 95])); // buy $195, within $21 band
      expect(r.panelText.includes('close'), `panel: ${r.panelText.slice(0, 120)}`);
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

    await check('flow: unpriced items → incomplete, no premature verdict', async () => {
      const r = await page(pasteToVerdict([null, null]));
      expect(r.panelText.includes('verdict appears here'), `panel: ${r.panelText.slice(0, 120)}`);
      expect(r.pending, 'figure should stay pending');
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

    await check('flow: back / edit / restart navigation', async () => {
      const r = await page(`(async () => {
        const out = {};
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('parse-text-btn').click();
        ${sleep(250)}
        document.getElementById('back-btn').click();
        ${sleep(100)}
        out.backToInput = !document.getElementById('step-input').hidden;
        document.getElementById('parse-text-btn').click();
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
        ${sleep(700)}
        const err = document.getElementById('input-errors');
        const errShown = !err.hidden;
        const errText = err.textContent;
        // The paste path must still work after the failed upload (it hides
        // the error banner as it starts, so the state above is read first).
        document.getElementById('text-input').value = ${JSON.stringify(FIXTURE_TEXT)};
        document.getElementById('parse-text-btn').click();
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

const server = await startDevServer();
const base = `http://127.0.0.1:${server.address().port}`;
try {
  await apiContract(base);
  await browserFlows(base);
} finally {
  server.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
