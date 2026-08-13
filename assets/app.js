// Flow state machine: input → confirm → verdict.
// Confirmation is mandatory — nothing is computed until the user says the
// parsed list matches their cart. All copy speaks about "your cart" and
// "prices you entered"; the tool never claims to know what a course requires.

import { config } from './config.js';
import { parseText } from './parse-text.js';
import { computeVerdict } from './verdict.js';
import './bind.js'; // config values + verified links into static copy

const state = {
  step: 'input',
  items: [],
  units: null,
  warnings: [],
  // Price auto-fill: 'idle' | 'loading' | 'done' | 'unavailable'. fetchSeq
  // invalidates an in-flight lookup when the user leaves or edits the list.
  priceFetch: 'idle',
  fetchSeq: 0,
};

let nextManualId = 1;

// The last valid hero units value. Falls back to 15, the default full load.
let heroUnits = 15;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmt = (n) => `$${n.toFixed(2)}`;
const isbnish = (s) => /^(\d{13}|\d{9}[\dXx])$/.test((s ?? '').replace(/[-\s]/g, ''));

const FORMAT_LABELS = {
  physical: 'Physical book',
  digital: 'Digital / eText',
  access_code: 'Access code / courseware',
  unknown: 'Not sure',
};

function accessRe() {
  const escaped = (config.accessCodePatterns ?? [])
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

function recomputeAccessFlag(item) {
  item.isAccessCode = item.format === 'access_code' || accessRe().test(item.title ?? '');
}

function emptyItem() {
  return {
    id: `manual-${nextManualId++}`,
    courseCode: null,
    title: '',
    format: 'unknown',
    isbn: null,
    author: null,
    edition: null,
    resolved: null, // ISBN found by title+author match: { title, author, year }
    isAccessCode: false,
    userPrice: null,
    priceSource: null, // 'auto' (fetched offer) | 'capture' (listed in upload) | 'user'
    offer: null, //  metadata of a fetched offer: kind, seller, rentDays, url, fetchedAt
    listedPrice: null, // price printed in the user's own capture, if any
    skipped: false,
    confidence: { courseCode: 'high', title: 'high', format: 'high', isbn: 'high', listedPrice: 'high' },
  };
}

// Normalize items from any parse source (server vision, client text parser)
// into the one shape the rest of the app trusts.
function adoptItems(rawItems) {
  return (rawItems ?? []).map((r, i) => {
    const item = {
      id: r.id ?? `parsed-${i}`,
      courseCode: r.courseCode ?? null,
      title: r.title ?? '',
      format: ['physical', 'digital', 'access_code', 'unknown'].includes(r.format) ? r.format : 'unknown',
      isbn: r.isbn ?? null,
      author: typeof r.author === 'string' && r.author.trim() ? r.author.trim() : null,
      edition: typeof r.edition === 'string' && r.edition.trim() ? r.edition.trim() : null,
      resolved: null,
      isAccessCode: false,
      userPrice: null,
      priceSource: null,
      offer: null,
      // Strictly positive: a printed "$0.00" or "included" is bundle framing,
      // not a price, and zero here would fake a cheap buy side.
      listedPrice: Number.isFinite(r.listedPrice) && r.listedPrice > 0 && r.listedPrice <= 99999
        ? Math.round(r.listedPrice * 100) / 100 : null,
      skipped: false,
      confidence: {
        courseCode: r.confidence?.courseCode === 'high' ? 'high' : 'low',
        title: r.confidence?.title === 'high' ? 'high' : 'low',
        format: r.confidence?.format === 'high' ? 'high' : 'low',
        isbn: r.confidence?.isbn === 'high' ? 'high' : 'low',
        listedPrice: r.confidence?.listedPrice === 'high' ? 'high' : 'low',
      },
    };
    recomputeAccessFlag(item);
    return item;
  });
}

const STEP_ORDER = ['input', 'confirm', 'verdict'];

function showStep(step) {
  state.step = step;
  document.body.dataset.step = step;
  $('step-input').hidden = step !== 'input';
  $('step-confirm').hidden = step !== 'confirm';
  $('step-verdict').hidden = step !== 'verdict';
  document.querySelectorAll('.stepper .snode').forEach((n) => {
    const i = STEP_ORDER.indexOf(n.dataset.step);
    n.classList.toggle('active', n.dataset.step === step);
    n.classList.toggle('done', i > -1 && i < STEP_ORDER.indexOf(step));
  });
  // Re-trigger the entrance animation on the newly shown card.
  const shown = $(`step-${step}`);
  if (shown) {
    shown.classList.remove('step-enter');
    void shown.offsetWidth; // restart the CSS animation
    shown.classList.add('step-enter');
  }
  if (step !== 'input') $('tool').scrollIntoView?.({ behavior: 'smooth' });
}

// On arrival at the confirm screen, put the cursor where correction is
// wanted: the first field the parser wasn't sure about, or the first empty
// title when entering by hand. The trust surface should invite the edit.
function focusFirstUncertain() {
  requestAnimationFrame(() => {
    const target = document.querySelector('#items-list .field.low-confidence input, #items-list .field.low-confidence select')
      ?? [...document.querySelectorAll('#items-list input[data-field="title"]')].find((i) => !i.value);
    target?.focus();
  });
}

function showInputError(msg) {
  const el = $('input-errors');
  el.textContent = msg;
  el.hidden = false;
}

function readUnits() {
  const v = Number($('units-input').value);
  if (Number.isFinite(v) && v >= 1 && v <= config.maxUnits) return v;
  return null;
}

// ── Input step ──────────────────────────────────────────────────────────────

function setParseBusy(busy, msg = '') {
  const el = $('parse-status');
  el.hidden = !busy && !msg;
  el.textContent = busy ? 'Reading your capture…' : msg;
}

// Downscale/re-encode large images before upload: the parse endpoint accepts
// ~3MB, and detail beyond ~2000px on the long edge doesn't improve parsing.
async function prepareImage(file) {
  const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });

  const MAX_EDGE = 2000;
  const MAX_BYTES = 2_500_000;
  try {
    const bitmap = await createImageBitmap(file);
    const crop = (sy, sh) => {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(sh * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    };

    // A scrolling/full-page capture downscaled whole becomes unreadable —
    // slice very tall images into overlapping segments at full legibility.
    const sliceH = bitmap.width * 2;
    if (bitmap.height > sliceH * 1.4 && bitmap.height > 2200) {
      const n = Math.min(4, Math.ceil(bitmap.height / sliceH));
      const h = Math.ceil(bitmap.height / n);
      const overlap = Math.round(h * 0.06); // items cut at a seam appear in both
      const parts = [];
      for (let i = 0; i < n; i += 1) {
        const sy = Math.max(0, i * h - overlap);
        parts.push(crop(sy, Math.min(h + overlap, bitmap.height - sy)));
      }
      bitmap.close?.();
      return parts;
    }

    if (file.size <= MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) {
      bitmap.close?.();
      return [await readAsDataUrl(file)];
    }
    const part = crop(0, bitmap.height);
    bitmap.close?.();
    return [part];
  } catch {
    return [await readAsDataUrl(file)];
  }
}

const MAX_PARTS = 4;

// Captures stage in the drop zone until the user hits "Get my answer" — one
// visible action, exactly the flow on the tin. Images accumulate (multi-
// screenshot carts); a full-page PDF stands alone.
let stagedFiles = [];

function renderStaged() {
  const el = $('staged');
  if (stagedFiles.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const pdf = stagedFiles.some((f) => f.type === 'application/pdf');
  const label = pdf ? 'Full-page PDF added'
    : `${stagedFiles.length} screenshot${stagedFiles.length > 1 ? 's' : ''} added`;
  el.innerHTML = `<strong>&#10003; ${label}.</strong> Add more, or
    <button type="button" class="linkish" id="clear-staged">clear</button>`;
  el.hidden = false;
}

function stageFiles(fileList) {
  $('input-errors').hidden = true;
  const files = [...fileList].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (files.length === 0) {
    showInputError('Those files aren’t screenshots. Add images (PNG or JPG) or a full-page PDF capture, or paste text instead.');
    return;
  }
  const pdf = files.find((f) => f.type === 'application/pdf');
  stagedFiles = pdf ? [pdf] : [...stagedFiles.filter((f) => f.type !== 'application/pdf'), ...files];
  renderStaged();
}

async function handleCaptureFiles(fileList) {
  $('input-errors').hidden = true;
  if (!config.parseEndpoint) {
    showInputError('Screenshot parsing isn’t enabled on this deployment. '
      + 'Paste the page text instead, or enter your items by hand. Both work fully in your browser.');
    return;
  }

  const files = [...fileList];
  const pdf = files.find((f) => f.type === 'application/pdf');
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!pdf && images.length === 0) {
    showInputError('Those files aren’t screenshots. Drop images (PNG or JPG) or a full-page PDF capture, or paste text instead.');
    return;
  }
  if (files.some((f) => f.size > 8 * 1024 * 1024)) {
    showInputError('One of those files is over 8 MB. Try normal screenshots rather than photos, or paste the text instead.');
    return;
  }

  setParseBusy(true);
  try {
    let payload;
    if (pdf) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(pdf);
      });
      payload = { pdf: dataUrl.split(',')[1] };
    } else {
      const parts = (await Promise.all(images.map(prepareImage))).flat();
      if (parts.length > MAX_PARTS) {
        showInputError(`That’s more than ${MAX_PARTS} screenshots’ worth of image. `
          + 'For a list that long, select everything on the page, copy it, and use “Paste the page text” below. It captures everything at once.');
        return;
      }
      payload = {
        images: parts.map((dataUrl) => {
          const [, mediaType, data] = dataUrl.match(/^data:([^;]+);base64,(.+)$/) ?? [];
          return { data, mediaType };
        }),
      };
      if (payload.images.some((p) => !p.data)) throw new Error('encode failed');
    }

    const res = await fetch(config.parseEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body) {
      showInputError(body?.error
        ?? 'The screenshot reader is unavailable right now. Paste the page text instead. That works entirely in your browser.');
      return;
    }
    if (body.wrongPage) {
      showInputError('That capture doesn’t look like a course materials page. '
        + 'Open your bookstore’s My Course Materials page (the list of what’s included for your classes) and capture that.');
      return;
    }
    const items = adoptItems(body.items);
    if (items.length === 0) {
      showInputError('Couldn’t find any course materials in that capture. '
        + 'Try a tighter screenshot of the materials list, paste the text, or enter items by hand.');
      return;
    }
    state.items = items;
    state.warnings = body.warnings ?? [];
    state.units = readUnits() ?? state.units;
    stagedFiles = [];
    renderStaged();
    renderConfirm();
    showStep('confirm');
    focusFirstUncertain();
    resolveMissingIsbns();
  } catch {
    showInputError('Couldn’t read that capture. Paste the page text instead. That works entirely in your browser.');
  } finally {
    setParseBusy(false);
  }
}

function handlePastedText() {
  $('input-errors').hidden = true;
  const raw = $('text-input').value;
  const { items, warnings } = parseText(raw, config);
  if (items.length === 0) {
    showInputError(warnings[0] ?? 'Couldn’t read anything from that text. You can enter your items by hand instead.');
    return;
  }
  state.items = adoptItems(items);
  state.warnings = warnings;
  state.units = readUnits() ?? state.units;
  renderConfirm();
  showStep('confirm');
  focusFirstUncertain();
  resolveMissingIsbns();
}

function wireInputStep() {
  const dropZone = $('drop-zone');
  const fileInput = $('file-input');

  $('file-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) stageFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragover', 'dragenter'].forEach((t) => dropZone.addEventListener(t, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((t) => dropZone.addEventListener(t, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files?.length) stageFiles(files);
  });
  $('staged').addEventListener('click', (e) => {
    if (e.target.id === 'clear-staged') {
      e.stopPropagation(); // don't open the file picker on clear
      stagedFiles = [];
      renderStaged();
    }
  });

  document.addEventListener('paste', (e) => {
    if (state.step !== 'input') return;
    if (e.target === $('text-input')) return;
    const file = [...(e.clipboardData?.items ?? [])]
      .find((it) => it.type.startsWith('image/'))?.getAsFile();
    if (file) stageFiles([file]);
  });

  // The one submit. Captures win if both are present.
  $('go-btn').addEventListener('click', () => {
    if (stagedFiles.length > 0) {
      handleCaptureFiles(stagedFiles);
      return;
    }
    if ($('text-input').value.trim()) {
      handlePastedText();
      return;
    }
    showInputError('Add your cart first: drop a screenshot of your course materials page, or paste its text.');
  });

  // Tiny links open the alternates; the page starts with none of them showing.
  const wireToggle = (linkId, panelId, focusSel) => {
    const link = $(linkId);
    link.setAttribute('aria-expanded', 'false');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const panel = $(panelId);
      panel.hidden = !panel.hidden;
      link.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden && focusSel) panel.querySelector(focusSel)?.focus();
    });
  };
  wireToggle('paste-toggle', 'text-details', 'textarea');
  wireToggle('long-list-toggle', 'capture-alternatives');

  $('manual-entry-link').addEventListener('click', (e) => {
    e.preventDefault();
    state.items = [emptyItem()];
    state.warnings = [];
    state.units = readUnits() ?? state.units;
    renderConfirm();
    showStep('confirm');
    focusFirstUncertain();
  });
}

// ── Confirm step ────────────────────────────────────────────────────────────

function fieldHtml(item, idx, field, label, value, extra = '') {
  const low = item.confidence[field] === 'low';
  const id = `f-${idx}-${field}`;
  // When a field is flagged uncertain, the flag replaces the label's
  // parenthetical: "optional" next to "check this" reads as contradictory.
  const shownLabel = low ? label.replace(/\s*\(.*\)$/, '') : label;
  return `
    <div class="field ${low ? 'low-confidence' : ''}">
      <label for="${id}">${shownLabel}${low ? ' <span class="check-hint">(check this, the tool wasn’t sure)</span>' : ''}</label>
      <input type="text" id="${id}" data-idx="${idx}" data-field="${field}" value="${esc(value ?? '')}" ${extra}>
    </div>`;
}

function renderConfirm() {
  const list = $('items-list');

  const warningsHtml = state.warnings
    .map((w) => `<div class="notice notice-warn">${esc(w)}</div>`).join('');
  $('confirm-warnings').innerHTML = warningsHtml;

  if (state.items.length === 0) {
    list.innerHTML = `<div class="notice">Your cart shows <strong>no included materials</strong>.
      That’s a real result. Confirm below to see what the bundle costs anyway.</div>`;
  } else {
    list.innerHTML = state.items.map((item, idx) => {
      const lowFormat = item.confidence.format === 'low';
      const lowAny = ['title', 'courseCode', 'format', 'isbn'].some((f) => item.confidence[f] === 'low')
        || (item.format === 'access_code' && item.listedPrice != null && item.confidence.listedPrice === 'low');
      // A quick checklist row per item; the full fields stay in the DOM but
      // open only when something needs attention or the user asks. An item
      // the parser wasn't sure about, or an empty manual one, opens itself.
      const open = lowAny || !(item.title ?? '').trim() || item.expandedUi === true;
      const metaBits = [item.courseCode, FORMAT_LABELS[item.format],
        item.isbn ? `ISBN ${item.isbn}` : null].filter(Boolean);
      return `
      <div class="item-card${open ? ' expanded' : ''}" data-item-id="${esc(item.id)}">
        <div class="item-summary">
          <div class="item-summary-text">
            <div class="v-title">${esc(item.title || item.isbn || 'Untitled item')}</div>
            <div class="v-meta">${esc(metaBits.join(' · '))}${item.format === 'access_code' && item.listedPrice != null
              ? ` · <span class="num">${fmt(item.listedPrice)}</span> printed in your capture` : ''}</div>
            ${item.isAccessCode ? '<p class="flag-row"><span class="badge" data-audit="access-flag">Single-use access code</span> <span class="small muted">usually can’t be bought used</span></p>' : ''}
            ${item.resolved && item.isbn ? `<p class="small muted resolved-note">Matched to
              ${esc(item.resolved.title)}${item.resolved.year ? ` (<span class="num">${item.resolved.year}</span>)` : ''}${item.resolved.author ? `, ${esc(item.resolved.author)}` : ''}.
              Wrong book? <button type="button" class="linkish" data-toggle-fields="${idx}">edit</button></p>` : ''}
            ${lowAny ? '<p class="small check-hint">Check the highlighted fields, the tool wasn’t sure.</p>' : ''}
          </div>
          <button type="button" class="linkish item-edit-btn" data-toggle-fields="${idx}"
            aria-expanded="${open}">${open ? 'close' : 'edit'}</button>
        </div>
        <div class="item-fields">
          ${fieldHtml(item, idx, 'title', 'Title', item.title)}
          ${fieldHtml(item, idx, 'courseCode', 'Course (optional)', item.courseCode, 'placeholder="e.g. CS 454"')}
          <div class="field ${lowFormat ? 'low-confidence' : ''}">
            <label for="f-${idx}-format">Format${lowFormat ? ' <span class="check-hint">(check this, the tool wasn’t sure)</span>' : ''}</label>
            <select id="f-${idx}-format" data-idx="${idx}" data-field="format">
              ${Object.entries(FORMAT_LABELS).map(([v, l]) => `<option value="${v}" ${item.format === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          ${fieldHtml(item, idx, 'author', 'Author (optional, helps find the price)', item.author, 'placeholder="e.g. Sipser"')}
          ${fieldHtml(item, idx, 'edition', 'Edition (optional, the year steers the match)', item.edition, 'placeholder="e.g. 3rd 2013"')}
          ${fieldHtml(item, idx, 'isbn', 'ISBN (optional, used to look up a real price)', item.isbn)}
          ${item.format === 'access_code' ? (() => {
            const lowPrice = item.listedPrice != null && item.confidence.listedPrice === 'low';
            return `<div class="field ${lowPrice ? 'low-confidence' : ''}">
            <label for="f-${idx}-listedPrice">Price printed in your capture${lowPrice ? ' <span class="check-hint">(check this, the tool wasn&rsquo;t sure)</span>' : ' (optional)'}</label>
            <input type="number" id="f-${idx}-listedPrice" data-idx="${idx}" data-field="listedPrice"
              min="0" max="99999" step="0.01" inputmode="decimal" value="${item.listedPrice ?? ''}">
            <span class="muted small">${lowPrice
    ? 'Retype the number your capture shows to confirm it. Once you do, it counts as this item&rsquo;s price.'
    : 'Codes are bought new, so this counts as this item&rsquo;s price unless you change it later.'}</span>
          </div>`;
          })() : ''}
          <button type="button" class="btn-danger-text" data-remove="${idx}">Remove this item</button>
        </div>
      </div>`;
    }).join('');
  }

  const units = state.units ?? readUnits();
  $('confirm-units-row').innerHTML = `
    <label for="confirm-units-input"><strong>Units registered:</strong></label>
    <input type="number" id="confirm-units-input" inputmode="numeric" min="1" max="${config.maxUnits}"
      value="${units ?? ''}" placeholder="e.g. 15">
    <span class="muted small">The bundle bills per unit, so this sets its price.</span>`;
}

function wireConfirmStep() {
  $('items-list').addEventListener('input', (e) => {
    const idx = Number(e.target.dataset.idx);
    const { field } = e.target.dataset;
    if (!Number.isInteger(idx) || !field || !state.items[idx]) return;
    const item = state.items[idx];
    item.expandedUi = true; // editing keeps the card open across re-renders
    if (field === 'listedPrice') {
      const val = Number(e.target.value);
      item.listedPrice = e.target.value.trim() !== '' && Number.isFinite(val) && val > 0 && val <= 99999
        ? Math.round(val * 100) / 100 : null;
      item.confidence.listedPrice = 'high';
      return;
    }
    item[field] = e.target.value.trim() === '' && field !== 'title' ? null : e.target.value;
    item.confidence[field] = 'high'; // the user looked at it — it's theirs now
    if (field === 'isbn') item.resolved = null; // their ISBN, not our match
    // A changed author/edition on an unmatched item earns a fresh attempt.
    if ((field === 'author' || field === 'edition') && !isbnish(item.isbn)) item.resolved = null;
    if (field === 'format' || field === 'title') {
      recomputeAccessFlag(item);
      if (field === 'format') renderConfirm(); // badge + select state
    }
  });

  $('items-list').addEventListener('click', (e) => {
    const removeIdx = e.target.dataset?.remove;
    if (removeIdx !== undefined) {
      state.items.splice(Number(removeIdx), 1);
      renderConfirm();
      return;
    }
    const toggleIdx = e.target.dataset?.toggleFields;
    if (toggleIdx !== undefined) {
      const item = state.items[Number(toggleIdx)];
      const card = e.target.closest('.item-card');
      const opening = !card.classList.contains('expanded');
      item.expandedUi = opening;
      card.classList.toggle('expanded', opening);
      const mainBtn = card.querySelector('.item-edit-btn');
      if (mainBtn) {
        mainBtn.textContent = opening ? 'close' : 'edit';
        mainBtn.setAttribute('aria-expanded', String(opening));
      }
      if (opening) card.querySelector('input[data-field="title"]')?.focus();
    }
  });

  $('add-item-btn').addEventListener('click', () => {
    state.items.push(emptyItem());
    renderConfirm();
  });

  $('back-btn').addEventListener('click', () => showStep('input'));

  $('confirm-btn').addEventListener('click', () => {
    const errEl = $('confirm-errors');
    errEl.hidden = true;

    const unitsVal = Number($('confirm-units-input')?.value);
    if (!Number.isFinite(unitsVal) || unitsVal < 1 || unitsVal > config.maxUnits) {
      errEl.textContent = `Enter your registered units, between 1 and ${config.maxUnits}. The bundle is billed per unit.`;
      errEl.hidden = false;
      return;
    }
    const incomplete = state.items.filter((it) => !(it.title ?? '').trim() && !(it.isbn ?? '').trim());
    if (incomplete.length > 0) {
      errEl.textContent = 'Every item needs at least a title or an ISBN. Or remove the ones you don’t need.';
      errEl.hidden = false;
      return;
    }
    state.units = unitsVal;
    applyCapturePrices();
    resolveMissingIsbns(); // a just-added author can still earn a match
    fetchPrices(); // sync prologue sets the loading state before the render below
    renderVerdict();
    showStep('verdict');
  });
}

// ── Price auto-fill ─────────────────────────────────────────────────────────

// Access codes usually can't be bought used; the bookstore's own listed price
// (read from the user's capture, when one was printed there) is the honest
// number for them. The gates are deliberate: format must actually be
// access_code (a title-pattern match alone can flag a real book, and books
// must never get bookstore prices), the price must be positive (a printed
// "$0.00" is bundle framing, not a price), the read must be high-confidence,
// and a price the user set always stands.
function applyCapturePrices() {
  for (const it of state.items) {
    if (it.skipped) continue;
    const eligible = it.format === 'access_code' && it.listedPrice != null && it.listedPrice > 0
      && it.confidence.listedPrice === 'high';
    if (it.priceSource === 'capture') {
      // A re-confirm tracks the confirm screen's current value, including
      // its removal or the format changing away from access code.
      if (eligible) it.userPrice = it.listedPrice;
      else { it.userPrice = null; it.priceSource = null; }
    } else if (eligible && it.userPrice == null) {
      it.userPrice = it.listedPrice;
      it.priceSource = 'capture';
    }
  }
}

// The bundle portal prints no ISBNs. For items that carry an author (the
// reliability requirement — title-only matching picks wrong books), ask the
// resolve endpoint for a strong title+author match and fill the ISBN in,
// labeled on the confirm screen so the user blesses the match before any
// price hangs off it. Best-effort: silence on any failure.
let resolveInFlight = false;

async function resolveMissingIsbns(maxAttempts = 2) {
  if (!config.resolveEndpoint || resolveInFlight) return;
  const targets = state.items.filter((it) => !it.skipped && !isbnish(it.isbn)
    && (it.title ?? '').trim() && (it.author ?? '').trim() && !it.resolved);
  if (targets.length === 0) return;
  resolveInFlight = true;
  targets.forEach((it) => { it.resolving = true; });
  if (state.step === 'verdict') renderVerdict(); // cards say "matching…" while in flight
  let applied = 0;
  try {
    // A cold catalog query can outrun the server's upstream timeout; the
    // second attempt hits a warm cache. One flight, internal retry.
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await fetch(config.resolveEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: targets.map((it) => ({ title: it.title, author: it.author, edition: it.edition })),
        }),
      });
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (body?.resolved) {
        targets.forEach((it, i) => {
          const r = body.resolved[i];
          // Apply only if the user hasn't supplied an ISBN in the meantime.
          if (r?.isbn && !isbnish(it.isbn) && !it.skipped) {
            it.isbn = r.isbn;
            it.confidence.isbn = 'high';
            it.resolved = { title: r.title, author: r.author, year: r.year };
            applied += 1;
          }
        });
        // Anything matched, or a definitive miss on a warm query: done.
        if (applied > 0 || !body.resolved.every((r) => !r?.isbn)) break;
      }
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 2000));
    }
  } catch { /* resolution is best-effort */ }
  targets.forEach((it) => { it.resolving = false; });
  resolveInFlight = false;
  if (state.step === 'confirm') {
    if (applied > 0) {
      // Re-render to show the match, preserving the user's focus and caret
      // if they were mid-edit (every confirm field has a stable id).
      const activeId = document.activeElement?.id || null;
      let caret = null;
      try { caret = document.activeElement?.selectionStart ?? null; } catch { /* number inputs */ }
      renderConfirm();
      if (activeId) {
        const again = $(activeId);
        if (again) {
          again.focus();
          try { if (caret != null) again.setSelectionRange(caret, caret); } catch { /* number inputs */ }
        }
      }
    }
  } else if (state.step === 'verdict') {
    if (applied > 0) fetchPrices();
    renderVerdict(); // prices coming, or the retry affordance restored
  }
}

// Fetch real offers for items that have an ISBN and no price yet. Optional by
// design: on any failure the flow silently stays manual, exactly as it was
// before this endpoint existed. Requests carry ISBNs only.
async function fetchPrices() {
  state.fetchSeq += 1;
  const seq = state.fetchSeq;
  // Only plausible ISBNs go out: one malformed entry would 400 the whole
  // batch server-side and silently kill the lookup for every item.
  const want = state.items.filter((it) => !it.skipped && it.userPrice == null && isbnish(it.isbn));
  if (!config.priceEndpoint || want.length === 0) {
    state.priceFetch = config.priceEndpoint ? 'idle' : 'unavailable';
    return;
  }
  state.priceFetch = 'loading';
  let outcome = 'unavailable';
  try {
    const res = await fetch(config.priceEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isbns: want.map((it) => it.isbn.trim()) }),
    });
    const body = res.ok ? await res.json().catch(() => null) : null;
    if (seq !== state.fetchSeq) return; // the user moved on; don't touch anything
    if (body?.offers) {
      outcome = 'done';
      for (const it of want) {
        const offer = body.offers[it.isbn.trim()];
        if (!offer) continue;
        // A used (or rented) access card is very often already consumed and
        // worthless — for access codes only a NEW offer is an offer at all.
        if (it.isAccessCode && offer.kind !== 'new') continue;
        // Re-check: the user may have typed a price while we were fetching.
        if (it.userPrice == null && !it.skipped) {
          it.userPrice = offer.total;
          it.priceSource = 'auto';
          it.offer = { ...offer, source: body.source ?? 'BooksRun', fetchedAt: body.fetchedAt ?? null };
        }
      }
    }
  } catch {
    // fall through to 'unavailable'
  }
  if (seq !== state.fetchSeq) return;
  state.priceFetch = outcome;
  if (state.step === 'verdict') renderVerdict();
}

// ── Verdict step ────────────────────────────────────────────────────────────

function retailerLinks(item) {
  const q = encodeURIComponent((item.isbn ?? '').trim() || item.title);
  return config.retailers
    .map((r) => `<a href="${esc(r.searchUrl.replace('{q}', q))}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`)
    .join('');
}

const ICONS = {
  good: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8.25"/><path d="M6.5 10.5l2.4 2.4 4.6-5.2"/></svg>',
  info: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8.25"/><path d="M10 9.25v4.5"/><path d="M10 6.1v.1"/></svg>',
  warn: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.2L18 16.8H2z"/><path d="M10 8.4v3.4"/><path d="M10 14.4v.1"/></svg>',
};

function formatDeadline(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}


// The store's catalog address, built from the ISBN and the best title we
// hold (their indexed pattern is /{isbn13}-{title-slug}; the router keys on
// the ISBN). No referral parameters, ever (CLAIMS.md #30).
function storeUrl(item) {
  const isbn = (item.isbn ?? '').replace(/[-\s]/g, '');
  if (!/^97[89]\d{10}$/.test(isbn)) return null;
  const slug = (item.resolved?.title ?? item.title ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `https://booksrun.com/${isbn}-${slug}` : null;
}

// One line describing where a fetched offer came from, for the item row.
function offerLabel(offer) {
  const kind = offer.kind === 'rent'
    ? `${offer.rentDays}-day rental`
    : `${offer.kind}${offer.condition ? ` (${offer.condition})` : ''}`;
  const via = offer.seller ? `${offer.source} seller ${offer.seller}` : offer.source;
  return `${via} · ${kind} · shipping included`;
}

// Is this item still waiting on the automatic price lookup?
function priceLoading(item) {
  return state.priceFetch === 'loading' && !item.skipped
    && item.userPrice == null && Boolean((item.isbn ?? '').trim());
}

function verdictIntro() {
  return state.priceFetch === 'loading' ? 'Finding real prices for your items&hellip;' : '';
}

function renderVerdict() {
  const container = $('verdict-items');
  if (state.items.length === 0) {
    container.innerHTML = '';
  } else {
    container.innerHTML = `<p class="muted small" id="verdict-intro">${verdictIntro()}</p>`
      + state.items.map((item, idx) => {
        const found = !item.skipped && item.userPrice != null
          && (item.priceSource === 'auto' || item.priceSource === 'capture');
        const loading = priceLoading(item);
        const manualHidden = found || loading;
        const summary = !found ? '' : (item.priceSource === 'auto'
          ? `<div class="price-found"><span class="num" data-audit="money">${fmt(item.userPrice)}</span>
              <span class="price-src">${esc(offerLabel(item.offer))}${storeUrl(item) ? ` ·
              <a href="${esc(storeUrl(item))}" target="_blank" rel="noopener noreferrer">view at the store&nbsp;&#8599;</a>` : ''}</span>
              <button type="button" class="linkish" data-edit-idx="${idx}">change</button></div>`
          : `<div class="price-found"><span class="num" data-audit="money">${fmt(item.userPrice)}</span>
              <span class="price-src">listed in your own capture</span>
              <button type="button" class="linkish" data-edit-idx="${idx}">change</button></div>`);
        return `
      <div class="v-item${item.userPrice != null && !item.skipped ? ' priced' : ''}${item.skipped ? ' skipped' : ''}" data-item-idx="${idx}">
        <span class="item-state">${ICONS.good} priced</span>
        <div class="v-title">${esc(item.title || item.isbn || 'Untitled item')}</div>
        <div class="v-meta">${esc([item.courseCode, FORMAT_LABELS[item.format]].filter(Boolean).join(' · '))}${item.isbn ? ` · ISBN <span class="num">${esc(item.isbn)}</span>` : ''}</div>
        ${item.isAccessCode ? (() => {
          // The publisher nudge stays visible for auto-found codes too: only
          // a price from the user's own capture or their own typing quiets it.
          let codeNote = '';
          if (item.userPrice == null && !loading) codeNote = ' Check the publisher&rsquo;s own price for new access and enter that.';
          else if (item.priceSource === 'auto') codeNote = ' The found offer is a new card, but the publisher&rsquo;s own site is the surest source. Worth checking its price too.';
          return `<div class="badge" data-audit="access-flag">Single-use access code</div>
          <div class="v-meta">Access codes usually can&rsquo;t be bought used.${codeNote}</div>`;
        })() : ''}
        ${loading ? '<div class="price-found"><span class="price-src">checking prices&hellip;</span></div>' : ''}
        ${summary}
        ${found ? '<p class="small muted">Think it might be cheaper? Check a link, then change the number.</p>' : ''}
        ${loading ? '' : `<div class="retailer-links">${retailerLinks(item)}</div>`}
        <div class="price-manual" ${manualHidden ? 'hidden' : ''}>
          ${!item.skipped && item.userPrice == null && !isbnish(item.isbn)
    ? (item.resolving
      ? '<p class="small muted">Matching this title to its book&hellip;</p>'
      : `<p class="small muted">${(item.author ?? '').trim()
        ? `Couldn&rsquo;t match this title just now. <button type="button" class="linkish" data-relookup="${idx}">Look it up again</button> or type a price from a link.`
        : 'No ISBN or author to look this up with. Add one under Edit my items, or type a price from a link.'}</p>`)
    : ''}
          <div class="price-row">
            <label for="price-${idx}">Best price you found</label>
            <span class="num price-currency">$</span><input type="number" id="price-${idx}" data-price-idx="${idx}" min="0" max="99999" step="0.01"
              inputmode="decimal" placeholder="0.00" value="${item.userPrice ?? ''}" ${item.skipped ? 'disabled' : ''}>
            <label class="skip-label"><input type="checkbox" data-skip-idx="${idx}" ${item.skipped ? 'checked' : ''}>
              couldn&rsquo;t find it</label>
          </div>
        </div>
      </div>`;
      }).join('');
  }

  const deadlineEl = $('deadline-note');
  const deadlineWhen = config.optOutDeadline
    ? `<strong>Opt out by ${esc(formatDeadline(config.optOutDeadline))}</strong>`
    : `<strong>Opt out by SSU&rsquo;s add/drop deadline for ${esc(config.term)}</strong>`;
  deadlineEl.innerHTML = `${deadlineWhen} at the
    <a href="${esc(config.optOutUrl)}" target="_blank" rel="noopener noreferrer">official
    opt-out page&nbsp;&#8599;</a>. Your list can change later, so check it again near the
    deadline. Opting out is not a lockout.`;

  updateVerdictPanel(true);
}

// When any counted price came from the lookup, verdicts that lean on those
// prices being complete coverage (stay in, close) carry this reminder: one
// store was searched, and a cheaper copy elsewhere would flip the direction
// the coverage gap can actually err in.
function oneSourceNote() {
  return state.items.some((it) => it.priceSource === 'auto' && !it.skipped)
    ? `<p class="verdict-detail">Found prices come from one store; a cheaper copy may exist
      elsewhere. The links under each item let you check before you decide.</p>`
    : '';
}

function updateVerdictPanel(animate = false) {
  const v = computeVerdict(state.items, state.units, config);
  const panel = $('verdict-panel');
  let cls = '';
  let word = '';
  let sub = '';
  let action = '';
  let detail = '';

  const deadlineShort = config.optOutDeadline
    ? `<strong>${esc(formatDeadline(config.optOutDeadline))}</strong>`
    : 'SSU&rsquo;s add/drop deadline';

  if (state.items.length === 0) {
    cls = 'v-optout';
    word = 'No.';
    sub = `Your list shows nothing included. The bundle would cost you <span class="num">${fmt(v.bundleCost)}</span> for it.`;
    action = `Opt out by ${deadlineShort}.`;
    detail = '';
  } else if (v.recommendation === 'incomplete' && v.complete && v.pricedCount === 0) {
    word = 'Can&rsquo;t say.';
    sub = 'Every item is marked \u201ccouldn\u2019t find it\u201d, so there\u2019s nothing to compare yet.';
    detail = '';
  } else if (v.recommendation === 'incomplete' && state.priceFetch === 'loading') {
    word = '&hellip;';
    sub = 'Checking real prices for your items&hellip;';
    detail = '';
  } else if (v.recommendation === 'incomplete') {
    const remaining = v.totalCount - v.pricedCount - v.skippedCount;
    // The bundle is only ever *called* the winner past the close band, so the
    // honest threshold includes it (difference alone would land on "close").
    const breakEven = Math.max(0, v.difference + (config.closeThreshold ?? config.pricePerUnit));
    word = 'Almost.';
    sub = remaining === 1
      ? 'One item still needs a price.'
      : `${remaining} items still need a price.`;
    detail = `<p class="verdict-detail">For the bundle to win, the remaining
      ${remaining === 1 ? 'item' : `${remaining} items together`} would have to
      cost more than <span class="num">${fmt(breakEven)}</span>.</p>`;
  } else if (v.recommendation === 'opt_out') {
    cls = 'v-optout';
    word = 'No.';
    sub = `The bundle isn&rsquo;t worth it for your cart. Opting out keeps
      <span class="num">${fmt(v.difference)}</span> in your pocket.`;
    action = `Opt out by ${deadlineShort}.`;
    detail = v.skippedCount > 0 ? `<p class="verdict-detail"><strong>Caveat:</strong> ${v.skippedCount}
      item(s) you couldn\u2019t price aren\u2019t counted. If they turn out to be expensive,
      this could flip.</p>` : '';
  } else if (v.recommendation === 'stay_in') {
    cls = 'v-stayin';
    word = 'Yes.';
    sub = `The bundle is the better deal for your cart. It saves you
      <span class="num">${fmt(Math.abs(v.difference))}</span>.`;
    action = 'Nothing to do. You&rsquo;re enrolled by default.';
    detail = oneSourceNote();
  } else {
    cls = 'v-close';
    word = 'Close.';
    sub = `Within <span class="num">${fmt(config.closeThreshold)}</span> either way. This one&rsquo;s
      yours to call.`;
    action = `Decide by ${deadlineShort}.`;
    detail = `<p class="verdict-detail">At this margin the non-price factors decide: staying in
      is one flat charge; books you buy outright are yours to keep or resell; materials can be
      added later; opting out is not a lockout.</p>${oneSourceNote()}`;
  }

  const accessNote = v.accessCodeCount > 0 && state.items.length > 0
    ? `<p class="verdict-detail">${v.accessCodeCount} of your items ${v.accessCodeCount === 1 ? 'is' : 'are'}
      a single-use access code, which usually can’t be bought used. If new codes are expensive,
      the bundle can genuinely be the better deal, and this tool will say so when your numbers show it.</p>`
    : '';

  // The receipt, as a subtraction that actually parses: the bundle charge
  // first, each of your priced items deducted from it with a signed amount,
  // a double rule, then the labeled difference in the same money column.
  // Every state gets this same treatment; the state classes carry no styling.
  const bundleLine = `<div class="receipt-line">
      <span class="r-name">Seawolf Bundle, <span class="num">${state.units}</span> units</span>
      <span class="r-dots"></span>
      <span class="r-amt" data-audit="money">${fmt(v.bundleCost)}</span></div>`;
  const lineItems = state.items.map((item) => {
    const name = esc(item.title || item.isbn || 'Untitled item');
    const flag = item.isAccessCode
      ? '<span class="r-flag" data-audit="access-flag">access code</span>' : '';
    // An unpriced line gets no leader and no amount cell: a leader pointing
    // at nothing reads as a glitch, not as pending. While the price lookup is
    // in flight it says so instead.
    if (!item.skipped && item.userPrice == null) {
      const note = priceLoading(item)
        ? '<span class="r-amt r-note">checking&hellip;</span>' : '';
      return `<div class="receipt-line"><span class="r-name">${name}</span>${flag}${note ? '<span class="r-dots"></span>' : ''}${note}</div>`;
    }
    const amt = item.skipped
      ? '<span class="r-amt r-note">couldn’t find it</span>'
      : `<span class="r-amt" data-audit="money">&minus;${fmt(item.userPrice)}</span>`;
    return `<div class="receipt-line"><span class="r-name">${name}</span>${flag}<span class="r-dots"></span>${amt}</div>`;
  }).join('');
  const diffSigned = v.recommendation === 'incomplete' ? null : v.difference;
  // Pending total: a blank line where the figure will print, at figure scale,
  // so the slot reads as awaiting a number rather than as missing glyphs.
  const figHtml = diffSigned == null
    ? '<span class="fig-pending" aria-hidden="true"></span>'
    : `<span data-audit="money">${diffSigned < 0 ? '−' : ''}${fmt(Math.abs(diffSigned))}</span>`;

  panel.className = `verdict-panel ${cls}`;
  panel.innerHTML = `
    <div class="answer-block">
      <p class="answer-word${animate ? ' settle' : ''}" data-audit="verdict-figure" role="status">${word}</p>
      <p class="answer-sub">${sub}</p>
      ${action ? `<p class="answer-action">${action}</p>` : ''}
    </div>
    <div class="receipt-lines${animate ? ' reveal' : ''}" data-audit-money-group="receipt">${bundleLine}${lineItems}</div>
    <div class="receipt-total">
      <div class="receipt-line r-total">
        <span class="r-name">Difference</span>
        <span class="r-dots"></span>
        <div class="receipt-diff">${figHtml}</div>
      </div>
      ${detail}${accessNote}
      <p class="muted small">${state.items.some((it) => it.priceSource === 'auto' && !it.skipped)
        ? 'Found prices are live offers, linked so you can check them. ' : ''}<a
        href="${esc(config.methodologyUrl)}">How this is computed</a>.</p>
    </div>`;
  const intro = $('verdict-intro');
  if (intro) intro.innerHTML = verdictIntro();
}

function wireVerdictStep() {
  // "change" on a found price: the summary gives way to the manual row, and
  // from here on this line runs on the user's own number.
  $('verdict-items').addEventListener('click', (e) => {
    if (e.target.dataset?.relookup !== undefined) {
      resolveMissingIsbns(1); // one attempt per tap; cards show "matching…"
      return;
    }
    const idx = e.target.dataset?.editIdx;
    if (idx === undefined) return;
    const row = e.target.closest('.v-item');
    row?.querySelector('.price-found')?.remove();
    const manual = row?.querySelector('.price-manual');
    if (manual) {
      manual.hidden = false;
      manual.querySelector('input[type="number"]')?.focus();
    }
  });

  $('verdict-items').addEventListener('input', (e) => {
    const priceIdx = e.target.dataset?.priceIdx;
    const skipIdx = e.target.dataset?.skipIdx;
    if (priceIdx !== undefined) {
      const val = e.target.value === '' ? null : Number(e.target.value);
      const valid = Number.isFinite(val) && val >= 0 && val <= 99999;
      if (val !== null && !valid) e.target.value = ''; // don't display a number the math ignores
      const item = state.items[Number(priceIdx)];
      item.userPrice = valid ? val : null;
      item.priceSource = valid ? 'user' : null;
    } else if (skipIdx !== undefined) {
      const item = state.items[Number(skipIdx)];
      item.skipped = e.target.checked;
      const priceInput = e.target.closest('.v-item')?.querySelector('input[type="number"]');
      if (priceInput) priceInput.disabled = e.target.checked; // skipped ⇒ its price is excluded
    } else {
      return;
    }
    const row = e.target.closest('.v-item');
    if (row) {
      const it = state.items[Number(row.dataset.itemIdx)];
      row.classList.toggle('priced', it.userPrice != null && !it.skipped);
      row.classList.toggle('skipped', Boolean(it.skipped));
    }
    updateVerdictPanel();
  });

  $('edit-items-btn').addEventListener('click', () => {
    state.fetchSeq += 1; // abandon any in-flight price lookup
    renderConfirm();
    showStep('confirm');
  });
  $('restart-btn').addEventListener('click', () => {
    state.fetchSeq += 1;
    state.priceFetch = 'idle';
    state.items = [];
    state.units = null;
    state.warnings = [];
    stagedFiles = [];
    renderStaged();
    $('text-input').value = '';
    $('text-details').hidden = true;
    $('capture-alternatives').hidden = true;
    $('input-errors').hidden = true;
    showStep('input');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────

wireInputStep();
wireConfirmStep();
wireVerdictStep();
// Hero bill fragment: units in, bundle bill out, instantly. This is the
// first working piece of the calculator a visitor touches. An out-of-range
// or empty field never fakes a dollar figure; it asks instead.
function updateBill() {
  const units = readUnits();
  const out = $('bill-out');
  if (out) {
    if (units == null) {
      out.innerHTML = `Enter units between 1 and ${config.maxUnits} to see your bill.`;
    } else {
      heroUnits = units;
      const amount = fmt(Math.round(units * config.pricePerUnit * 100) / 100);
      out.innerHTML = `Unless you opt out, SSU bills you
        <strong id="bill-amount">${amount}</strong> for the bundle this semester.`;
    }
  }
}
function nudgeUnits(delta) {
  const input = $('units-input');
  const next = Math.min(config.maxUnits, Math.max(1, (Number(input.value) || heroUnits) + delta));
  input.value = next;
  updateBill();
}
$('units-input')?.addEventListener('input', updateBill);
$('units-minus')?.addEventListener('click', () => nudgeUnits(-1));
$('units-plus')?.addEventListener('click', () => nudgeUnits(1));
// The slim deadline line riding under the tool (the verdict screen carries
// its own fuller deadline note, so CSS hides this one there).
$('screen-deadline').textContent = config.optOutDeadline
  ? `Opt-out deadline: ${formatDeadline(config.optOutDeadline)}.`
  : `Opt out by SSU’s add/drop deadline for ${config.term}.`;
showStep('input'); // marks the stepper's starting position and renders the panel
updateBill();

// Tailor the capture instruction to this device so nobody reads three sets of
// steps. Detection is read locally from the browser and never transmitted.
// iPads masquerade as Macs in Safari's default desktop mode — touch points
// tell them apart. Unknown devices keep the generic instruction.
function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod|iPad/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (navigator.maxTouchPoints > 1 || /Mobile/.test(ua)) return null;
  return 'desktop';
}

const DEVICE_CAPTURE = {
  ios: 'Screenshot it (<strong>Full&nbsp;Page</strong> grabs the whole list) and add it below.',
  android: 'Take a scrolling screenshot and add it below.',
  desktop: 'Copy the whole page (<strong>Ctrl/Cmd&#8209;A</strong>) and paste it below.',
};

const device = detectDevice();
if (device && DEVICE_CAPTURE[device]) {
  const instr = $('capture-instruction');
  if (instr) instr.innerHTML = DEVICE_CAPTURE[device];
}
