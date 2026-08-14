// Pure matching logic for title+author → ISBN resolution. No fetch, no env —
// api/resolve.js feeds it OpenLibrary search docs; tests feed it fixtures.
//
// Policy (METHODOLOGY.md, "When your page shows no ISBN"):
// - An author is REQUIRED. Title-only matching confidently picks wrong books
//   (verified on a real cart: "theory of computation" alone returns a
//   different textbook). No author, no resolution.
// - The author surname must appear among the candidate's authors, and the
//   title must substantially overlap. Weak matches return null — the manual
//   path is better than a wrong book.
// - When the item carries an edition year (the portal prints "3RD 13"),
//   a candidate from that year is preferred.

import { isValidIsbn } from '../assets/parse-text.js';

// Bookstore abbreviations and binding suffixes, normalized for search.
export function normalizeTitle(raw) {
  return (raw ?? '')
    .toLowerCase()
    .replace(/\((pb|hc|hb|ebook|looseleaf|ll)\)/gi, ' ')
    .replace(/\bintro\.?(?=[\s.]|$)/g, 'introduction')
    .replace(/\bw\/(?=\S)/g, 'with ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'for', 'and', 'on', 'with']);

function contentTokens(title) {
  return normalizeTitle(title).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

// "3RD 13" → 2013, "4TH 18" → 2018, "2013" → 2013. Two-digit years pivot at
// 50 (course materials are never from the 1950s frontier in practice).
export function editionYear(edition) {
  const m = (edition ?? '').match(/\b(\d{4}|\d{2})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[1].length === 4) return n;
  return n <= 50 ? 2000 + n : 1900 + n;
}

export function pickResolution(docs, item) {
  const author = (item.author ?? '').trim();
  if (!author) return null;
  const surname = author.toLowerCase().split(/[\s,]+/).filter(Boolean).pop();
  if (!surname) return null;

  const wanted = contentTokens(item.title ?? '');
  if (wanted.length === 0) return null;

  const candidates = (docs ?? []).map((doc) => {
    const authors = (doc.author_name ?? []).map((a) => String(a).toLowerCase());
    if (!authors.some((a) => a.includes(surname))) return null;
    const got = new Set(contentTokens(doc.title ?? ''));
    const overlap = wanted.filter((t) => got.has(t)).length / wanted.length;
    // 0.6 = the title-match precision/recall knob (see ARCHITECTURE.md tunables):
    // at least 60% of the item's content words must appear in the candidate's
    // title. Lower admits more (and more wrong) matches; higher rejects valid
    // ones with subtitle drift. A wrong book prices cheap and mis-verdicts, so
    // this errs strict — a weak match resolves to nothing and the item stays manual.
    if (overlap < 0.6) return null;
    const isbn13s = (doc.isbn ?? [])
      .filter((i) => /^97[89]\d{10}$/.test(i) && isValidIsbn(i))
      .slice(0, 5);
    if (isbn13s.length === 0) return null;
    return { doc, overlap, isbn13s };
  }).filter(Boolean);

  if (candidates.length === 0) return null;

  const year = editionYear(item.edition);
  const exactYear = year != null
    ? candidates.find((c) => c.doc.first_publish_year === year) : null;
  const best = exactYear ?? candidates[0];

  return {
    isbn: best.isbn13s[0],
    isbn13s: best.isbn13s,
    title: best.doc.title ?? null,
    author: (best.doc.author_name ?? [])[0] ?? author,
    year: best.doc.first_publish_year ?? null,
  };
}
