/**
 * Watchtower Plugin Publisher
 * Pushes plugin files to watchtower-extensions via GitHub Git Data API.
 * Updates plugins/index.json atomically in the same commit.
 */

const BASE = 'https://api.github.com'

function ghHeaders(token) {
  return {
    'Authorization': `token ${token}`,
    'User-Agent': 'watchtower-dev-center',
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  }
}

async function ghApi(token, method, path, body = null) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: ghHeaders(token),
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
  return data
}

export async function pushPluginFiles(token, owner, repo, pluginId, manifest, files) {
  // 1. HEAD
  const ref    = await ghApi(token, 'GET', `/repos/${owner}/${repo}/git/refs/heads/main`)
  const headSha = ref.object.sha
  const commit  = await ghApi(token, 'GET', `/repos/${owner}/${repo}/git/commits/${headSha}`)
  const parentTreeSha = commit.tree.sha

  // 2. Fetch current plugins/index.json
  let currentIndex = []
  try {
    const idxRes = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/main/plugins/index.json`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (idxRes.ok) currentIndex = await idxRes.json()
  } catch {}

  // 3. Upsert manifest in index
  const existingIdx = currentIndex.findIndex(p => p.id === manifest.id)
  const indexEntry = {
    ...manifest,
    publishedAt: new Date().toISOString(),
    sourceCodeUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/plugins/${pluginId}/logic/main.js`,
  }
  if (existingIdx >= 0) currentIndex[existingIdx] = indexEntry
  else currentIndex.push(indexEntry)

  // 4. Build file map: plugin files + updated index
  const allFiles = { ...files }
  // Normalize paths to be under plugins/{id}/
  const fileMap = {}
  for (const [path, content] of Object.entries(allFiles)) {
    const normalized = path.startsWith('plugins/') ? path : `plugins/${pluginId}/${path}`
    fileMap[normalized] = content
  }
  fileMap['plugins/index.json'] = JSON.stringify(currentIndex, null, 2)

  // 5. Create blobs
  const treeEntries = []
  for (const [repoPath, content] of Object.entries(fileMap)) {
    const b64 = Buffer.from(content, 'utf8').toString('base64')
    const blob = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: b64, encoding: 'base64'
    })
    treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha })
  }

  // 6. Create tree
  const tree = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/trees`, {
    base_tree: parentTreeSha, tree: treeEntries
  })

  // 7. Create commit
  const newCommit = await ghApi(token, 'POST', `/repos/${owner}/${repo}/git/commits`, {
    message: `feat(plugin): publish ${manifest.name} v${manifest.version} (${pluginId})`,
    tree: tree.sha,
    parents: [headSha]
  })

  // 8. Update ref
  await ghApi(token, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/main`, {
    sha: newCommit.sha
  })

  return { sha: newCommit.sha }
}
