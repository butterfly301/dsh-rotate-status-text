import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { foldTurnState } from '../host/turn-state.js';

const CLIENT_CODE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

function createHarness({ pack, initialTime = 1_000_000, turnMap = {}, withDom = false }) {
  let now = initialTime;
  const listeners = new Map();
  let sessionSubs = new Set();
  let selectedSessionId = 's1';
  let formValue = { pack };
  let activeLang = 'zh-pirate';
  const attrs = new Map();
  const cssVars = new Map();
  const nodes = new Map();
  const documentMock = withDom
    ? {
      documentElement: {
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.get(k) ?? null; },
        removeAttribute(k) { attrs.delete(k); },
        style: {
          setProperty(k, v) { cssVars.set(k, String(v)); },
          getPropertyValue(k) { return cssVars.get(k) || ''; },
          removeProperty(k) { cssVars.delete(k); },
        },
      },
      head: {
        appendChild(el) { if (el.id) nodes.set(el.id, el); },
      },
      getElementById(id) { return nodes.get(id) || null; },
      createElement(tag) {
        return {
          tagName: tag.toUpperCase(),
          id: '',
          textContent: '',
          setAttribute() {},
          remove() { if (this.id) nodes.delete(this.id); },
        };
      },
    }
    : undefined;

  const DateMock = class extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  };

  const windowMock = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
    },
  };

  let loadedModule = null;
  windowMock.__ModuleLoader__ = {
    load(mod) {
      loadedModule = mod;
    },
  };

  const fetchMock = async (url) => {
    const u = new URL(url, 'http://dsh.local');
    const sid = u.searchParams.get('sessionId');
    const state = turnMap[sid] || { ok: true, sessionId: sid, turnOpen: false, turnStartAt: null };
    return { ok: true, json: async () => state };
  };

  const sandbox = {
    window: windowMock,
    ...(documentMock ? { document: documentMock } : {}),
    Date: DateMock,
    fetch: fetchMock,
    URL,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    console,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  const locale = {
    getSnapshot: () => ({ active: activeLang }),
    translate: (_ns, key) => `NATIVE:${key}`,
  };
  const formSubs = new Set();
  const configForms = {
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: formValue }),
      subscribe: (fn) => {
        formSubs.add(fn);
        return () => formSubs.delete(fn);
      },
    }),
  };
  const sessions = {
    list: {
      getSnapshot: () => ({
        byId: selectedSessionId
          ? { [selectedSessionId]: { id: selectedSessionId, retainedBy: { mainView: 1 } } }
          : {},
      }),
      subscribe: (fn) => {
        sessionSubs.add(fn);
        return () => sessionSubs.delete(fn);
      },
    },
  };

  const cleanups = [];
  const ctx = {
    locale,
    configForms,
    sessions,
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
      return cleanup;
    },
    inject(deps, fn) {
      if (deps.includes('sessions')) return fn(ctx);
      return () => {};
    },
  };

  const plugin = loadedModule.factory();
  plugin.apply(ctx);

  return {
    locale,
    attrs,
    cssVars,
    nodes,
    setTime(t) { now = t; },
    advance(ms) { now += ms; },
    async selectSession(sid) {
      selectedSessionId = sid;
      for (const fn of sessionSubs) fn();
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    },
    setPack(nextPack) {
      formValue = { pack: nextPack };
      for (const fn of formSubs) fn();
    },
    dispatch(type, detail) {
      windowMock.dispatchEvent({ type, detail });
    },
    dispose() {
      for (const fn of cleanups.reverse()) fn?.();
    },
  };
}

test('foldTurnState tracks latest turn/start and clears on turn/end', () => {
  const events = [
    { type: 'turn/start', time: 1000 },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { type: 'turn/start', time: 5000 },
  ];
  const state = foldTurnState(undefined, {
    inheritedEventCount: 0,
    seq: events.length,
    eventAt: (i) => events[i],
  });
  assert.equal(state.turnOpen, true);
  assert.equal(state.turnStartAt, 5000);
});

test('segmented status phrases select start / progress / long by elapsed time and delay cross-segment switch until next bucket', async () => {
  const startAt = 1_000_000;
  const harness = createHarness({
    initialTime: startAt + 5_000,
    turnMap: {
      s1: { ok: true, sessionId: 's1', turnOpen: true, turnStartAt: startAt },
      s2: { ok: true, sessionId: 's2', turnOpen: true, turnStartAt: startAt - 85_000 },
    },
    pack: {
      intervalMs: 10_000,
      thresholds: [30, 60],
      phrases: {
        'zh-pirate': {
          start: ['起步句'],
          progress: ['推进句'],
          long: ['漫长句'],
        },
      },
    },
  });

  await harness.selectSession('s1');
  await Promise.resolve();

  // 5s elapsed -> start segment (bucket at 1_005_000 = 100)
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步句');

  // Jump to 31s (bucket 103) vs still in same bucket first:
  // Advance within same bucket 100 -> 1_009_000, and test custom threshold [8, 20]
  harness.setPack({
    intervalMs: 10_000,
    thresholds: [8, 20],
    phrases: {
      'zh-pirate': {
        start: ['起步句'],
        progress: ['推进句'],
        long: ['漫长句'],
      },
    },
  });
  harness.setTime(startAt + 9_000); // elapsed = 9s >= 8s, STILL bucket 100!
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步句');

  // Next rotation window (bucket 101) -> now switches to progress
  harness.setTime(startAt + 11_000);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '推进句');

  // Switch to session s2 (already 96s elapsed -> long)
  await harness.selectSession('s2');
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '漫长句');

  harness.dispose();
});

test('legacy flat phrases fall back into progress segment without error', async () => {
  const startAt = 1_000_000;
  const harness = createHarness({
    initialTime: startAt + 5_000,
    turnMap: { s1: { ok: true, sessionId: 's1', turnOpen: true, turnStartAt: startAt } },
    pack: {
      intervalMs: 10_000,
      phrases: {
        'zh-pirate': ['旧句一'],
      },
    },
  });
  await harness.selectSession('s1');
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '旧句一');
  harness.dispose();
});

test('override bus respects priority (temp > protest > normal) and 5s TTL expiration', async () => {
  const startAt = 1_000_000;
  const harness = createHarness({
    initialTime: startAt + 5_000,
    turnMap: { s1: { ok: true, sessionId: 's1', turnOpen: true, turnStartAt: startAt } },
    pack: {
      intervalMs: 10_000,
      thresholds: [30, 60],
      phrases: {
        'zh-pirate': { start: ['起步句'], progress: ['推进句'], long: ['漫长句'] },
      },
    },
  });
  await harness.selectSession('s1');

  // Low-morale protest at priority 20
  harness.dispatch('dsh:status-text:override', {
    source: 'morale-protest',
    sessionId: 's1',
    priority: 20,
    ttlMs: 0,
    text: { zh: '船员抗议中' },
  });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '船员抗议中');

  // Temp吐槽 at priority 30 overrides protest for 5000ms
  harness.dispatch('dsh:status-text:override', {
    source: 'rum',
    sessionId: 's1',
    priority: 30,
    ttlMs: 5000,
    text: { zh: '朗姆酒干杯' },
  });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '朗姆酒干杯');

  // After 5001ms, temp expires back to protest
  harness.advance(5001);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '船员抗议中');

  // Clear protest -> returns to normal segmented phrase
  harness.dispatch('dsh:status-text:override', {
    source: 'morale-protest',
    sessionId: 's1',
    clear: true,
  });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步句');

  harness.dispose();
});

test('window-shake flashes 5s temp phrase only when task is running', async () => {
  const startAt = 1_000_000;
  const harness = createHarness({
    initialTime: startAt + 5_000,
    turnMap: {
      s1: { ok: true, sessionId: 's1', turnOpen: false, turnStartAt: null },
    },
    pack: {
      intervalMs: 10_000,
      thresholds: [30, 60],
      phrases: {
        'zh-pirate': { start: ['起步句'], progress: ['推进句'], long: ['漫长句'] },
      },
      shakePhrases: {
        'zh-pirate': ['别晃了船长！'],
      },
    },
  });

  // Idle session -> shake is ignored (does not inject fake override)
  await harness.selectSession('s1');
  harness.dispatch('dsh:window-shake', { at: startAt + 5_000, durationMs: 4000 });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步句');

  // Running session (translate was just rendered so active running is true) -> shake flashes 5s
  harness.dispatch('dsh:window-shake', { at: startAt + 5_100, durationMs: 4000 });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '别晃了船长！');

  harness.advance(5001);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步句');

  harness.dispose();
});

test('stageColors applies default and theme override palettes, clears on event overrides, and restores on disable', async () => {
  const startAt = 1_000_000;
  const harness = createHarness({
    withDom: true,
    initialTime: startAt + 5_000,
    turnMap: {
      s1: { ok: true, sessionId: 's1', turnOpen: true, turnStartAt: startAt },
    },
    pack: {
      intervalMs: 10_000,
      thresholds: [25, 60],
      phrases: {
        'zh-pirate': { start: ['起步'], progress: ['推进'], long: ['漫长'] },
      },
    },
  });

  await harness.selectSession('s1');
  // Built-in defaults apply even without explicit stageColors in pack
  assert.equal(harness.cssVars.get('--dsh-status-start-light'), '#0284c7');
  assert.equal(harness.cssVars.get('--dsh-status-long-dark'), '#fb923c');
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'start');

  // Pirate theme override replaces palette colors
  harness.setPack({
    intervalMs: 10_000,
    thresholds: [25, 60],
    phrases: {
      'zh-pirate': { start: ['起步'], progress: ['推进'], long: ['漫长'] },
    },
    stageColors: {
      light: { start: '#0ea5e9', progress: '#1e40af', long: '#ea580c' },
      dark: { start: '#38bdf8', progress: '#60a5fa', long: '#fb923c' },
    },
  });
  assert.equal(harness.cssVars.get('--dsh-status-start-light'), '#0ea5e9');
  assert.equal(harness.cssVars.get('--dsh-status-progress-light'), '#1e40af');

  // Cross-segment waits for bucket switch, then transitions stage attribute together with text
  harness.setTime(startAt + 22_000);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'start');
  harness.setTime(startAt + 28_000);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '起步');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'start');
  harness.setTime(startAt + 30_000);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '推进');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'progress');

  // Event override clears stage color while displayed, then stage resumes once expired
  harness.dispatch('dsh:status-text:override', {
    source: 'rum',
    sessionId: 's1',
    priority: 30,
    ttlMs: 5000,
    text: { zh: '朗姆酒干杯' },
  });
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '朗姆酒干杯');
  assert.equal(harness.attrs.has('data-dsh-status-stage'), false);

  harness.advance(5001);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '推进');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'progress');

  // Long segment at >= 60s
  harness.setTime(startAt + 70_000);
  assert.equal(harness.locale.translate('chat', 'chat.deepDiving'), '漫长');
  assert.equal(harness.attrs.get('data-dsh-status-stage'), 'long');

  // Disabling pack cleans up CSS vars, style node, and stage attribute
  harness.setPack(false);
  assert.equal(harness.attrs.has('data-dsh-status-stage'), false);
  assert.equal(harness.cssVars.size, 0);
  assert.equal(harness.nodes.size, 0);

  harness.dispose();
});

test('out-of-order translate wrapper disposal leaves outer wrapper intact and falls back to English', () => {
  let loadedModule = null;
  const listeners = new Map();
  const windowMock = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
  };
  windowMock.__ModuleLoader__ = { load(m) { loadedModule = m; } };

  const sandbox = {
    window: windowMock,
    Date,
    CustomEvent: class {},
    console,
    setInterval: () => 1,
    clearInterval: () => {},
  };
  vm.runInNewContext(CLIENT_CODE, sandbox);

  const locale = {
    getSnapshot: () => ({ active: 'ko' }),
    translate: (_ns, key) => `NATIVE:${key}`,
  };
  const registered = [];
  let slotDisposed = 0;
  let scopeEffectCalls = 0;
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (...args) => ({ args }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
  };
  const ctx = {
    locale,
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          status: 'ready',
          value: {
            pack: {
              intervalMs: 10_000,
              phrases: {
                'de-pirate': { start: ['DE'], progress: ['DE'], long: ['DE'] },
                'en-pirate': { start: ['EN'], progress: ['EN'], long: ['EN'] },
              },
            },
          },
        }),
        subscribe: () => () => {},
      }),
    },
    slots: {
      inject: (_name, fn) => fn(),
      register: (meta, render) => {
        registered.push({ meta, render });
        return () => { slotDisposed += 1; };
      },
    },
    remote: { settings: { mutate: async () => ({ ok: true, value: {} }) } },
    effect: (fn) => fn(),
    inject: (deps, fn) => (typeof fn === 'function'
      ? fn({
        ...ctx,
        effect: (ef) => {
          if (Array.isArray(deps) && deps.includes('slots')) scopeEffectCalls += 1;
          return ef();
        },
      })
      : () => {}),
  };

  const cleanup = loadedModule.factory((id) => (id === 'react' ? fakeReact : null)).apply(ctx);
  assert.equal(registered.length, 1);
  assert.equal(scopeEffectCalls, 1);
  assert.equal(registered[0].meta.id, 'dsh-rotate-status-text');
  assert.equal(locale.translate('chat', 'chat.deepDiving'), 'EN');

  // Simulate another plugin wrapping locale.translate after dsh-rotate-status-text
  const innerTranslate = locale.translate;
  const outerTranslate = function (ns, key, params) {
    const res = innerTranslate.call(this, ns, key, params);
    return key === 'hero.headline' ? `OUTER:${res}` : res;
  };
  locale.translate = outerTranslate;

  // Disposing dsh-rotate-status-text out-of-order must NOT delete outerTranslate and must pass through NATIVE text
  cleanup();
  assert.equal(slotDisposed, 1);
  assert.equal(locale.translate, outerTranslate);
  assert.equal(locale.translate('conversation', 'hero.headline'), 'OUTER:NATIVE:hero.headline');
  assert.equal(locale.translate('chat', 'chat.deepDiving'), 'NATIVE:chat.deepDiving');
});
