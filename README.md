# dsh-rotate-status-text

A generic DSH web client plugin that rotates the chat running-status line through a configured list of phrases. It ships with **no phrases of its own** — every string comes from the bundle configuration that mounts it, so any theme can supply its own wording.

## What it does

The chat running-status row renders its copy through `chat.deepDiving` / `chat.deepDivingFor` (and `message.turnProcess.deepDivingFor`). The framework builds `t` with `ctx.locale.bind(ns)`, and that bound function resolves `this.translate(ns, key, params)` at call time. This plugin shadows the locale service's `translate` method, so it can replace exactly those keys with a configured phrase while passing every other key straight through.

Phrases rotate on a wall-clock window: within one `intervalMs` window every re-render shows the same phrase, and the phrase advances at the next window. That avoids the flicker a per-call random pick would cause on a line that re-renders every second.

The overriding `translate` is installed inside an effect and restored in its cleanup. Disabling the theme or removing the config row puts the original method back — no file writes, no persistent user settings, no leftovers.

## Configuration

Mount the plugin from a bundle patch and give its row a `config.pack`:

```yaml
- insert:
    - id: dsh-rotate-status-text
      name: 'dsh-rotate-status-text'
      config:
        pack:
          intervalMs: 8000
          phrases:
            - 正在展开海图，研判航路…
            - 正在校准罗盘，锁定航向…
            - 正在观测星象，校准航位…
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `pack.phrases` | `string[]` | required | Candidate phrases, chosen in turn by time window |
| `pack.intervalMs` | `number` | `8000` | Window length in ms; minimum 100 |

A phrase may contain `{duration}`, which is replaced by the framework-supplied duration (e.g. `正在研判航路 {duration}`). A phrase without the placeholder is used verbatim.

Setting `pack` to `false` (or omitting it) leaves the shipped DSH copy untouched.

`config.pack` is declared `volatile()`: the plugin owns no persistent user settings and never writes configuration back.

## Design notes

- **Generic core, theme-owned content.** The plugin contains no theme-specific wording. The example phrases above are only illustration; a real theme supplies its own list.
- **Translate-layer override, not a dictionary.** A theme-supplied locale dictionary cannot reach the running-status component's own `t` binding. Overriding `translate` at the service level is what makes the copy actually render.
- **Clean lifecycle.** The wrapper is installed in `ctx.effect` and restored on cleanup (or when `pack` changes), so switching themes or editing config never leaves a stale override behind.

## Install

```powershell
dsh plugin --profile desktop add dsh-rotate-status-text
```

Or add `"dsh-rotate-status-text": "0.1.0"` to the profile's dependencies and include the row in a bundle patch as shown above.

## License

MIT
