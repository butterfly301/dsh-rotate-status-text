const MAX_CACHE_ENTRIES = 128;

export function readService(ctx, key) {
  try {
    if (typeof ctx?.get === 'function') return ctx.get(key);
    if (ctx?.reflect && typeof ctx.reflect.get === 'function') return ctx.reflect.get(key);
  } catch {}
  return undefined;
}

function countOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function eventAtOf(session, seq) {
  if (typeof session?.eventAt === 'function') return session.eventAt(seq);
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents(seq, seq + 1)[0];
  return undefined;
}

export function applyTurnEvent(state, event) {
  if (!state || !event) return state;
  if (event.type === 'turn/start') {
    state.turnOpen = true;
    state.turnStartAt = typeof event.time === 'number' && Number.isFinite(event.time)
      ? event.time
      : Date.now();
  } else if (event.type === 'turn/end') {
    state.turnOpen = false;
    state.turnStartAt = null;
  }
  return state;
}

export function foldTurnState(state, session) {
  const inherited = countOf(session?.inheritedEventCount);
  const end = countOf(session?.seq);
  if (!state || state.inheritedEventCount !== inherited || state.foldedThrough >= end || state.foldedThrough < inherited - 1) {
    state = {
      inheritedEventCount: inherited,
      foldedThrough: inherited - 1,
      turnOpen: false,
      turnStartAt: null,
    };
  }
  for (let seq = state.foldedThrough + 1; seq < end; seq += 1) {
    applyTurnEvent(state, eventAtOf(session, seq));
    state.foldedThrough = seq;
  }
  return state;
}

function payload(sessionId, state) {
  return {
    ok: true,
    sessionId,
    turnOpen: state?.turnOpen === true,
    turnStartAt: state?.turnOpen ? state.turnStartAt : null,
  };
}

function remember(cache, id, state) {
  cache.set(id, state);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export async function readSessionTurnState(ctx, cache, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    return { ok: true, sessionId: null, turnOpen: false, turnStartAt: null };
  }
  const id = sessionId.trim();
  const known = cache.get(id);
  if (known) return payload(id, known);

  const live = readService(ctx, 'sessions')?.get?.(id);
  if (live) {
    const state = foldTurnState(undefined, live);
    remember(cache, id, state);
    return payload(id, state);
  }

  const query = readService(ctx, 'sessionQuery');
  if (!query || typeof query.inspectSession !== 'function') {
    return { ok: true, sessionId: id, turnOpen: false, turnStartAt: null };
  }
  try {
    const state = await query.inspectSession(id, (session) => foldTurnState(undefined, session), AbortSignal.timeout(3000));
    if (state) remember(cache, id, state);
    return payload(id, state);
  } catch {
    return { ok: false, sessionId: id, turnOpen: false, turnStartAt: null };
  }
}
