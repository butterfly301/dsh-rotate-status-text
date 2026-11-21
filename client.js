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
      // Different intervals/buckets should not all start at index 0 together.
      return ((bucket % length) + length) % length;
    }

    /**
     * Shadow the locale service's translate method. Returns a restore function
     * that puts the original descriptor back — called from the effect cleanup
     * so disabling/unloading the theme leaves no trace.
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
          if (pack && Array.isArray(pack.phrases) && pack.phrases.length) {
            const phrase = pack.phrases[pickIndex(pack.phrases.length, pack.intervalMs)];
            if (typeof phrase === 'string') return renderPhrase(phrase, params);
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
        // A sealed service: shadow the prototype method instead.
        holder = Object.getPrototypeOf(locale);
        if (!holder || typeof holder.translate !== 'function') throw error;
        own = Object.getOwnPropertyDescriptor(holder, 'translate');
        holder.translate = patched;
      }

      return function restore() {
        if (!installed.value) return;
        installed.value = false;
        if (own === undefined) delete holder.translate;
        else Object.defineProperty(holder, 'translate', own);
      };
    }

    function normalizePack(value) {
      if (!value || typeof value !== 'object') return undefined;
      if (!Array.isArray(value.phrases)) return undefined;
      const phrases = value.phrases.filter(p => typeof p === 'string' && p.length > 0);
      if (!phrases.length) return undefined;
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

            const previous = restoreOverride;
            restoreOverride = undefined;
            currentPack = undefined;
            try {
              if (previous) previous();
              currentPack = pack;
              // getPack reads the live ref, so translate always sees the newest
              // config without reinstalling the wrapper on every edit.
              restoreOverride = installOverride(ctx.locale, () => currentPack);
            } catch (error) {
              console.error('[dsh-rotate-status-text] failed to install override:', error);
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
