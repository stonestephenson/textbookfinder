// Title+author → ISBN, via OpenLibrary's public search. The bundle portal
// prints no ISBNs, so without this the price lookup has nothing to search by.
//
// The matching policy is isolated in resolve-match.js (pure, unit-tested):
// author required, surname must match, strong title overlap, edition-year
// preference. A weak match returns null — the manual path beats a wrong book.
// Every resolved match is shown to the user on the confirm screen before any
// price hangs off it.
//
// Privacy: the request carries item titles/authors/editions only — no user
// identity, no courses, no units — and nothing is logged or stored. No API
// key involved; OpenLibrary is a public catalog.

import { pickResolution, normalizeTitle } from './resolve-match.js';

const MAX_ITEMS = 10;
const CONCURRENCY = 3;
const UPSTREAM_TIMEOUT_MS = 8_000;
const UA = 'istheseawolfbundleworthit.com (open source; see repository for contact)';

async function resolveOne(item) {
  const author = (item.author ?? '').trim();
  const title = normalizeTitle(item.title ?? '');
  if (!author || !title) return null; // no-author policy: never resolve blind

  const q = `${title} ${author}`;
  const url = 'https://openlibrary.org/search.json?q=' + encodeURIComponent(q)
    + '&limit=5&fields=title,author_name,isbn,first_publish_year';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const body = await res.json();
    return pickResolution(body?.docs ?? [], item);
  } catch {
    return null; // one item failing must never sink the request
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
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

  const raw = req.body?.items;
  if (!Array.isArray(raw) || raw.length === 0) {
    res.status(400).json({ error: 'Send { items: [{ title, author, edition? }] }.' });
    return;
  }
  if (raw.length > MAX_ITEMS) {
    res.status(400).json({ error: `At most ${MAX_ITEMS} items per request.` });
    return;
  }
  if (raw.some((it) => typeof it !== 'object' || it === null)) {
    res.status(400).json({ error: 'Each entry must be an object.' });
    return;
  }

  const resolved = new Array(raw.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, raw.length) }, async () => {
    while (next < raw.length) {
      const i = next;
      next += 1;
      resolved[i] = await resolveOne(raw[i]);
    }
  }));

  res.status(200).json({ source: 'OpenLibrary', resolved });
}
