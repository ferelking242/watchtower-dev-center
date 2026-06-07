import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { loadAllExtensions, findExtension, invalidateCache } from './engine/indexer.js';
import { runExtensionMethod, clearCodeCache } from './engine/runner.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(resolve(__dir, 'public')));

// ── List all JS extensions ───────────────────────────────────────────────────
app.get('/api/extensions', async (req, res) => {
  try {
    const all = await loadAllExtensions();
    const { type, q } = req.query;
    let filtered = all;
    if (type && type !== 'all') filtered = filtered.filter(e => e._type === type);
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(ql) ||
        (e.lang || '').toLowerCase().includes(ql)
      );
    }
    res.json({ count: filtered.length, extensions: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reload extension cache ───────────────────────────────────────────────────
app.post('/api/reload', (_req, res) => {
  invalidateCache();
  clearCodeCache();
  res.json({ ok: true });
});

// ── Helper: run method and respond ──────────────────────────────────────────
async function runMethod(req, res, methodName, args) {
  const id = req.params.id;
  try {
    const entry = await findExtension(id);
    if (!entry) return res.status(404).json({ error: `Extension ${id} not found` });
    const result = await runExtensionMethod(entry, methodName, args);
    res.json({ ok: true, data: result, extension: { id: entry.id, name: entry.name, lang: entry.lang } });
  } catch (err) {
    console.error(`[${methodName}] ext ${id}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Popular ──────────────────────────────────────────────────────────────────
app.get('/api/ext/:id/popular', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  await runMethod(req, res, 'getPopular', [page]);
});

// ── Latest ───────────────────────────────────────────────────────────────────
app.get('/api/ext/:id/latest', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  await runMethod(req, res, 'getLatestUpdates', [page]);
});

// ── Search ───────────────────────────────────────────────────────────────────
app.get('/api/ext/:id/search', async (req, res) => {
  const { q = '', page = 1 } = req.query;
  await runMethod(req, res, 'search', [q, parseInt(page), []]);
});

// ── Detail ───────────────────────────────────────────────────────────────────
app.get('/api/ext/:id/detail', async (req, res) => {
  const { url = '' } = req.query;
  await runMethod(req, res, 'getDetail', [url]);
});

// ── Video list ───────────────────────────────────────────────────────────────
app.get('/api/ext/:id/videos', async (req, res) => {
  const { url = '' } = req.query;
  await runMethod(req, res, 'getVideoList', [url]);
});

// ── Page list (manga reader) ──────────────────────────────────────────────────
app.get('/api/ext/:id/pages', async (req, res) => {
  const { url = '' } = req.query;
  await runMethod(req, res, 'getPageList', [url]);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🗼 Watchtower Dev Center → http://0.0.0.0:${PORT}`);
});
