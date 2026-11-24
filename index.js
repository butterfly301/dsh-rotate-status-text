import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readSessionTurnState } from './host/turn-state.js';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
const schemastery = hostRoot
  ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
  : localRequire('@deepseek-ai/schemastery');
const z = schemastery.default ?? schemastery;

const ROUTE = '/rotate-status-text/turn-state';

// `phrases` is keyed by language id; each language entry can be either the
// segmented `{ start, progress, long }` object or a legacy flat `string[]`.
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
  ctx.inject(['settings'], scope => scope.effect(
    () => scope.settings.configure({ auto: false }, ctx.fiber),
  ));

  ctx.inject(['webServer'], scope => scope.effect(() => {
    const cache = new Map();
    return scope.webServer.register({
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
  }, 'dsh-rotate-status-text: turn-state route'));
}
