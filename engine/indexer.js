import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Local paths (used when running inside the Replit workspace)
const LOCAL_BASE = resolve(__dir, '../../Projet/Watchtower-extensions');
const REMOTE_BASE = 'https://raw.githubusercontent.com/ferelking242/watchtower-extensions/main';

export const TYPES = ['watch', 'manga', 'novel', 'music', 'game'];

const TYPE_LABELS = {
  watch: { label: 'Watch', emoji: '🎬', itemType: 1 },
  manga: { label: 'Manga', emoji: '📚', itemType: 0 },
  novel: { label: 'Novel', emoji: '📖', itemType: 2 },
  music: { label: 'Music', emoji: '🎵', itemType: 3 },
  game:  { label: 'Game',  emoji: '🎮', itemType: 4 },
};

let _cache = null;

// Fix triple-encoded UTF-8 found in local files (bytes stored as Latin-1, re-encoded as UTF-8 multiple times)
function fixEncoding(val) {
  if (typeof val !== 'string') return val;
  let s = val;
  for (let i = 0; i < 3; i++) {
    try {
      const next = Buffer.from(s, 'latin1').toString('utf8');
      if (next === s) break;
      s = next;
    } catch { break; }
  }
  return s;
}

function fixObjectEncoding(obj) {
  if (Array.isArray(obj)) return obj.map(fixObjectEncoding);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = fixObjectEncoding(v);
    return out;
  }
  return fixEncoding(obj);
}

function tryLocalLoad(type) {
  try {
    const p = resolve(LOCAL_BASE, type, 'index.json');
    const raw = readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return fixObjectEncoding(data);
  } catch {
    return null;
  }
}

async function tryRemoteLoad(type) {
  const url = `${REMOTE_BASE}/${type}/index.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function loadAllExtensions() {
  if (_cache) return _cache;

  const all = [];
  for (const type of TYPES) {
    let entries = tryLocalLoad(type);
    if (!entries) {
      try { entries = await tryRemoteLoad(type); } catch { entries = []; }
    }

    const meta = TYPE_LABELS[type];
    for (const e of entries) {
      // Only JavaScript extensions (sourceCodeLanguage === 1)
      if (e.sourceCodeLanguage !== 1) continue;
      // Must have a sourceCodeUrl
      if (!e.sourceCodeUrl) continue;

      all.push({
        ...e,
        _type: type,
        _typeLabel: meta.label,
        _typeEmoji: meta.emoji,
      });
    }
  }

  _cache = all;
  return all;
}

export function invalidateCache() {
  _cache = null;
}

export async function findExtension(id) {
  const all = await loadAllExtensions();
  const numId = typeof id === 'string' ? parseInt(id) : id;
  return all.find(e => e.id === numId) ?? null;
}
