#!/usr/bin/env node
// Local dev server: the static site plus the real api/parse.js handler
// mounted at /api/parse, the way Vercel serves it in production.
//
//   node checks/dev-server.mjs                     # static + parse endpoint
//   ANTHROPIC_API_KEY=sk-... node checks/dev-server.mjs   # with live parsing
//
// Without a key the endpoint answers 503 and the site degrades exactly as it
// would on a deployment with no key configured — paste and manual entry keep
// working. No part of this file ships; it exists so the whole flow can be
// tested before deploying.

import { startServer } from './lib/cdp.mjs';
import parseHandler from '../api/parse.js';
import priceHandler from '../api/price.js';

const ROOT = new URL('..', import.meta.url).pathname;

// Minimal shim for the two Vercel response conveniences the api/ handlers use
// (res.status().json() / .end()) plus Vercel's automatic JSON body parsing.
async function vercelStyle(handler, req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    req.body = raw ? JSON.parse(raw) : {};
  } catch {
    req.body = {};
  }
  const shim = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(obj) {
      res.writeHead(this.statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
      return this;
    },
    end(body) { res.writeHead(this.statusCode); res.end(body); return this; },
  };
  await handler(req, shim);
}

export function startDevServer() {
  return startServer(ROOT, {
    '/api/parse': (req, res) => vercelStyle(parseHandler, req, res),
    '/api/price': (req, res) => vercelStyle(priceHandler, req, res),
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const srv = await startDevServer();
  const { port } = srv.address();
  console.log(`Serving the site with a live /api/parse at http://127.0.0.1:${port}`);
  console.log(process.env.ANTHROPIC_API_KEY
    ? 'ANTHROPIC_API_KEY is set: screenshot parsing is LIVE (each parse costs ~half a cent).'
    : 'ANTHROPIC_API_KEY is not set: /api/parse answers 503, site degrades to paste/manual.');
  console.log(process.env.BOOKSRUN_API_KEY
    ? 'BOOKSRUN_API_KEY is set: price lookup is LIVE.'
    : 'BOOKSRUN_API_KEY is not set: /api/price answers 503, price fields stay manual.');
}
