import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickResolution, normalizeTitle, editionYear } from '../api/_resolve-match.js';

// Docs mirror real OpenLibrary responses for q="theory of computation sipser"
// (probe 2026-08-12). 9781133187790 is the true 3rd-edition ISBN.
const SIPSER_DOCS = [
  { title: 'Introduction to the theory of computation', author_name: ['Michael Sipser'], first_publish_year: 2013, isbn: ['9781133187790', '9780357670583'] },
  { title: 'Introduction to the Theory of Computation', author_name: ['Michael Sipser'], first_publish_year: 2005, isbn: ['9780534950972'] },
  { title: 'Introduction to the theory of computation', author_name: ['Michael Sipser'], first_publish_year: 1996, isbn: ['9780534952501', '9780534947286'] },
];

test('bookstore-mangled title + surname + edition year resolves to the right edition', () => {
  const r = pickResolution(SIPSER_DOCS, {
    title: 'INTRO.TO THEORY OF COMPUTATION (PB)',
    author: 'SIPSER',
    edition: '3RD 13',
  });
  assert.ok(r, 'expected a resolution');
  assert.equal(r.isbn, '9781133187790');
  assert.equal(r.year, 2013);
  assert.equal(r.author, 'Michael Sipser');
});

test('no author, no resolution — title-only matching picks wrong books', () => {
  assert.equal(pickResolution(SIPSER_DOCS, { title: 'INTRO.TO THEORY OF COMPUTATION (PB)', author: null }), null);
  assert.equal(pickResolution(SIPSER_DOCS, { title: 'INTRO.TO THEORY OF COMPUTATION (PB)', author: '  ' }), null);
});

test('author surname must match a candidate author', () => {
  const r = pickResolution(SIPSER_DOCS, { title: 'INTRO.TO THEORY OF COMPUTATION (PB)', author: 'HOPCROFT' });
  assert.equal(r, null);
});

test('weak title overlap is rejected even with the right author', () => {
  const r = pickResolution(SIPSER_DOCS, { title: 'ORGANIC CHEMISTRY (PB)', author: 'SIPSER' });
  assert.equal(r, null);
});

test('without an edition year, the top matching candidate wins', () => {
  const r = pickResolution(SIPSER_DOCS, { title: 'Introduction to the Theory of Computation', author: 'Sipser', edition: null });
  assert.equal(r.year, 2013);
});

test('candidates with only invalid or non-13 ISBNs are skipped', () => {
  const docs = [
    { title: 'Introduction to the theory of computation', author_name: ['Michael Sipser'], first_publish_year: 2013, isbn: ['9781133187791', '0534950973'] },
    { title: 'Introduction to the theory of computation', author_name: ['Michael Sipser'], first_publish_year: 2005, isbn: ['9780534950972'] },
  ];
  const r = pickResolution(docs, { title: 'INTRO.TO THEORY OF COMPUTATION', author: 'SIPSER', edition: '3RD 13' });
  assert.equal(r.isbn, '9780534950972'); // the 2013 doc had no valid ISBN-13
});

test('normalizeTitle expands bookstore shorthand', () => {
  assert.equal(normalizeTitle('INTRO.TO THEORY OF COMPUTATION (PB)'), 'introduction to theory of computation');
  assert.equal(normalizeTitle('THEY SAY/I SAY W/READINGS'), 'they say i say with readings');
});

test('editionYear reads portal edition markers', () => {
  assert.equal(editionYear('3RD 13'), 2013);
  assert.equal(editionYear('3rd 2013'), 2013);
  assert.equal(editionYear('4TH 18'), 2018);
  assert.equal(editionYear('2005'), 2005);
  assert.equal(editionYear('REV 98'), 1998);
  assert.equal(editionYear('THIRD'), null);
  assert.equal(editionYear(null), null);
});
