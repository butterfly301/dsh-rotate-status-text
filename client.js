window.__ModuleLoader__.load({
  id: 'dsh-rotate-status-text',
  factory() {
    const NS = 'dsh-rotate-status-text';

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
    function pickIndex(length, intervalMs) {
      if (length <= 1) return 0;
      const bucket = Math.floor(Date.now() / intervalMs);
      return ((bucket % length) + length) % length;
    }

    const primary = (lang) => String(lang ?? '').split(/[-_]/)[0].toLowerCase();

    /**
     * Pick a value from a `{ [langId]: value }` map with no language hardcoded:
     * exact id, then matching primary BCP-47 subtag, then the first entry.
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

    /**
     * Shadow the locale service's translate method. Returns a restore function
     * that puts the original descriptor back — called from the effect cleanup
     * so disabling/unloading leaves no trace.
     */
    function installOverride(locale, getPack) {
      if (!locale || typeof locale.translate !== 'function') return () => {};

      let holder = locale;
      let own = Object.getOwnPropertyDescriptor(holder, 'translate');
      const original = locale.translate;
      const installed = { value: true };

      const patched = function (ns, key, params) {
        if (isStatusKey(key)) {
          const pack = getPack();
          if (pack && pack.phrases) {
            const phrases = pickLocalized(pack.phrases, readActive(locale));
            if (Array.isArray(phrases) && phrases.length) {
              const phrase = phrases[pickIndex(phrases.length, pack.intervalMs)];
              if (typeof phrase === 'string') return renderPhrase(phrase, params);
            }
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
        if (!installed.value) return;
        installed.value = false;
        if (own === undefined) delete holder.translate;
        else Object.defineProperty(holder, 'translate', own);
      };
    }

    /** Normalize both the legacy array and the new per-language dictionary. */
    function normalizePack(value) {
      if (!value || typeof value !== 'object') return undefined;
      const raw = value.phrases;
      let phrases;
      if (Array.isArray(raw)) {
        phrases = { '': raw.filter(p => typeof p === 'string' && p.length > 0) };
      } else if (raw && typeof raw === 'object') {
        phrases = {};
        for (const [id, list] of Object.entries(raw)) {
          if (Array.isArray(list)) phrases[id] = list.filter(p => typeof p === 'string' && p.length > 0);
        }
      }
      if (!phrases || !Object.values(phrases).some(list => list.length)) return undefined;
      const intervalMs = typeof value.intervalMs === 'number' && value.intervalMs >= 100
        ? value.intervalMs
        : 8000;
      return { phrases, intervalMs };
    }

    return {
      inject: ['locale', 'configForms'],
      apply(ctx) {
        return ctx.effect(() => {
          const form = ctx.configForms.get(NS);
          let currentPack;
          let restoreOverride;

          const sync = () => {
            const { status, value } = form.getSnapshot();
            if (status === 'loading') return;
            const pack = status === 'ready' ? normalizePack(value && value.pack) : undefined;
            const revision = JSON.stringify(pack);
            if (revision === JSON.stringify(currentPack)) return;

            currentPack = pack;
            if (pack && !restoreOverride) {
              try {
                // getPack reads the live ref, so translate always sees the newest
                // config and active language without reinstalling the wrapper.
                restoreOverride = installOverride(ctx.locale, () => currentPack);
              } catch (error) {
                currentPack = undefined;
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

          const unsubscribe = form.subscribe(sync);
          sync();
          return () => {
            try { unsubscribe(); } finally { if (restoreOverride) restoreOverride(); }
          };
        }, 'dsh-rotate-status-text: status text rotation');
      },
    };
  },
});
