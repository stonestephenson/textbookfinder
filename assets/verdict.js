// Pure verdict arithmetic. No DOM, no fetch, no config imports — everything is
// passed in so this stays testable and the numbers have exactly one source.
//
// Money is summed in integer cents; float drift here would be a credibility bug,
// not a cosmetic one.

export function computeVerdict(items, units, config) {
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('units must be a positive number');
  }
  const perUnitCents = Math.round(config.pricePerUnit * 100);
  const closeCents = Math.round((config.closeThreshold ?? config.pricePerUnit) * 100);
  const bundleCents = Math.round(units * perUnitCents);

  let buyCents = 0;
  let pricedCount = 0;
  let skippedCount = 0;
  let accessCodeCount = 0;

  for (const it of items) {
    if (it.isAccessCode) accessCodeCount += 1;
    if (it.skipped) {
      skippedCount += 1;
    } else if (Number.isFinite(it.userPrice) && it.userPrice >= 0) {
      buyCents += Math.round(it.userPrice * 100);
      pricedCount += 1;
    }
  }

  const totalCount = items.length;
  const complete = pricedCount + skippedCount === totalCount;
  const diffCents = bundleCents - buyCents;

  let recommendation;
  if (!complete) {
    // Buy total can only grow as more prices come in, so "buying already costs
    // decisively more than the bundle" is safe to conclude early. "Opt out" is not.
    recommendation = -diffCents > closeCents ? 'stay_in' : 'incomplete';
  } else if (totalCount > 0 && pricedCount === 0) {
    // Every item skipped: there is no price data at all, so there is no basis
    // for any verdict. Refusing here is load-bearing — an "opt out" built on
    // zero entered prices would be exactly the over-claiming this tool exists
    // to avoid.
    recommendation = 'incomplete';
  } else if (Math.abs(diffCents) <= closeCents) {
    recommendation = 'close';
  } else {
    recommendation = diffCents > 0 ? 'opt_out' : 'stay_in';
  }

  return {
    bundleCost: bundleCents / 100,
    knownBuyTotal: buyCents / 100,
    difference: diffCents / 100,
    recommendation,
    complete,
    basedOnAll: complete && skippedCount === 0,
    pricedCount,
    skippedCount,
    totalCount,
    accessCodeCount,
  };
}
