/**
 * Plugin runner — adds runPluginCode() to the existing runner.
 * Paste this into runner.js or import separately.
 */
import vm from 'vm';

const PLUGIN_TIMEOUT_MS = 10_000;

export async function runPluginCode(code, manifest, action, payload) {
  const logs = [];
  const mockApi = {
    http: {
      async get(url, headers = {}) {
        try {
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
          const body = await res.text();
          return { body, statusCode: res.status, headers: Object.fromEntries(res.headers) };
        } catch(e) { return { body: '', statusCode: 0, headers: {}, error: e.message }; }
      },
      async post(url, headers = {}, body = null) {
        try {
          const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
          const rbody = await res.text();
          return { body: rbody, statusCode: res.status, headers: Object.fromEntries(res.headers) };
        } catch(e) { return { body: '', statusCode: 0, headers: {}, error: e.message }; }
      }
    },
    storage: {
      _store: {},
      async get(k) { return this._store[k] ?? null; },
      async set(k, v) { this._store[k] = v; },
    },
    notification: { async send(t, b) { logs.push(`[NOTIF] ${t}: ${b}`); } },
    cache: {
      _store: {},
      async get(k) { return this._store[k] ?? null; },
      async set(k, v, _ttl) { this._store[k] = v; },
    },
    player: { async play(url, title) { logs.push(`[PLAYER] ${title}: ${url}`); } },
    downloads: { async add(url, fname) { logs.push(`[DOWNLOAD] ${fname}: ${url}`); } },
  };

  const sandboxConsole = {
    log:   (...a) => logs.push('[LOG] '   + a.join(' ')),
    warn:  (...a) => logs.push('[WARN] '  + a.join(' ')),
    error: (...a) => logs.push('[ERROR] ' + a.join(' ')),
    info:  (...a) => logs.push('[INFO] '  + a.join(' ')),
  };

  const ctx = vm.createContext({
    console: sandboxConsole,
    setTimeout, clearTimeout, clearInterval, setInterval,
    Promise, JSON, Object, Array, String, Number, Boolean, Error, Math, Date, RegExp,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, parseInt, parseFloat, isNaN,
    exports: {}, module: { exports: {} },
  });

  const wrappedCode = `
    (function() {
      ${code}
      if (typeof module.exports.default !== 'undefined') exports.default = module.exports.default;
    })();
  `;

  vm.runInContext(wrappedCode, ctx, { timeout: PLUGIN_TIMEOUT_MS });

  const PluginClass = ctx.exports?.default || ctx.module?.exports?.default;
  if (!PluginClass) throw new Error('Plugin must export a default class');

  const instance = new PluginClass(mockApi);

  if (action === 'load') {
    if (typeof instance.onLoad === 'function') await instance.onLoad();
    return { _logs: logs, status: 'loaded', name: manifest.name || 'Unknown' };
  }

  if (typeof instance.execute !== 'function') throw new Error('Plugin must implement execute(action, payload)');
  const result = await instance.execute(action, payload);
  return { _logs: logs, ...result };
}
