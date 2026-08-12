// Screenshot → structured course-materials list, via Claude vision.
//
// This is the ONLY file that talks to an AI model, and the model call is
// isolated in extractItems() so it can be swapped without touching the rest
// of the app. The client treats this endpoint as optional: if it's down or
// unconfigured, pasted text and manual entry still work entirely in-browser.
//
// Privacy: the image is processed in this single request and never written
// anywhere by this function — no logging of image data, no storage.
//
// Deployment (Vercel): set ANTHROPIC_API_KEY in the project's environment
// variables. Optionally set PARSE_MODEL to override the model.

import Anthropic from '@anthropic-ai/sdk';

// claude-haiku-4-5: vision-capable and ~1/10th the cost of Opus-tier (about
// half a cent per screenshot). The confirm step exists to catch parse
// mistakes, so the cheap model is the right default; set PARSE_MODEL to
// e.g. 'claude-opus-5' if messy photos need more robustness.
const MODEL = process.env.PARSE_MODEL || 'claude-haiku-4-5';

const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // combined, ~3MB binary; client downscales first
const MAX_IMAGES = 4;

// Mirrors the client's ParseResult shape (assets/app.js adoptItems()).
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pageLooksLikeCourseMaterials', 'items', 'warnings'],
  properties: {
    pageLooksLikeCourseMaterials: {
      type: 'boolean',
      description: 'true only if the screenshot shows a bookstore course-materials / cart page listing course items',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['courseCode', 'title', 'format', 'isbn', 'listedPrice', 'confidence'],
        properties: {
          courseCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          format: { enum: ['physical', 'digital', 'access_code', 'unknown'] },
          isbn: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          listedPrice: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'the price printed next to this item in the capture, as a plain number, or null if none is legible',
          },
          confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['courseCode', 'title', 'format', 'isbn', 'listedPrice'],
            properties: {
              courseCode: { enum: ['high', 'low'] },
              title: { enum: ['high', 'low'] },
              format: { enum: ['high', 'low'] },
              isbn: { enum: ['high', 'low'] },
              listedPrice: { enum: ['high', 'low'] },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACTION_PROMPT = `This is a capture a college student took of their campus bookstore's course materials page (their own cart of included/required items for their registered courses). It may arrive as several screenshots or slices of one long page: they can overlap, and an item cut off at the edge of one slice usually appears whole in the next — merge everything and report each distinct item exactly once.

Extract every course material item that is actually visible. Rules:
- Report ONLY what you can read in the image. Never invent or complete an ISBN — if it isn't fully legible, set isbn to null and mark its confidence "low". A wrong ISBN is worse than no ISBN.
- For each field you had to infer or that is partially cut off, set its confidence to "low". The student reviews and corrects everything you return, so "low" is a request for their attention, not a failure.
- format: "physical" for print books and rentals, "digital" for ebooks/eTexts, "access_code" for courseware and access codes (MyLab, MindTap, WebAssign, Connect, ALEKS, Revel, Achieve, zyBooks, and similar platforms).
- listedPrice: if a real price is printed next to the item, record it as a plain number (no currency sign). "$0.00", "included", "free", a struck-through price, or a bundle/rental label is NOT a listed price — record null for those. If no price is legible for that item, set it to null. Never estimate, compute, or carry a price over from another item. Ignore page-level totals and "savings" figures entirely. If the digits are partially obscured or you are not certain of the amount, set its confidence to "low".
- If the screenshot is not a course-materials page (wrong page, unreadable, not a bookstore), set pageLooksLikeCourseMaterials to false and return an empty items list.
- Use warnings for anything the student should know (e.g. "the list appears cut off; there may be more items below").`;

// The swappable model call: capture blocks in, ParseResult out. The request
// shape deliberately uses only parameters valid on every current Claude model
// (Haiku through Opus), so PARSE_MODEL can point anywhere without code edits.
async function extractItems(captureBlocks) {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...captureBlocks,
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return { error: 'The parsing service declined to read this image. Try pasting the page text instead.' };
  }
  if (response.stop_reason === 'max_tokens') {
    return { error: 'That capture has more content than the parser can handle at once. Try a tighter screenshot, or paste the text instead.' };
  }

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) return { error: 'The parser returned nothing readable. Try pasting the page text instead.' };
  return JSON.parse(text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  // Soft same-origin check: browsers send an Origin header on cross-origin
  // POSTs, so this blocks other sites driving cost against this endpoint.
  // (Non-browser abuse is bounded by the input limits and the account's
  // spend cap — see README.)
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
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: 'Screenshot parsing isn’t configured on this deployment. Paste the page text instead. That works entirely in your browser.',
    });
    return;
  }

  // Accepted payloads: { images: [{data, mediaType}, ...] } (1–4 screenshots
  // or slices of one long capture), { pdf } (a full-page capture — what iOS
  // "Full Page" screenshots and desktop print-to-PDF produce), or the legacy
  // single { image, mediaType }.
  const body = req.body ?? {};
  const images = Array.isArray(body.images)
    ? body.images
    : (typeof body.image === 'string' ? [{ data: body.image, mediaType: body.mediaType }] : []);

  let captureBlocks;
  if (typeof body.pdf === 'string' && body.pdf.length > 0) {
    if (body.pdf.length > MAX_BASE64_LENGTH) {
      res.status(413).json({ error: 'That PDF is too large. Try screenshots of the list instead, or paste the text.' });
      return;
    }
    captureBlocks = [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: body.pdf },
    }];
  } else {
    if (images.length === 0) {
      res.status(400).json({ error: 'Missing capture data.' });
      return;
    }
    if (images.length > MAX_IMAGES) {
      res.status(400).json({ error: `At most ${MAX_IMAGES} screenshots per request. For a longer list, paste the page text instead.` });
      return;
    }
    const total = images.reduce((n, i) => n + (typeof i?.data === 'string' ? i.data.length : 0), 0);
    if (total === 0 || images.some((i) => typeof i?.data !== 'string' || i.data.length === 0)) {
      res.status(400).json({ error: 'Missing capture data.' });
      return;
    }
    if (total > MAX_BASE64_LENGTH) {
      res.status(413).json({ error: 'Those images are too large together. Try normal screenshots rather than photos, or paste the text.' });
      return;
    }
    if (images.some((i) => !ALLOWED_MEDIA_TYPES.includes(i.mediaType))) {
      res.status(400).json({ error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' });
      return;
    }
    captureBlocks = images.map((i) => ({
      type: 'image',
      source: { type: 'base64', media_type: i.mediaType, data: i.data },
    }));
  }

  try {
    const result = await extractItems(captureBlocks);
    if (result.error) {
      res.status(422).json({ error: result.error });
      return;
    }
    res.status(200).json({
      wrongPage: result.pageLooksLikeCourseMaterials === false,
      items: result.items ?? [],
      warnings: result.warnings ?? [],
    });
  } catch (err) {
    const status = err?.status === 429 ? 429 : 502;
    res.status(status).json({
      error: status === 429
        ? 'The parser is busy right now. Wait a moment and try again, or paste the page text instead.'
        : 'The screenshot reader hit an error. Paste the page text instead. That works entirely in your browser.',
    });
  }
}
