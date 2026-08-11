// Pure offer selection for BooksRun buy-price responses. No fetch, no env —
// api/price.js feeds it raw response JSON; tests feed it fixtures.
//
// Policy (documented in METHODOLOGY.md, "Where the prices come from"):
// - Candidates are real purchasable offers: BooksRun's own used/new stock,
//   marketplace sellers' used/new stock, and BooksRun rentals long enough to
//   cover a full semester (~110 days; the bundle itself is rental-first, so a
//   term-length rental is a fair comparable — a 90-day rental that ends
//   before finals is not).
// - Ebooks are excluded: platform access isn't ownership and muddies the
//   comparison. Excluding them can only overstate the buy side, which errs
//   toward "stay in" — the conservative direction.
// - The total always includes shipping. Cheapest total wins; ties prefer
//   ownership (used/new) over rental.

const MIN_RENT_DAYS = 110; // a fall/spring semester, first day to finals

function money(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function offerDict(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

export function pickOffer(response, isbn) {
  const result = response?.result;
  if (!result || result.status !== 'success') return null;
  const offers = offerDict(result.offers);
  if (!offers) return null;

  const candidates = [];

  const br = offerDict(offers.booksrun);
  if (br) {
    const brShip = money(br.shipping) ?? 0;
    for (const kind of ['used', 'new']) {
      const o = offerDict(br[kind]);
      const price = o && money(o.price);
      if (price != null) {
        const shipping = money(o.shipping_price) ?? brShip;
        candidates.push({ kind, price, shipping, seller: null, rentDays: null });
      }
    }
    const rent = offerDict(br.rent);
    if (rent) {
      for (const [days, o] of Object.entries(rent)) {
        const d = Number(days);
        const od = offerDict(o);
        const price = od && money(od.price);
        if (Number.isFinite(d) && d >= MIN_RENT_DAYS && price != null) {
          const shipping = money(od.shipping_price) ?? brShip;
          candidates.push({ kind: 'rent', price, shipping, seller: null, rentDays: d });
        }
      }
    }
  }

  const marketplace = Array.isArray(offers.marketplace) ? offers.marketplace : [];
  for (const seller of marketplace) {
    const s = offerDict(seller);
    if (!s) continue;
    const shipping = money(s.shipping) ?? 0;
    for (const kind of ['used', 'new']) {
      const o = offerDict(s[kind]);
      const price = o && money(o.price);
      if (price != null) {
        candidates.push({
          kind, price, shipping,
          seller: typeof s.seller === 'string' ? s.seller : null,
          condition: typeof o.condition === 'string' ? o.condition : null,
          rentDays: null,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  const cents = (c) => Math.round((c.price + c.shipping) * 100);
  candidates.sort((a, b) => {
    const d = cents(a) - cents(b);
    if (d !== 0) return d;
    return (a.kind === 'rent' ? 1 : 0) - (b.kind === 'rent' ? 1 : 0);
  });
  const best = candidates[0];

  return {
    total: cents(best) / 100,
    price: Math.round(best.price * 100) / 100,
    shipping: Math.round(best.shipping * 100) / 100,
    kind: best.kind,
    rentDays: best.rentDays ?? null,
    seller: best.seller ?? null,
    condition: best.condition ?? null,
    // Plain product page — deliberately NOT the API's affiliate cart_url.
    // This site earns nothing from any link (CLAIMS.md #30).
    url: `https://booksrun.com/${isbn}`,
  };
}
