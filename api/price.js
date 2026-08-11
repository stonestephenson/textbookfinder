// ISBN → cheapest real offer, via BooksRun's buy-price API.
//
// This is the only file that talks to a price source, and the selection
// policy is isolated in pick-offer.js so it can be tested and swapped. The
// client treats this endpoint as optional: if it's down or unconfigured, the
// verdict flow still works — price fields stay empty and the user gets the
// search links, exactly as before this endpoint existed.
//
// Privacy: the request carries ISBNs only — never titles, courses, units, or
// anything else from the user's cart — and nothing is logged or stored.
//
// Trust: responses return plain product-page links. The affiliate parameters
// BooksRun's API embeds in its cart URLs are deliberately dropped so that
// "this site earns nothing either way" stays true (CLAIMS.md #30).
//
// Deployment (Vercel): set BOOKSRUN_API_KEY in the project's environment
// variables (free key from booksrun.com's API signup).

import { pickOffer } from './pick-offer.js';

const MAX_ISBNS = 20;
const CONCURRENCY = 4;
const UPSTREAM_TIMEOUT_MS = 10_000;

function normalizeIsbn(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.replace(/[-\s]/g, '');
  return /^(\d{13}|\d{9}[\dXx])$/.test(s) ? s.toUpperCase() : null;
}

async function fetchOffer(isbn, key) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://booksrun.com/api/v3/price/buy/${isbn}?key=${encodeURIComponent(key)}`,
      { signal: ctl.signal },
    );
    if (!res.ok) return null;
    return pickOffer(await res.json(), isbn);
  } catch {
    return null; // one ISBN failing must never sink the request
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  // Soft same-origin check, same rationale as api/parse.js.
  const origin = req.headers.origin;
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const allowed = originHost === req.headers.host
      || originHost === 'localhost:8000' || originHost?.startsWith('localhost:');
    if (!allowed) {
      res.status(403).json({ error: 'Cross-origin requests are not accepted.' });
      return;
    }
  }
  const key = process.env.BOOKSRUN_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'Price lookup isn’t configured on this deployment.' });
    return;
  }

  const raw = req.body?.isbns;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: 'Send { isbns: [...] }.' });
    return;
  }
  if (raw.length > MAX_ISBNS) {
    res.status(400).json({ error: `At most ${MAX_ISBNS} ISBNs per request.` });
    return;
  }
  const isbns = raw.map(normalizeIsbn);
  if (isbns.some((i) => i === null)) {
    res.status(400).json({ error: 'Each entry must be a 10- or 13-digit ISBN.' });
    return;
  }

  // Small worker pool: parallel enough to feel instant, gentle on the source.
  const unique = [...new Set(isbns)];
  const found = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
    while (next < unique.length) {
      const isbn = unique[next];
      next += 1;
      found[isbn] = await fetchOffer(isbn, key);
    }
  }));

  res.status(200).json({
    source: 'BooksRun',
    fetchedAt: new Date().toISOString(),
    offers: Object.fromEntries(isbns.map((i, idx) => [raw[idx], found[i]])),
  });
}
