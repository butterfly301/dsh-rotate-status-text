window.__ModuleLoader__.load({
  id: 'dsh-rotate-status-text',
  factory(require) {
    const React = typeof require === 'function'
      ? (() => { try { return require('react'); } catch { return null; } })()
      : null;
    const NS = 'dsh-rotate-status-text';
    const TURN_STATE_ROUTE = '/rotate-status-text/turn-state';
    const OVERRIDE_EVENT = 'dsh:status-text:override';
    const SHAKE_EVENT = 'dsh:window-shake';
    const DEFAULT_THRESHOLDS = [30, 60];
    const DEFAULT_TTL_MS = 5000;
    const POLL_MS = 2000;
    const STAGE_ATTR = 'data-dsh-status-stage';
    const STAGE_STYLE_ID = 'dsh-rotate-status-text-stage-colors';
    const DEFAULT_STAGE_COLORS = Object.freeze({
      light: Object.freeze({
        start: '#0284c7',
        progress: '#1d4ed8',
        long: '#ea580c',
      }),
      dark: Object.freeze({
        start: '#38bdf8',
        progress: '#60a5fa',
        long: '#fb923c',
      }),
    });

    // The keys the chat running-status line is rendered through. The framework
    // builds `t` with ctx.locale.bind(ns), and that bound function resolves
    // `this.translate(ns, key, params)` at call time — so shadowing translate on
    // the locale service instance rewrites exactly these keys at render time.
    const STATUS_KEYS = [
      'chat.deepDiving',
      'chat.deepDivingFor',
      'message.turnProcess.deepDivingFor',
    ];
    const PLACEHOLDER = '{duration}';

    function isStatusKey(key) {
      return STATUS_KEYS.indexOf(key) !== -1;
    }

    function renderPhrase(phrase, params) {
      if (phrase.indexOf(PLACEHOLDER) === -1) return phrase;
      const duration = params && typeof params.duration === 'string' ? params.duration : '';
      return phrase.split(PLACEHOLDER).join(duration);
    }

    // Pick by a wall-clock window so all re-renders within one window show the
    // same phrase (no flicker), and the phrase advances once per interval.
    function pickIndex(length, intervalMs, now = Date.now()) {
      if (length <= 1) return 0;
      const bucket = Math.floor(now / intervalMs);
      return ((bucket % length) + length) % length;
    }

    const primary = (lang) => String(lang ?? '').split(/[-_]/)[0].toLowerCase();

    /**
     * Pick a value from a `{ [langId]: value }` map with no language hardcoded:
     * exact id, then matching primary BCP-47 subtag, then English (`en` / `en-*`),
     * then the first entry.
     */
    function pickLocalized(map, active) {
      if (!map || typeof map !== 'object') return undefined;
      if (active && map[active] !== undefined) return map[active];
      const want = primary(active);
      if (want) {
        for (const [id, value] of Object.entries(map)) {
          if (primary(id) === want) return value;
        }
      }
      if (map.en !== undefined) return map.en;
      for (const [id, value] of Object.entries(map)) {
        if (primary(id) === 'en') return value;
      }
      return Object.values(map)[0];
    }

    /** Read the active language id from the locale service snapshot. */
    function readActive(locale) {
      try {
        const snap = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined;
        return snap && (snap.active ?? snap.locale ?? snap.preference);
      } catch {
        return undefined;
      }
    }

    function filterStrings(list) {
      return Array.isArray(list)
        ? list.filter((item) => typeof item === 'string' && item.length > 0)
        : [];
    }

    function normalizeThresholds(raw) {
      if (!Array.isArray(raw) || raw.length !== 2) return DEFAULT_THRESHOLDS;
      const first = Number(raw[0]);
      const second = Number(raw[1]);
      if (!Number.isInteger(first) || !Number.isInteger(second)) return DEFAULT_THRESHOLDS;
      if (first <= 0 || second <= first) return DEFAULT_THRESHOLDS;
      return [first, second];
    }

    function hasAnySegmentPhrase(entry) {
      return Boolean(
        entry
        && (entry.start.length > 0 || entry.progress.length > 0 || entry.long.length > 0),
      );
    }

    /** Normalize legacy flat arrays and segmented `{ start, progress, long }` packs. */
    function normalizePack(value) {
      if (!value || typeof value !== 'object') return undefined;
      const raw = value.phrases;
      const phrases = {};
      if (Array.isArray(raw)) {
        const list = filterStrings(raw);
        if (list.length) phrases[''] = { start: [], progress: list, long: [] };
      } else if (raw && typeof raw === 'object') {
        for (const [id, entry] of Object.entries(raw)) {
          if (Array.isArray(entry)) {
            const list = filterStrings(entry);
            if (list.length) phrases[id] = { start: [], progress: list, long: [] };
          } else if (entry && typeof entry === 'object') {
            const seg = {
              start: filterStrings(entry.start),
              progress: filterStrings(entry.progress),
              long: filterStrings(entry.long),
            };
            if (hasAnySegmentPhrase(seg)) phrases[id] = seg;
          }
        }
      }
      if (!Object.values(phrases).some(hasAnySegmentPhrase)) return undefined;
      const intervalMs = typeof value.intervalMs === 'number' && value.intervalMs >= 100
        ? value.intervalMs
        : 8000;
      const thresholds = normalizeThresholds(value.thresholds);
      const shakePhrases = {};
      if (value.shakePhrases && typeof value.shakePhrases === 'object' && !Array.isArray(value.shakePhrases)) {
        for (const [id, list] of Object.entries(value.shakePhrases)) {
          const filtered = filterStrings(list);
          if (filtered.length) shakePhrases[id] = filtered;
        }
      }
      const stageColors = normalizeStageColors(value.stageColors);
      return { phrases, intervalMs, thresholds, shakePhrases, stageColors };
    }

    function normalizeThemeColors(raw, fallback) {
      const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const pick = (key) => (typeof src[key] === 'string' && src[key].trim() ? src[key].trim() : fallback[key]);
      return {
        start: pick('start'),
        progress: pick('progress'),
        long: pick('long'),
      };
    }

    function normalizeStageColors(raw) {
      if (raw === false) return null;
      const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      return {
        light: normalizeThemeColors(src.light, DEFAULT_STAGE_COLORS.light),
        dark: normalizeThemeColors(src.dark, DEFAULT_STAGE_COLORS.dark),
      };
    }

    function applyStageAttribute(stage) {
      if (typeof document === 'undefined' || !document.documentElement) return;
      if (stage) {
        document.documentElement.setAttribute(STAGE_ATTR, stage);
      } else {
        document.documentElement.removeAttribute(STAGE_ATTR);
      }
    }

    function installStageStyles(stageColors) {
      if (typeof document === 'undefined' || !document.documentElement) return () => {};
      const rootStyle = document.documentElement.style;
      const vars = [
        '--dsh-status-start-light',
        '--dsh-status-progress-light',
        '--dsh-status-long-light',
        '--dsh-status-start-dark',
        '--dsh-status-progress-dark',
        '--dsh-status-long-dark',
      ];
      const clearVars = () => {
        for (const v of vars) rootStyle?.removeProperty?.(v);
      };
      if (!stageColors) {
        document.getElementById?.(STAGE_STYLE_ID)?.remove?.();
        clearVars();
        applyStageAttribute(null);
        return () => {};
      }
      rootStyle?.setProperty?.('--dsh-status-start-light', stageColors.light.start);
      rootStyle?.setProperty?.('--dsh-status-progress-light', stageColors.light.progress);
      rootStyle?.setProperty?.('--dsh-status-long-light', stageColors.light.long);
      rootStyle?.setProperty?.('--dsh-status-start-dark', stageColors.dark.start);
      rootStyle?.setProperty?.('--dsh-status-progress-dark', stageColors.dark.progress);
      rootStyle?.setProperty?.('--dsh-status-long-dark', stageColors.dark.long);
      if (document.head) {
        let style = document.getElementById?.(STAGE_STYLE_ID);
        if (!style) {
          style = document.createElement('style');
          style.id = STAGE_STYLE_ID;
          style.setAttribute('data-plugin', NS);
          style.textContent = [
            `:root[${STAGE_ATTR}="start"] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="start"] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-start-light); transition: color .3s ease; }`,
            `:root[${STAGE_ATTR}="progress"] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="progress"] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-progress-light); transition: color .3s ease; }`,
            `:root[${STAGE_ATTR}="long"] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="long"] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-long-light); transition: color .3s ease; }`,
            `:root[${STAGE_ATTR}="start"] body[data-ds-dark-theme] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="start"] body[data-ds-dark-theme] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-start-dark); transition: color .3s ease; }`,
            `:root[${STAGE_ATTR}="progress"] body[data-ds-dark-theme] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="progress"] body[data-ds-dark-theme] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-progress-dark); transition: color .3s ease; }`,
            `:root[${STAGE_ATTR}="long"] body[data-ds-dark-theme] [data-chat-running="true"],`,
            `:root[${STAGE_ATTR}="long"] body[data-ds-dark-theme] [data-chat-running="true"] > span:not([role="status"]) { color: var(--dsh-status-long-dark); transition: color .3s ease; }`,
          ].join('\n');
          document.head.appendChild(style);
        }
      }
      return () => {
        document.getElementById?.(STAGE_STYLE_ID)?.remove?.();
        clearVars();
        applyStageAttribute(null);
      };
    }

    function segmentForElapsed(elapsedSec, thresholds) {
      if (elapsedSec < thresholds[0]) return 'start';
      if (elapsedSec < thresholds[1]) return 'progress';
      return 'long';
    }

    function pickSegmentList(entry, segment) {
      if (!entry || typeof entry !== 'object') return [];
      if (Array.isArray(entry[segment]) && entry[segment].length > 0) return entry[segment];
      if (Array.isArray(entry.progress) && entry.progress.length > 0) return entry.progress;
      if (Array.isArray(entry.start) && entry.start.length > 0) return entry.start;
      if (Array.isArray(entry.long) && entry.long.length > 0) return entry.long;
      return [];
    }

    function createSessionStateTracker(ctx) {
      let activeSessionId = null;
      const turnCache = new Map();
      const displayState = new Map();
      const overrides = new Map();
      let lastStatusSeenAt = 0;
      let pollTimer = 0;

      function sessionKey(sessionId = activeSessionId) {
        return sessionId || '__default__';
      }

      function purgeExpiredOverrides(now) {
        for (const [key, item] of overrides.entries()) {
          if (item.expiresAt > 0 && item.expiresAt <= now) {
            overrides.delete(key);
          }
        }
      }

      function setOverride(detail, now = Date.now()) {
        if (!detail || typeof detail !== 'object') return;
        const source = typeof detail.source === 'string' && detail.source ? detail.source : 'default';
        const targetSession = typeof detail.sessionId === 'string' && detail.sessionId ? detail.sessionId : '*';
        const mapKey = `${targetSession}::${source}`;
        if (detail.clear === true) {
          overrides.delete(mapKey);
          return;
        }
        const priority = typeof detail.priority === 'number' && Number.isFinite(detail.priority)
          ? detail.priority
          : 30;
        const ttlMs = detail.ttlMs === 0 || detail.ttlMs === null
          ? 0
          : (typeof detail.ttlMs === 'number' && detail.ttlMs > 0 ? detail.ttlMs : DEFAULT_TTL_MS);
        const interleaveEvery = typeof detail.interleaveEvery === 'number' && detail.interleaveEvery > 1
          ? Math.trunc(detail.interleaveEvery)
          : 0;
        if (!detail.text) return;
        overrides.set(mapKey, {
          source,
          sessionId: targetSession,
          priority,
          text: detail.text,
          interleaveEvery,
          expiresAt: ttlMs > 0 ? now + ttlMs : 0,
          updatedAt: now,
        });
      }

      function pickActiveOverride(sessionId, activeLang, intervalMs, now = Date.now()) {
        purgeExpiredOverrides(now);
        const bucket = Math.floor(now / intervalMs);
        let winner = null;
        for (const item of overrides.values()) {
          if (item.sessionId !== '*' && item.sessionId !== sessionId) continue;
          if (item.interleaveEvery > 0 && ((bucket % item.interleaveEvery) + item.interleaveEvery) % item.interleaveEvery === 0) {
            continue;
          }
          if (!winner || item.priority > winner.priority || (item.priority === winner.priority && item.updatedAt > winner.updatedAt)) {
            winner = item;
          }
        }
        if (!winner) return undefined;
        let resolved = winner.text;
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          resolved = pickLocalized(resolved, activeLang);
        }
        if (Array.isArray(resolved)) {
          const list = filterStrings(resolved);
          if (!list.length) return undefined;
          return list[pickIndex(list.length, intervalMs, now)];
        }
        return typeof resolved === 'string' && resolved.length > 0 ? resolved : undefined;
      }

      function updateHostTurnState(sessionId, payload, now = Date.now(), requestStartedAt = now) {
        if (!sessionId || !payload || payload.ok !== true) return;
        const prev = turnCache.get(sessionId);
        if (payload.turnOpen === true && typeof payload.turnStartAt === 'number' && Number.isFinite(payload.turnStartAt)) {
          turnCache.set(sessionId, {
            turnOpen: true,
            turnStartAt: payload.turnStartAt,
            provisional: false,
            fetchedAt: now,
          });
        } else if (payload.turnOpen === false) {
          if (prev?.provisional && requestStartedAt < prev.turnStartAt) return;
          turnCache.set(sessionId, {
            turnOpen: false,
            turnStartAt: null,
            provisional: false,
            fetchedAt: now,
          });
          if (prev?.turnOpen) {
            displayState.delete(sessionKey(sessionId));
          }
        }
      }

      function getTurnEntry(sessionId, now = Date.now()) {
        const key = sessionKey(sessionId);
        let entry = turnCache.get(key);
        if (entry?.turnOpen && typeof entry.turnStartAt === 'number') {
          return entry;
        }
        if (!entry || entry.turnOpen === false) {
          entry = {
            turnOpen: true,
            turnStartAt: now,
            provisional: true,
            fetchedAt: 0,
          };
          turnCache.set(key, entry);
        }
        return entry;
      }

      function selectEntry(pack, activeLang, now = Date.now()) {
        lastStatusSeenAt = now;
        const key = sessionKey(activeSessionId);
        const overrideText = pickActiveOverride(activeSessionId || '*', activeLang, pack.intervalMs, now);
        if (overrideText !== undefined) return { text: overrideText, stage: null };

        const langEntry = pickLocalized(pack.phrases, activeLang);
        if (!langEntry) return { text: undefined, stage: null };

        const turnEntry = getTurnEntry(activeSessionId, now);
        const turnStartAt = turnEntry.turnStartAt;
        const elapsedSec = Math.max(0, (now - turnStartAt) / 1000);
        const targetSegment = segmentForElapsed(elapsedSec, pack.thresholds);
        const bucket = Math.floor(now / pack.intervalMs);

        let view = displayState.get(key);
        const upgradedFromProvisional = Boolean(view && view.wasProvisional && !turnEntry.provisional);
        if (!view || view.turnStartAt !== turnStartAt || upgradedFromProvisional) {
          view = {
            turnStartAt,
            lastBucket: bucket,
            lockedSegment: targetSegment,
            wasProvisional: Boolean(turnEntry.provisional),
          };
          displayState.set(key, view);
        } else if (bucket !== view.lastBucket) {
          // Cross-segment transitions wait for the next rotation bucket to prevent flicker.
          view.lastBucket = bucket;
          view.lockedSegment = targetSegment;
        }

        const list = pickSegmentList(langEntry, view.lockedSegment);
        if (!list.length) return { text: undefined, stage: null };
        return {
          text: list[pickIndex(list.length, pack.intervalMs, now)],
          stage: view.lockedSegment,
        };
      }

      function selectPhrase(pack, activeLang, now = Date.now()) {
        return selectEntry(pack, activeLang, now).text;
      }

      function fetchTurnState(sessionId) {
        if (!sessionId || typeof fetch !== 'function') return;
        const startedAt = Date.now();
        fetch(`${TURN_STATE_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
          .then((res) => (res && res.ok ? res.json() : null))
          .then((payload) => {
            if (payload) updateHostTurnState(sessionId, payload, Date.now(), startedAt);
          })
          .catch(() => {});
      }

      function setActiveSessionId(nextId) {
        const normalized = typeof nextId === 'string' && nextId ? nextId : null;
        if (normalized === activeSessionId) return;
        activeSessionId = normalized;
        if (normalized) fetchTurnState(normalized);
      }

      function schedulePoll() {
        if (pollTimer !== 0) return;
        pollTimer = setInterval(() => {
          if (!activeSessionId) return;
          const now = Date.now();
          const entry = turnCache.get(activeSessionId);
          if (entry?.turnOpen || now - lastStatusSeenAt < 10_000) {
            fetchTurnState(activeSessionId);
          }
        }, POLL_MS);
      }

      function isActiveRunning(now = Date.now()) {
        if (now - lastStatusSeenAt < 2500) return true;
        if (!activeSessionId) return false;
        const entry = turnCache.get(activeSessionId);
        return Boolean(entry && entry.turnOpen === true && entry.provisional !== true);
      }

      function dispose() {
        if (pollTimer !== 0) {
          clearInterval(pollTimer);
          pollTimer = 0;
        }
        turnCache.clear();
        displayState.clear();
        overrides.clear();
      }

      return {
        setActiveSessionId,
        setOverride,
        updateHostTurnState,
        selectEntry,
        selectPhrase,
        schedulePoll,
        isActiveRunning,
        dispose,
        get activeSessionId() { return activeSessionId; },
      };
    }

    /**
     * Shadow the locale service's translate method. Returns a restore function
     * that puts the original descriptor back — called from the effect cleanup
     * so disabling/unloading leaves no trace.
     */
    function installOverride(locale, getPack, tracker) {
      if (!locale || typeof locale.translate !== 'function') return () => {};

      let holder = locale;
      let own = Object.getOwnPropertyDescriptor(holder, 'translate');
      const original = locale.translate;
      let active = true;

      const patched = function (ns, key, params) {
        if (active && isStatusKey(key)) {
          const pack = getPack();
          if (pack && pack.phrases) {
            const entry = tracker.selectEntry(pack, readActive(locale));
            applyStageAttribute(pack.stageColors ? entry.stage : null);
            if (typeof entry.text === 'string') return renderPhrase(entry.text, params);
          } else {
            applyStageAttribute(null);
          }
        }
        return original.apply(this === undefined ? locale : this, [ns, key, params]);
      };

      try {
        Object.defineProperty(holder, 'translate', {
          value: patched,
          writable: true,
          configurable: true,
          enumerable: own !== undefined && own.enumerable === true,
        });
      } catch (error) {
        holder = Object.getPrototypeOf(locale);
        if (!holder || typeof holder.translate !== 'function') throw error;
        own = Object.getOwnPropertyDescriptor(holder, 'translate');
        try {
          Object.defineProperty(holder, 'translate', {
            value: patched,
            writable: true,
            configurable: true,
            enumerable: own !== undefined && own.enumerable === true,
          });
        } catch {
          holder.translate = patched;
        }
      }

      return function restore() {
        if (!active) return;
        active = false;
        if (holder.translate === patched) {
          if (own === undefined) delete holder.translate;
          else Object.defineProperty(holder, 'translate', own);
        }
      };
    }

    function readSelectedSessionId(sessions) {
      try {
        const byId = sessions?.list?.getSnapshot?.()?.byId;
        if (!byId || typeof byId !== 'object') return null;
        const selected = Object.values(byId).filter((s) => s && s.retainedBy?.mainView > 0);
        return selected.length === 1 ? selected[0].id : null;
      } catch {
        return null;
      }
    }

    const ROTATE_COPY = {
      zh: {
        nav: '状态短句轮换',
        title: '状态短句轮换',
        hint: '按等待时长分段轮换运行状态文案；修改后点保存立即生效。',
        enabled: '启用状态短句轮换',
        interval: '轮换间隔（毫秒）',
        t1: '起步切推进（秒）',
        t2: '推进切漫长（秒）',
        invalidThresholds: '分段秒数必须是正整数，且第二边界大于第一边界。',
        lang: '编辑语种',
        addLangPlaceholder: '新增语言 ID（如 ja）',
        addLang: '添加语种',
        start: '起步阶段（每行一句）',
        progress: '推进阶段（每行一句）',
        long: '漫长阶段（每行一句）',
        shake: '窗口摇晃吐槽（每行一句）',
        stageColors: '分段状态颜色',
        lightColors: '浅色主题颜色',
        darkColors: '深色主题颜色',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        loading: '加载中…',
      },
      en: {
        nav: 'Status phrase rotation',
        title: 'Status phrase rotation',
        hint: 'Rotates running-status phrases by turn wait phase. Click Save to apply live.',
        enabled: 'Enable status phrase rotation',
        interval: 'Rotation interval (ms)',
        t1: 'Start -> Progress (sec)',
        t2: 'Progress -> Long (sec)',
        invalidThresholds: 'Thresholds must be positive integers with the second greater than the first.',
        lang: 'Editing language',
        addLangPlaceholder: 'Add lang ID (e.g. ja)',
        addLang: 'Add language',
        start: 'Opening phase (one per line)',
        progress: 'Cruising phase (one per line)',
        long: 'Long-haul phase (one per line)',
        shake: 'Window-shake quips (one per line)',
        stageColors: 'Stage text colors',
        lightColors: 'Light theme colors',
        darkColors: 'Dark theme colors',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        loading: 'Loading…',
      },
    };

    const ROTATE_CSS = `
.rs-panel { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.rs-card { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: var(--dsw-alias-bg-layer-1); border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.rs-title { font-weight: 600; }
.rs-hint { color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.rs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.rs-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 640px) { .rs-grid { grid-template-columns: 1fr; } }
.rs-field { display: flex; flex-direction: column; gap: 4px; }
.rs-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.rs-panel input[type=text], .rs-panel input[type=number], .rs-panel select, .rs-panel textarea {
  font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 6px 8px; box-sizing: border-box; width: 100%;
}
.rs-panel textarea { min-height: 68px; resize: vertical; line-height: 20px; }
.rs-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rs-inline > input, .rs-inline > select { width: auto; flex: 1 1 160px; }
.rs-btn {
  padding: 6px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
.rs-save {
  align-self: flex-start; padding: 7px 18px; border: none; border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-button-primary-text, #fff); font: inherit; font-weight: 600; cursor: pointer;
}
.rs-save:disabled { opacity: .6; cursor: not-allowed; }
.rs-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; }
`;

    function parseLines(raw) {
      return String(raw ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    function createRotateSettingsComponent(R) {
      const { useState, useEffect, useRef } = R;
      const h = R.createElement;

      function copyOf(locale) {
        const active = readActive(locale) || '';
        return primary(active) === 'zh' ? ROTATE_COPY.zh : ROTATE_COPY.en;
      }

      function toEditablePack(rawPack) {
        if (!rawPack || typeof rawPack !== 'object') return null;
        const norm = normalizePack(rawPack);
        const phrases = {};
        if (rawPack.phrases && typeof rawPack.phrases === 'object' && !Array.isArray(rawPack.phrases)) {
          for (const [id, entry] of Object.entries(rawPack.phrases)) {
            if (Array.isArray(entry)) {
              phrases[id] = { start: [], progress: filterStrings(entry), long: [] };
            } else if (entry && typeof entry === 'object') {
              phrases[id] = {
                start: filterStrings(entry.start),
                progress: filterStrings(entry.progress),
                long: filterStrings(entry.long),
              };
            }
          }
        }
        return {
          intervalMs: norm ? norm.intervalMs : (typeof rawPack.intervalMs === 'number' ? rawPack.intervalMs : 8000),
          thresholds: norm ? [...norm.thresholds] : [...DEFAULT_THRESHOLDS],
          phrases,
          shakePhrases: norm ? { ...norm.shakePhrases } : {},
          stageColors: rawPack.stageColors === false ? false : normalizeStageColors(rawPack.stageColors),
        };
      }

      function defaultEmptyPack() {
        return {
          intervalMs: 8000,
          thresholds: [30, 60],
          phrases: { zh: { start: [], progress: [], long: [] }, en: { start: [], progress: [], long: [] } },
          shakePhrases: {},
          stageColors: normalizeStageColors({}),
        };
      }

      return function RotateSettingsPanel({ form, locale, savePack }) {
        const [snap, setSnap] = useState(() => form.getSnapshot());
        const [draftPack, setDraftPack] = useState(null);
        const [hasDraft, setHasDraft] = useState(false);
        const [selectedLang, setSelectedLang] = useState('');
        const [newLang, setNewLang] = useState('');
        const [textDrafts, setTextDrafts] = useState({});
        const [thresholdDrafts, setThresholdDrafts] = useState(null);
        const [intervalDraft, setIntervalDraft] = useState(null);
        const [saving, setSaving] = useState(false);
        const [savedFlag, setSavedFlag] = useState(false);
        const [error, setError] = useState('');
        const [, setLangTick] = useState(0);
        const dirtyRef = useRef(false);
        const cacheRef = useRef(null);
        const copy = copyOf(locale);

        useEffect(() => {
          const unsubForm = form.subscribe(() => {
            const next = form.getSnapshot();
            setSnap(next);
            if (!dirtyRef.current && next.status === 'ready') {
              setDraftPack(null);
              setHasDraft(false);
              setTextDrafts({});
              setThresholdDrafts(null);
              setIntervalDraft(null);
            }
          });
          const unsubLocale = typeof locale?.subscribe === 'function'
            ? locale.subscribe(() => setLangTick((v) => v + 1))
            : undefined;
          return () => {
            try { unsubForm?.(); } catch {}
            try { unsubLocale?.(); } catch {}
          };
        }, [form, locale]);

        if (!snap || snap.status === 'loading') {
          return h('div', { className: 'rs-panel' }, h('div', { className: 'rs-hint' }, copy.loading));
        }

        const currentPack = hasDraft ? draftPack : toEditablePack(snap.value?.pack);
        const basePack = toEditablePack(snap.base?.pack);
        const enabled = Boolean(currentPack);

        const langKeys = currentPack
          ? [...new Set([...Object.keys(currentPack.phrases || {}), ...Object.keys(currentPack.shakePhrases || {}), ...Object.keys(textDrafts)])]
          : [];
        const activeLang = langKeys.includes(selectedLang)
          ? selectedLang
          : (langKeys.find((id) => primary(id) === primary(readActive(locale))) || langKeys[0] || '');

        const markDirty = (nextPack) => {
          dirtyRef.current = true;
          setHasDraft(true);
          setDraftPack(nextPack);
          setSavedFlag(false);
        };

        const toggleEnabled = (on) => {
          if (!on) {
            if (currentPack) cacheRef.current = currentPack;
            markDirty(false);
            return;
          }
          markDirty(cacheRef.current || basePack || defaultEmptyPack());
        };

        const activeEntry = (currentPack && activeLang && currentPack.phrases?.[activeLang]) || { start: [], progress: [], long: [] };
        const activeShake = (currentPack && activeLang && currentPack.shakePhrases?.[activeLang]) || [];
        const activeDraft = (activeLang && textDrafts[activeLang]) || {};

        const textOf = (field, fallbackArr) => (
          Object.prototype.hasOwnProperty.call(activeDraft, field)
            ? activeDraft[field]
            : (Array.isArray(fallbackArr) ? fallbackArr.join('\n') : '')
        );

        const editText = (field, value) => {
          if (!currentPack || !activeLang) return;
          dirtyRef.current = true;
          setHasDraft(true);
          if (!draftPack) setDraftPack(currentPack);
          setSavedFlag(false);
          setTextDrafts((prev) => ({
            ...prev,
            [activeLang]: { ...(prev[activeLang] || {}), [field]: String(value) },
          }));
        };

        const addLanguage = () => {
          const id = newLang.trim();
          if (!id || !currentPack) return;
          if (!currentPack.phrases[id]) {
            markDirty({
              ...currentPack,
              phrases: { ...currentPack.phrases, [id]: { start: [], progress: [], long: [] } },
            });
          }
          setSelectedLang(id);
          setNewLang('');
        };

        const commit = async () => {
          setSaving(true);
          setError('');
          try {
            let payload = false;
            if (currentPack) {
              const phrases = { ...currentPack.phrases };
              const shakePhrases = { ...currentPack.shakePhrases };
              for (const [id, d] of Object.entries(textDrafts)) {
                const prev = phrases[id] || { start: [], progress: [], long: [] };
                phrases[id] = {
                  start: Object.prototype.hasOwnProperty.call(d, 'start') ? parseLines(d.start) : prev.start,
                  progress: Object.prototype.hasOwnProperty.call(d, 'progress') ? parseLines(d.progress) : prev.progress,
                  long: Object.prototype.hasOwnProperty.call(d, 'long') ? parseLines(d.long) : prev.long,
                };
                if (Object.prototype.hasOwnProperty.call(d, 'shake')) {
                  const list = parseLines(d.shake);
                  if (list.length) shakePhrases[id] = list;
                  else delete shakePhrases[id];
                }
              }
              const rawT = thresholdDrafts || currentPack.thresholds;
              const t1 = Number(String(rawT[0]).trim());
              const t2 = Number(String(rawT[1]).trim());
              if (!Number.isInteger(t1) || !Number.isInteger(t2) || t1 <= 0 || t2 <= t1) {
                throw new Error(copy.invalidThresholds);
              }
              const rawInt = intervalDraft !== null ? Number(String(intervalDraft).trim()) : currentPack.intervalMs;
              const intervalMs = Number.isFinite(rawInt) && rawInt >= 100 ? Math.round(rawInt) : 8000;
              payload = {
                intervalMs,
                thresholds: [t1, t2],
                phrases,
                shakePhrases,
                stageColors: currentPack.stageColors,
              };
            }
            await savePack(payload, snap.revision);
            dirtyRef.current = false;
            setHasDraft(false);
            setDraftPack(null);
            setTextDrafts({});
            setThresholdDrafts(null);
            setIntervalDraft(null);
            setSavedFlag(true);
          } catch (err) {
            setError(err?.message || String(err));
          } finally {
            setSaving(false);
          }
        };

        const intervalVal = intervalDraft !== null ? intervalDraft : String(currentPack?.intervalMs ?? 8000);
        const tVals = thresholdDrafts || [String(currentPack?.thresholds?.[0] ?? 30), String(currentPack?.thresholds?.[1] ?? 60)];
        const colorsOn = Boolean(currentPack && currentPack.stageColors && typeof currentPack.stageColors === 'object');

        return h('div', { className: 'rs-panel' },
          error ? h('div', { className: 'rs-error' }, error) : null,
          h('div', { className: 'rs-card' },
            h('div', { className: 'rs-title' }, copy.title),
            h('div', { className: 'rs-hint' }, copy.hint),
            h('div', { className: 'rs-row' },
              h('span', null, copy.enabled),
              h('input', { type: 'checkbox', checked: enabled, 'aria-label': copy.enabled, onChange: (e) => toggleEnabled(e.target.checked) }))),
          currentPack ? h('div', { className: 'rs-card' },
            h('div', { className: 'rs-grid' },
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.interval),
                h('input', {
                  type: 'number', min: 100, step: 100, value: intervalVal,
                  onChange: (e) => {
                    dirtyRef.current = true; setHasDraft(true); setSavedFlag(false);
                    if (!draftPack) setDraftPack(currentPack);
                    setIntervalDraft(e.target.value);
                  },
                })),
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.t1),
                h('input', {
                  type: 'number', min: 1, step: 1, value: tVals[0],
                  onChange: (e) => {
                    dirtyRef.current = true; setHasDraft(true); setSavedFlag(false);
                    if (!draftPack) setDraftPack(currentPack);
                    setThresholdDrafts([e.target.value, tVals[1]]);
                  },
                })),
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.t2),
                h('input', {
                  type: 'number', min: 2, step: 1, value: tVals[1],
                  onChange: (e) => {
                    dirtyRef.current = true; setHasDraft(true); setSavedFlag(false);
                    if (!draftPack) setDraftPack(currentPack);
                    setThresholdDrafts([tVals[0], e.target.value]);
                  },
                }))),
            h('div', { className: 'rs-inline' },
              h('span', { className: 'rs-label' }, copy.lang),
              h('select', { value: activeLang, onChange: (e) => setSelectedLang(e.target.value) },
                langKeys.map((id) => h('option', { key: id, value: id }, id))),
              h('input', {
                type: 'text', placeholder: copy.addLangPlaceholder, value: newLang,
                onChange: (e) => setNewLang(e.target.value),
              }),
              h('button', { type: 'button', className: 'rs-btn', onClick: addLanguage }, copy.addLang)),
            activeLang ? h(R.Fragment, null,
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.start),
                h('textarea', { value: textOf('start', activeEntry.start), onChange: (e) => editText('start', e.target.value) })),
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.progress),
                h('textarea', { value: textOf('progress', activeEntry.progress), onChange: (e) => editText('progress', e.target.value) })),
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.long),
                h('textarea', { value: textOf('long', activeEntry.long), onChange: (e) => editText('long', e.target.value) })),
              h('div', { className: 'rs-field' },
                h('span', { className: 'rs-label' }, copy.shake),
                h('textarea', { value: textOf('shake', activeShake), onChange: (e) => editText('shake', e.target.value) }))) : null,
            h('div', { className: 'rs-row' },
              h('span', null, copy.stageColors),
              h('input', {
                type: 'checkbox',
                checked: colorsOn,
                'aria-label': copy.stageColors,
                onChange: (e) => markDirty({ ...currentPack, stageColors: e.target.checked ? normalizeStageColors({}) : false }),
              })),
            colorsOn ? h('div', { className: 'rs-grid' },
              ['start', 'progress', 'long'].map((seg) => h('div', { className: 'rs-field', key: seg },
                h('span', { className: 'rs-label' }, `${copy.lightColors} · ${seg}`),
                h('input', {
                  type: 'text',
                  value: currentPack.stageColors.light[seg] || '',
                  onChange: (e) => markDirty({
                    ...currentPack,
                    stageColors: {
                      ...currentPack.stageColors,
                      light: { ...currentPack.stageColors.light, [seg]: e.target.value },
                    },
                  }),
                }))),
              ['start', 'progress', 'long'].map((seg) => h('div', { className: 'rs-field', key: `dark-${seg}` },
                h('span', { className: 'rs-label' }, `${copy.darkColors} · ${seg}`),
                h('input', {
                  type: 'text',
                  value: currentPack.stageColors.dark[seg] || '',
                  onChange: (e) => markDirty({
                    ...currentPack,
                    stageColors: {
                      ...currentPack.stageColors,
                      dark: { ...currentPack.stageColors.dark, [seg]: e.target.value },
                    },
                  }),
                })))) : null) : null,
          h('button', {
            type: 'button', className: 'rs-save', disabled: saving, onClick: commit,
          }, saving ? copy.saving : (savedFlag && !hasDraft ? copy.saved : copy.save)));
      };
    }

    return {
      inject: ['locale', 'configForms'],
      apply(ctx) {
        let stopSettingsUi;
        if (React && typeof ctx.inject === 'function') {
          const Panel = createRotateSettingsComponent(React);
          stopSettingsUi = ctx.inject(['slots', 'remote', 'remote.settings'], (scope) => {
            const mount = () => {
              const form = ctx.configForms.get(NS);
              const getLabel = () => (primary(readActive(ctx.locale)) === 'zh' ? ROTATE_COPY.zh.nav : ROTATE_COPY.en.nav);
              const savePack = async (packValue, revision) => {
                const settingsRemote = scope.remote?.settings;
                if (!settingsRemote) throw new Error('settingsRemoteUnavailable');
                const res = await settingsRemote.mutate(NS, [{ op: 'set', path: ['pack'], value: packValue }], revision);
                if (res.ok) {
                  ctx.configForms.describe?.().acceptView?.(res.value);
                } else {
                  await ctx.configForms.describe?.().load?.();
                  throw new Error(res.error?.message || res.error?.code || 'persistFailed');
                }
              };
              const regStop = scope.slots.inject('settings.section', () => scope.slots.register(
                { name: 'settings.section', id: NS, order: 90, label: getLabel },
                () => React.createElement(Panel, { form, locale: ctx.locale, savePack }),
              ));
              let styleEl = null;
              if (typeof document !== 'undefined' && document.head) {
                styleEl = document.createElement('style');
                styleEl.setAttribute('data-plugin', NS);
                styleEl.textContent = ROTATE_CSS;
                document.head.appendChild(styleEl);
              }
              return () => {
                try { regStop?.(); } catch {}
                try { styleEl?.remove(); } catch {}
              };
            };
            return typeof scope?.effect === 'function'
              ? scope.effect(mount, 'dsh-rotate-status-text: settings ui')
              : mount();
          });
        }

        const stopRotation = ctx.effect(() => {
          const form = ctx.configForms.get(NS);
          const tracker = createSessionStateTracker(ctx);
          tracker.schedulePoll();
          let currentPack;
          let restoreOverride;
          let cleanupStageStyles = () => {};

          const sync = () => {
            const { status, value } = form.getSnapshot();
            if (status === 'loading') return;
            const pack = status === 'ready' ? normalizePack(value && value.pack) : undefined;
            const revision = JSON.stringify(pack);
            if (revision === JSON.stringify(currentPack)) return;

            currentPack = pack;
            cleanupStageStyles();
            cleanupStageStyles = pack ? installStageStyles(pack.stageColors) : () => {};
            if (pack && !restoreOverride) {
              try {
                // getPack reads the live ref, so translate always sees the newest
                // config and active language without reinstalling the wrapper.
                restoreOverride = installOverride(ctx.locale, () => currentPack, tracker);
              } catch (error) {
                currentPack = undefined;
                cleanupStageStyles();
                cleanupStageStyles = () => {};
                console.error('[dsh-rotate-status-text] failed to install override:', error);
              }
            } else if (!pack && restoreOverride) {
              const previous = restoreOverride;
              restoreOverride = undefined;
              try {
                previous();
              } catch (error) {
                console.error('[dsh-rotate-status-text] failed to restore override:', error);
              }
            }
          };

          const onOverrideEvent = (event) => {
            tracker.setOverride(event?.detail, Date.now());
          };

          const onShakeEvent = () => {
            if (!currentPack || !currentPack.shakePhrases || !Object.keys(currentPack.shakePhrases).length) return;
            if (!tracker.isActiveRunning(Date.now())) return;
            tracker.setOverride({
              source: 'window-shake',
              sessionId: '*',
              priority: 30,
              ttlMs: DEFAULT_TTL_MS,
              text: currentPack.shakePhrases,
            }, Date.now());
          };

          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener(OVERRIDE_EVENT, onOverrideEvent);
            window.addEventListener(SHAKE_EVENT, onShakeEvent);
          }

          let stopSessions;
          if (typeof ctx.inject === 'function') {
            stopSessions = ctx.inject(['sessions'], (scope) => scope.effect(() => {
              const list = scope.sessions?.list;
              if (!list || typeof list.subscribe !== 'function') return undefined;
              const update = () => tracker.setActiveSessionId(readSelectedSessionId(scope.sessions));
              const unsub = list.subscribe(update);
              update();
              return () => { try { unsub?.(); } catch {} };
            }, 'dsh-rotate-status-text: active session'));
          }

          const unsubscribe = form.subscribe(sync);
          sync();
          return () => {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener(OVERRIDE_EVENT, onOverrideEvent);
              window.removeEventListener(SHAKE_EVENT, onShakeEvent);
            }
            try { stopSessions?.(); } catch {}
            try { cleanupStageStyles(); } catch {}
            try { unsubscribe(); } finally {
              tracker.dispose();
              if (restoreOverride) restoreOverride();
            }
          };
        }, 'dsh-rotate-status-text: status text rotation');

        return () => {
          try { stopSettingsUi?.(); } catch {}
          try { stopRotation?.(); } catch {}
        };
      },
    };
  },
});
