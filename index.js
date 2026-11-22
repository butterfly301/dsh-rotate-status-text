import { createRequire } from 'node:module';
import { join } from 'node:path';

const localRequire = createRequire(import.meta.url);
const hostRoot = process.env.DSH_INSTALL_DIR
  ?? (process.resourcesPath && join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'));
const schemastery = hostRoot
  ? createRequire(join(hostRoot, 'package.json'))('@deepseek-ai/schemastery')
  : localRequire('@deepseek-ai/schemastery');
const z = schemastery.default ?? schemastery;

// `phrases` is keyed by language id; a plain string[] is still accepted as a
// single unnamed list for backwards compatibility.
const pack = z.object({
  phrases: z.union([z.array(z.string()), z.dict(z.array(z.string()))]).required(),
  intervalMs: z.number().min(100).default(8000),
});

export const Config = z.object({ pack: z.union([z.const(false), pack]).default(false).volatile() });

export function apply(ctx) {
  ctx.inject(['settings'], scope => scope.effect(
    () => scope.settings.configure({ auto: false }, ctx.fiber),
  ));
}
