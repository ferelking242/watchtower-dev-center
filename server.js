import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { loadAllExtensions, findExtension, invalidateCache } from './engine/indexer.js';
import { runExtensionMethod, clearCodeCache } from './engine/runner.js';
import { generateWithAI } from './engine/ai.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(resolve(__dir, 'public')));

// ── Extensions ───────────────────────────────────────────────────────────────
app.get('/api/extensions', async (req, res) => {
  try {
    const all = await loadAllExtensions();
    const { type, q } = req.query;
    let filtered = all;
    if (type && type !== 'all') filtered = filtered.filter(e => e._type === type);
    if (q) {
      const ql = q.toLowerCase();
      filtered = filtered.filter(e =>
        e.name.toLowerCase().includes(ql) || (e.lang || '').toLowerCase().includes(ql)
      );
    }
    res.json({ count: filtered.length, extensions: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reload', (_req, res) => {
  invalidateCache();
  clearCodeCache();
  res.json({ ok: true });
});

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

app.get('/api/extensions/:id/popular',  (req, res) => runMethod(req, res, 'getPopular',  [parseInt(req.query.page) || 1]));
app.get('/api/extensions/:id/latest',   (req, res) => runMethod(req, res, 'getLatest',   [parseInt(req.query.page) || 1]));
app.get('/api/extensions/:id/search',   (req, res) => runMethod(req, res, 'search',       [req.query.q || '', parseInt(req.query.page) || 1, []]));
app.get('/api/extensions/:id/detail',   (req, res) => runMethod(req, res, 'getDetail',    [req.query.url || '']));
app.get('/api/extensions/:id/pagelist', (req, res) => runMethod(req, res, 'getPageList',  [req.query.url || '']));
app.get('/api/extensions/:id/filters',  (req, res) => runMethod(req, res, 'getFilterList',[]));;

// ── Plugins ───────────────────────────────────────────────────────────────────

// Run a plugin method in the sandbox
app.post('/api/plugin/run', async (req, res) => {
  const { code, manifest, action, payload } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    const { runPluginCode } = await import('./engine/runner.js');
    const result = await runPluginCode(code, manifest || {}, action || 'load', payload || {});
    res.json({ ok: true, result, logs: result?._logs || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Publish a plugin to the watchtower-extensions repo
app.post('/api/plugin/publish', async (req, res) => {
  const GH_PAT = process.env.GH_PAT;
  if (!GH_PAT) return res.status(503).json({ error: 'GH_PAT not configured' });

  const { manifest, files } = req.body || {};
  if (!manifest?.id) return res.status(400).json({ error: 'manifest.id required' });

  const pluginId = manifest.id;
  const OWNER = 'ferelking242';
  const REPO  = 'watchtower-extensions';

  try {
    const { pushPluginFiles } = await import('./engine/publisher.js');
    const result = await pushPluginFiles(GH_PAT, OWNER, REPO, pluginId, manifest, files);
    res.json({ ok: true, commit: result.sha, url: `https://github.com/${OWNER}/${REPO}/tree/main/plugins/${pluginId}` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AI ────────────────────────────────────────────────────────────────────────
app.post('/api/ai/generate', generateWithAI);

// Health
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ai: {
      configured: !!process.env.AI_API_KEY,
      provider: process.env.AI_PROVIDER || 'openai',
      model: process.env.AI_MODEL || 'gpt-4o-mini'
    },
    github: { configured: !!process.env.GH_PAT }
  });
});

app.listen(PORT, () => console.log(`Watchtower Dev Center on port ${PORT}`));
