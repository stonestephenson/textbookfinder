// Shared headless-Chrome plumbing for the checks in this directory.
// Driven over CDP via Node's native WebSocket — no dependencies.
// Extracted from design-audit.mjs so e2e.mjs and parse-live.mjs can reuse it.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(existsSync);

export const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.woff2': 'font/woff2', '.md': 'text/plain', '.json': 'application/json',
};

// Serve the repo's static files; `extraRoutes` maps an exact URL path to an
// async (req, res) handler and wins over the filesystem (used by dev-server
// to mount api/parse.js the way Vercel would).
export function startServer(root, extraRoutes = {}) {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (extraRoutes[urlPath]) {
          await extraRoutes[urlPath](req, res);
          return;
        }
        const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
        const file = path.join(root, rel);
        if (!file.startsWith(root)) throw new Error('traversal');
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

export function launchChrome() {
  return new Promise((resolve, reject) => {
    const proc = spawn(CHROME, [
      '--headless=new', '--remote-debugging-port=0', '--disable-gpu',
      '--no-first-run', '--hide-scrollbars', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve({ proc, wsUrl: m[1] });
    });
    proc.on('exit', () => reject(new Error('chrome exited before DevTools was ready')));
    setTimeout(() => reject(new Error('chrome DevTools timeout')), 15000);
  });
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.eventWaiters = this.eventWaiters.filter((w) => {
          if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) {
            w.resolve(msg.params);
            return false;
          }
          return true;
        });
      }
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => resolve(new Cdp(ws)));
      ws.addEventListener('error', () => reject(new Error('CDP websocket failed')));
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  waitEvent(method, sessionId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.eventWaiters.push({ method, sessionId, resolve: (p) => { clearTimeout(t); resolve(p); } });
    });
  }
}

export async function newPage(cdp, url, width) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height: 1100, deviceScaleFactor: 1, mobile: width < 500,
  }, sessionId);
  // Generous timeout: on a loaded machine (or CI) a cold headless Chrome can
  // take well over the default 10s to fire the first load event.
  const load = cdp.waitEvent('Page.loadEventFired', sessionId, 30000);
  await cdp.send('Page.navigate', { url }, sessionId);
  await load;
  return { sessionId, targetId };
}

export async function setScheme(cdp, sessionId, scheme) {
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  }, sessionId);
}

export async function evalIn(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (exceptionDetails) {
    throw new Error(`in-page error: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value;
}

export async function screenshot(cdp, sessionId, file) {
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
  }, sessionId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data, 'base64'));
}
