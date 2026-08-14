import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickOffer } from '../api/_pick-offer.js';

const ISBN = '9780134093413';

// Shapes below mirror real BooksRun v3 buy responses observed 2026-08-11:
// empty categories are the string "none"; `offers` degrades to [] on errors.
const wrap = (offers, status = 'success', message = '') => ({ result: { status, message, offers } });

test('error status → null (e.g. "Wrong Isbn")', () => {
  assert.equal(pickOffer(wrap([], 'error', 'Wrong Isbn'), ISBN), null);
  assert.equal(pickOffer(wrap([], 'error', 'Wrong API access key'), ISBN), null);
  assert.equal(pickOffer(undefined, ISBN), null);
  assert.equal(pickOffer({}, ISBN), null);
});

test('success with every category "none" → null (no purchasable offer)', () => {
  const offers = {
    booksrun: { used: 'none', new: 'none', rent: 'none', ebook: 'none', shipping: 0 },
    marketplace: 'none',
    international_shipping: 'none',
  };
  assert.equal(pickOffer(wrap(offers), ISBN), null);
});

test('cheapest of used/new/marketplace wins, shipping included', () => {
  const offers = {
    booksrun: { used: { price: 52.51, shipping_price: 0 }, new: 'none', rent: 'none', ebook: 'none', shipping: 0 },
    marketplace: [
      { seller: 'Walker Bookstore', shipping: 4.99, used: { price: 44.0, condition: 'VeryGood' }, new: 'none' },
      { seller: 'Alibris', shipping: 3.99, used: { price: 134.19, condition: 'Good' }, new: 'none' },
    ],
  };
  const o = pickOffer(wrap(offers), ISBN);
  assert.equal(o.total, 48.99); // 44.00 + 4.99 beats 52.51 + 0
  assert.equal(o.kind, 'used');
  assert.equal(o.seller, 'Walker Bookstore');
  assert.equal(o.condition, 'VeryGood');
});

test('term-length rentals (110+ days) are candidates; shorter rentals are not', () => {
  const offers = {
    booksrun: {
      used: { price: 52.51, shipping_price: 0 },
      new: 'none',
      rent: {
        35: { price: 5.0, shipping_price: 0 },   // short — excluded even though cheapest
        90: { price: 8.0, shipping_price: 0 },   // ends before finals — excluded too
        127: { price: 29.09, shipping_price: 0 },
      },
      ebook: 'none', shipping: 0,
    },
    marketplace: 'none',
  };
  const o = pickOffer(wrap(offers), ISBN);
  assert.equal(o.kind, 'rent');
  assert.equal(o.rentDays, 127);
  assert.equal(o.total, 29.09);
});

test('ebooks are never candidates', () => {
  const offers = {
    booksrun: { used: 'none', new: 'none', rent: 'none', ebook: { perpetual: { price: 9.99 } }, shipping: 0 },
    marketplace: 'none',
  };
  assert.equal(pickOffer(wrap(offers), ISBN), null);
});

test('tie between ownership and rental prefers ownership', () => {
  const offers = {
    booksrun: {
      used: { price: 30.0, shipping_price: 0 },
      new: 'none',
      rent: { 127: { price: 30.0, shipping_price: 0 } },
      ebook: 'none', shipping: 0,
    },
    marketplace: 'none',
  };
  assert.equal(pickOffer(wrap(offers), ISBN).kind, 'used');
});

test('missing shipping_price falls back to booksrun-level shipping', () => {
  const offers = {
    booksrun: { used: { price: 20.0 }, new: 'none', rent: 'none', ebook: 'none', shipping: 3.5 },
    marketplace: 'none',
  };
  assert.equal(pickOffer(wrap(offers), ISBN).total, 23.5);
});

test('garbage prices are ignored, not summed', () => {
  const offers = {
    booksrun: { used: { price: 'call us' }, new: { price: -5 }, rent: 'none', ebook: 'none', shipping: 0 },
    marketplace: [{ seller: 'X', shipping: 0, used: { price: NaN }, new: 'none' }],
  };
  assert.equal(pickOffer(wrap(offers), ISBN), null);
});

test('offers carry no URL: the affiliate cart links never leave the server', () => {
  const offers = {
    booksrun: {
      used: { price: 10, shipping_price: 0, cart_url: 'https://booksrun.com/user/buy/cart/add/x-11-1?afk=30642' },
      new: 'none', rent: 'none', ebook: 'none', shipping: 0,
    },
    marketplace: 'none',
  };
  const o = pickOffer(wrap(offers), ISBN);
  assert.equal('url' in o, false);
  assert.ok(!JSON.stringify(o).includes('afk'));
});

test('money is exact to the cent', () => {
  const offers = {
    booksrun: { used: { price: 0.1, shipping_price: 0.2 }, new: 'none', rent: 'none', ebook: 'none', shipping: 0 },
    marketplace: 'none',
  };
  assert.equal(pickOffer(wrap(offers), ISBN).total, 0.3);
});
