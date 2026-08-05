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

const MODEL = process.env.PARSE_MODEL || 'claude-opus-5';

const ALLOWED_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // ~3MB image; client downscales first

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
        required: ['courseCode', 'title', 'format', 'isbn', 'confidence'],
        properties: {
          courseCode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          title: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          format: { enum: ['physical', 'digital', 'access_code', 'unknown'] },
          isbn: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          confidence: {
            type: 'object',
            additionalProperties: false,
            required: ['courseCode', 'title', 'format', 'isbn'],
            properties: {
              courseCode: { enum: ['high', 'low'] },
              title: { enum: ['high', 'low'] },
              format: { enum: ['high', 'low'] },
              isbn: { enum: ['high', 'low'] },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const EXTRACTION_PROMPT = `This is a screenshot a college student took of their campus bookstore's course materials page (their own cart of included/required items for their registered courses).

Extract every course material item that is actually visible. Rules:
- Report ONLY what you can read in the image. Never invent or complete an ISBN — if it isn't fully legible, set isbn to null and mark its confidence "low". A wrong ISBN is worse than no ISBN.
- For each field you had to infer or that is partially cut off, set its confidence to "low". The student reviews and corrects everything you return, so "low" is a request for their attention, not a failure.
- format: "physical" for print books and rentals, "digital" for ebooks/eTexts, "access_code" for courseware and access codes (MyLab, MindTap, WebAssign, Connect, ALEKS, Revel, Achieve, zyBooks, and similar platforms).
- Ignore any prices shown in the screenshot entirely — do not extract them.
- If the screenshot is not a course-materials page (wrong page, unreadable, not a bookstore), set pageLooksLikeCourseMaterials to false and return an empty items list.
- Use warnings for anything the student should know (e.g. "the list appears cut off — there may be more items below").`;

// The swappable model call: image in, ParseResult out.
async function extractItems(imageBase64, mediaType) {
  const client = new Anthropic();

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    return { error: 'The parsing service declined to read this image. Try pasting the page text instead.' };
  }
  if (response.stop_reason === 'max_tokens') {
    return { error: 'That screenshot has more content than the parser can handle at once. Try a tighter screenshot, or paste the text instead.' };
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
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: 'Screenshot parsing isn’t configured on this deployment. Paste the page text instead — that works entirely in your browser.',
    });
    return;
  }

  const { image, mediaType } = req.body ?? {};
  if (typeof image !== 'string' || image.length === 0) {
    res.status(400).json({ error: 'Missing image data.' });
    return;
  }
  if (image.length > MAX_BASE64_LENGTH) {
    res.status(413).json({ error: 'Image too large. Try a normal screenshot rather than a photo.' });
    return;
  }
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: 'Unsupported image type. Use PNG, JPEG, WebP, or GIF.' });
    return;
  }

  try {
    const result = await extractItems(image, mediaType);
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
        ? 'The parser is busy right now — wait a moment and try again, or paste the page text instead.'
        : 'The screenshot reader hit an error. Paste the page text instead — that works entirely in your browser.',
    });
  }
}
