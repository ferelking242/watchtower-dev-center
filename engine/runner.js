import vm from 'vm';
import { buildShimCode, WDocument, WSharedPreferences } from './shims.js';

const CODE_CACHE = new Map();
const TIMEOUT_MS = 20_000;

async function fetchCode(url) {
  if (CODE_CACHE.has(url)) return CODE_CACHE.get(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const code = await res.text();
  CODE_CACHE.set(url, code);
  return code;
}

function makeClientClass() {
  return class WClient {
    constructor(opts = null) { this._opts = opts; }
    async _req(method, url, headers = {}, body = null) {
      try {
        const opts = {
          method,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(headers || {}),
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        };
        if (body != null) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
        const r = await fetch(url, opts);
        const text = await r.text();
        const hdrs = {};
        r.headers.forEach((v, k) => { hdrs[k] = v; });
        return { body: text, headers: hdrs, statusCode: r.status };
      } catch (e) {
        return { body: '', headers: {}, statusCode: 0, error: e.message };
      }
    }
    async get(url, headers) { return this._req('GET', url, headers); }
    async post(url, headers, body) { return this._req('POST', url, headers, body); }
    async head(url, headers) { return this._req('HEAD', url, headers); }
    async put(url, headers, body) { return this._req('PUT', url, headers, body); }
    async delete(url, headers, body) { return this._req('DELETE', url, headers, body); }
    async patch(url, headers, body) { return this._req('PATCH', url, headers, body); }
  };
}

export async function runExtensionMethod(entry, methodName, args = []) {
  const { sourceCodeUrl, lang, id } = entry;
  if (!sourceCodeUrl) throw new Error('No sourceCodeUrl');

  const extCode = await fetchCode(sourceCodeUrl);

  // Build the source object from the index entry
  const sourceObj = { ...entry };
  const sourceJson = JSON.stringify(sourceObj);

  const shimCode = buildShimCode(sourceJson);

  // Globals injected into the sandbox
  const ClientClass = makeClientClass();

  const sandbox = {
    // Core JS
    Promise,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Proxy,
    Reflect,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    console: {
      log: (...a) => {},
      warn: (...a) => {},
      error: (...a) => {},
      info: (...a) => {},
    },
    fetch,
    // Watchtower globals
    Client: ClientClass,
    Document: WDocument,
    SharedPreferences: WSharedPreferences,
    // jsonStringify helper used by some extensions
    jsonStringify: async (fn) => JSON.stringify(await fn()),
  };

  vm.createContext(sandbox);

  // Wrap everything in an IIFE so `class` / `const` / `let` declarations
  // are visible inside the closure and we can return DefaultExtension explicitly.
  // (In vm contexts, class/const/let do NOT become properties of the sandbox.)
  const wrappedCode = `(function(){
${shimCode}
${extCode}
return typeof DefaultExtension !== 'undefined' ? DefaultExtension : undefined;
})()`;

  let ExtClass;
  try {
    ExtClass = vm.runInContext(wrappedCode, sandbox, { timeout: 10_000 });
  } catch (err) {
    throw new Error(`Extension eval error: ${err.message}`);
  }

  if (typeof ExtClass !== 'function') {
    throw new Error('DefaultExtension not found in extension code');
  }

  const ext = new ExtClass();

  if (typeof ext[methodName] !== 'function') {
    throw new Error(`Method ${methodName} not found on extension`);
  }

  // Run with a timeout via Promise.race
  const resultPromise = ext[methodName](...args);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Extension timeout')), TIMEOUT_MS)
  );

  return Promise.race([resultPromise, timeoutPromise]);
}

export function clearCodeCache() {
  CODE_CACHE.clear();
}
