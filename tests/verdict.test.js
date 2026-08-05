import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict } from '../assets/verdict.js';

const config = { pricePerUnit: 21.0, closeThreshold: 21.0 };

const item = (overrides = {}) => ({
  userPrice: null,
  skipped: false,
  isAccessCode: false,
  ...overrides,
});

test('bundle cost is units × pricePerUnit, exact to the cent', () => {
  const v = computeVerdict([], 10, config);
  assert.equal(v.bundleCost, 210.0);
  const v2 = computeVerdict([], 13, config);
  assert.equal(v2.bundleCost, 273.0);
});

test('empty cart → complete, opt_out, difference equals full bundle cost', () => {
  const v = computeVerdict([], 10, config);
  assert.equal(v.complete, true);
  assert.equal(v.recommendation, 'opt_out');
  assert.equal(v.knownBuyTotal, 0);
  assert.equal(v.difference, 210.0);
});

test("Stone's documented case: one $11.08 book vs $210 bundle → opt_out", () => {
  const v = computeVerdict([item({ userPrice: 11.08 })], 10, config);
  assert.equal(v.complete, true);
  assert.equal(v.recommendation, 'opt_out');
  assert.equal(v.knownBuyTotal, 11.08);
  assert.equal(v.difference, 198.92);
});

test('buying costs more than bundle → stay_in', () => {
  const items = [item({ userPrice: 150 }), item({ userPrice: 120, isAccessCode: true })];
  const v = computeVerdict(items, 10, config);
  assert.equal(v.recommendation, 'stay_in');
  assert.equal(v.difference, -60);
  assert.equal(v.accessCodeCount, 1);
});

test('within closeThreshold either way → close', () => {
  assert.equal(computeVerdict([item({ userPrice: 195 })], 10, config).recommendation, 'close');
  assert.equal(computeVerdict([item({ userPrice: 225 })], 10, config).recommendation, 'close');
  assert.equal(computeVerdict([item({ userPrice: 189 })], 10, config).recommendation, 'close');
});

test('just beyond closeThreshold → decisive', () => {
  assert.equal(computeVerdict([item({ userPrice: 188.99 })], 10, config).recommendation, 'opt_out');
  assert.equal(computeVerdict([item({ userPrice: 231.01 })], 10, config).recommendation, 'stay_in');
});

test('unpriced items → incomplete, no recommendation', () => {
  const items = [item({ userPrice: 11.08 }), item()];
  const v = computeVerdict(items, 10, config);
  assert.equal(v.complete, false);
  assert.equal(v.recommendation, 'incomplete');
  assert.equal(v.pricedCount, 1);
  assert.equal(v.totalCount, 2);
});

test('early stay_in: partial prices already decisively exceed bundle', () => {
  const items = [item({ userPrice: 300 }), item()];
  const v = computeVerdict(items, 10, config);
  assert.equal(v.complete, false);
  assert.equal(v.recommendation, 'stay_in');
});

test('partial prices exceed bundle but only within closeThreshold → still incomplete', () => {
  const items = [item({ userPrice: 220 }), item()];
  const v = computeVerdict(items, 10, config);
  assert.equal(v.recommendation, 'incomplete');
});

test('skipped items: verdict computed on priced only, basedOnAll=false', () => {
  const items = [item({ userPrice: 11.08 }), item({ skipped: true })];
  const v = computeVerdict(items, 10, config);
  assert.equal(v.complete, true);
  assert.equal(v.basedOnAll, false);
  assert.equal(v.skippedCount, 1);
  assert.equal(v.recommendation, 'opt_out');
});

test('all priced → basedOnAll=true', () => {
  const v = computeVerdict([item({ userPrice: 50 })], 10, config);
  assert.equal(v.basedOnAll, true);
});

test('cents arithmetic has no float drift', () => {
  const items = [item({ userPrice: 0.1 }), item({ userPrice: 0.2 })];
  const v = computeVerdict(items, 1, config);
  assert.equal(v.knownBuyTotal, 0.3);
});

test('invalid units rejected', () => {
  assert.throws(() => computeVerdict([], 0, config));
  assert.throws(() => computeVerdict([], -3, config));
  assert.throws(() => computeVerdict([], NaN, config));
});
