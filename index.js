import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTurnEvent, readSessionTurnState } from './host/turn-state.js';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
const schemastery = hostRoot
  ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
  : localRequire('@deepseek-ai/schemastery');
const z = schemastery.default ?? schemastery;

const ROUTE = '/rotate-status-text/turn-state';
const LOCALE_ROUTE = '/rotate-status-text/locale';
const LOCALE_ROOT = resolve(fileURLToPath(new URL('./locale/', import.meta.url)));
const LANG_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

const segmentPhrases = z.object({
  start: z.array(z.string()).default([]),
  progress: z.array(z.string()).default([]),
  long: z.array(z.string()).default([]),
});

const stagePalette = z.object({
  start: z.string().default(''),
  progress: z.string().default(''),
  long: z.string().default(''),
});

const stageColors = z.object({
  light: stagePalette.default({}),
  dark: stagePalette.default({}),
});

const pack = z.object({
  phrases: z.union([
    z.array(z.string()),
    z.dict(z.union([z.array(z.string()), segmentPhrases])),
  ]).required(),
  intervalMs: z.number().min(100).default(8000),
  thresholds: z.array(z.number()).default([30, 60]),
  shakePhrases: z.dict(z.array(z.string())).default({}),
  stageColors: z.union([z.const(false), stageColors]).default({}),
});

export const Config = z.object({ pack: z.union([z.const(false), pack]).default(false).volatile() });

function sendJson(req, res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-length': String(body.byteLength),
    'content-type': 'application/json; charset=utf-8',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function apply(ctx) {
  const cache = new Map();
  const offSessionEvent = typeof ctx.on === 'function'
    ? ctx.on('session/event', (session, event) => {
      const id = session?.id;
      if (typeof id !== 'string' || id === '') return;
      let state = cache.get(id);
      if (!state) {
        state = { turnOpen: false, turnStartAt: null };
        cache.set(id, state);
      }
      applyTurnEvent(state, event);
      if (cache.size > 128) {
        const oldest = cache.keys().next().value;
        cache.delete(oldest);
      }
    })
    : undefined;
  ctx.effect(() => () => { try { offSessionEvent?.(); } catch {} }, 'dsh-rotate-status-text: session events');

  ctx.inject(['settings'], scope => scope.effect(
    () => scope.settings.configure({ auto: false }, ctx.fiber),
  ));

  ctx.inject(['webServer'], scope => scope.effect(() => {
    const unregisterLocale = scope.webServer.register({
      kind: 'prefix',
      path: LOCALE_ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        let url;
        try {
          url = new URL(req.url ?? LOCALE_ROUTE, 'http://dsh.local');
        } catch {
          res.writeHead(400, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        if (!url.pathname.startsWith(`${LOCALE_ROUTE}/`) || !url.pathname.endsWith('.json')) {
          res.writeHead(404, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        let lang;
        try {
          lang = decodeURIComponent(url.pathname.slice(LOCALE_ROUTE.length + 1, -5));
        } catch {
          res.writeHead(400, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        if (!LANG_RE.test(lang)) {
          res.writeHead(400, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        const candidates = [lang.toLowerCase(), lang.toLowerCase().split('-')[0], 'en'].filter((id, index, all) => all.indexOf(id) === index);
        for (const id of candidates) {
          try {
            const raw = await readFile(join(LOCALE_ROOT, `${id}.json`), 'utf8');
            const data = JSON.parse(raw);
            const payload = { lang: id, ui: data && typeof data.ui === 'object' ? data.ui : {} };
            const body = Buffer.from(JSON.stringify(payload));
            res.writeHead(200, {
              'x-content-type-options': 'nosniff',
              'cache-control': 'public, max-age=3600',
              'content-length': String(body.byteLength),
              'content-type': 'application/json; charset=utf-8',
            });
            res.end(req.method === 'HEAD' ? undefined : body);
            return;
          } catch (error) {
            if (error?.code !== 'ENOENT') {
              res.writeHead(500, { 'x-content-type-options': 'nosniff' });
              res.end();
              return;
            }
          }
        }
        res.writeHead(404, { 'x-content-type-options': 'nosniff' });
        res.end();
      },
    });
    const unregister = scope.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.writeHead(405, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        let url;
        try {
          url = new URL(req.url ?? ROUTE, 'http://dsh.local');
        } catch {
          res.writeHead(400, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        if (url.pathname !== ROUTE) {
          res.writeHead(404, { 'x-content-type-options': 'nosniff' });
          res.end();
          return;
        }
        const sessionId = url.searchParams.get('sessionId');
        const payload = await readSessionTurnState(scope, cache, sessionId);
        sendJson(req, res, 200, payload);
      },
    });
    return () => {
      try { unregisterLocale?.(); } catch {}
      unregister();
    };
  }, 'dsh-rotate-status-text: turn-state route'));
}
