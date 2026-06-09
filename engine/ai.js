/**
 * Watchtower AI Engine
 * Proxies requests to OpenAI / Anthropic / Gemini.
 * API key stored in env: AI_API_KEY, AI_PROVIDER (openai|anthropic|gemini)
 */

const AI_PROVIDER = process.env.AI_PROVIDER || 'openai'
const AI_API_KEY  = process.env.AI_API_KEY  || ''
const AI_MODEL    = process.env.AI_MODEL    || (AI_PROVIDER === 'anthropic' ? 'claude-3-5-sonnet-20241022' : AI_PROVIDER === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini')

const SYSTEM_PROMPT = `You are the Watchtower Plugin AI assistant. You help developers create plugins for the Watchtower app (a Flutter media hub for anime, manga, films and more, fork of Mangayomi).

## Watchtower Plugin Architecture

A plugin has:
- manifest.json (id, name, version, author, runtime, ui, permissions, tags, category)
- logic/main.js (or .wasm / endpoint for remote)
- ui/schema.json OR ui/index.html OR ui/ui.evc (depending on ui type)
- permissions.json

## Runtimes
- javascript: runs in QuickJS sandbox. Has access to: http.get/post, storage.get/set, notification.send
- wasm: WebAssembly binary (Rust/Go/C)
- remote: no local code, calls an HTTPS endpoint
- binary: native binary per platform (sandboxed)

## UI Types
- builtin: reuses Watchtower native screens (media_grid, reader, player, download_list)
- declarative: JSON schema with widgets (textfield, button, card, list, tabs, toggle, select, divider)
- webview: HTML+CSS+JS in sandboxed WebView
- flutter_eval: compiled Dart bytecode (.evc) loaded dynamically

## Watchtower JS Plugin API (available as this.api in the plugin class)
- this.api.http.get(url, headers?) → { body, statusCode, headers }
- this.api.http.post(url, headers?, body?) → { body, statusCode, headers }
- this.api.storage.get(key) → value
- this.api.storage.set(key, value)
- this.api.notification.send(title, body, icon?)
- this.api.player.play(url, title?, headers?)
- this.api.downloads.add(url, filename, headers?)
- this.api.cache.get(key) → value | null
- this.api.cache.set(key, value, ttlSeconds?)

## Rules
1. NEVER use eval(), process, require(), fs, global Node.js APIs
2. Always export default PluginClass
3. constructor(api) receives the API
4. Implement: onInstall(), onLoad(), execute(action, payload)
5. Return structured JSON from execute()
6. Catch all errors and rethrow with useful messages

When generating files, output JSON with a "files" key: { "files": { "logic/main.js": "...", "manifest.json": "...", "ui/schema.json": "..." } }
When generating a single file, output { "file": "filename", "content": "..." }
When explaining or fixing, output { "message": "..." }
Always output valid JSON only — no markdown code blocks, no prose outside JSON.`

export async function generateWithAI(req, res) {
  if (!AI_API_KEY) {
    return res.status(503).json({ error: 'AI service not configured. Set AI_API_KEY environment variable.' })
  }

  const { mode, prompt, context } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'prompt required' })

  const userMessage = buildUserMessage(mode, prompt, context)

  try {
    if (AI_PROVIDER === 'anthropic') {
      await callAnthropic(userMessage, res)
    } else if (AI_PROVIDER === 'gemini') {
      await callGemini(userMessage, res)
    } else {
      await callOpenAI(userMessage, res)
    }
  } catch (e) {
    console.error('[AI]', e.message)
    if (!res.headersSent) res.status(500).json({ error: e.message })
  }
}

function buildUserMessage(mode, prompt, context) {
  const ctx = context || {}
  const parts = []

  const modeInstructions = {
    generate_full:   'Generate a complete Watchtower plugin (all files) for this description:',
    generate_logic:  'Generate only the logic/main.js file for this plugin. Context already provided:',
    generate_ui:     'Generate only the ui/schema.json declarative UI file for this plugin:',
    fix_error:       'Fix the error in this plugin code. Return the corrected file only:',
    document:        'Add JSDoc documentation to this plugin code. Return the documented file:',
    migrate:         'Migrate this Mihon/Aniyomi/Tachiyomi extension code to Watchtower JS plugin format:',
  }

  parts.push((modeInstructions[mode] || 'Help with this:') + '\n\n' + prompt)

  if (ctx.manifest) parts.push('\n\nCurrent manifest.json:\n' + ctx.manifest.slice(0, 1000))
  if (ctx.code)     parts.push('\n\nCurrent code:\n' + ctx.code.slice(0, 3000))
  if (ctx.runtime)  parts.push('\n\nRuntime: ' + ctx.runtime)
  if (ctx.ui)       parts.push('\nUI type: ' + ctx.ui)

  return parts.join('')
}

async function callOpenAI(userMessage, res) {
  const body = JSON.stringify({
    model: AI_MODEL,
    stream: true,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userMessage }
    ]
  })

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenAI error ${response.status}: ${err.slice(0, 200)}`)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let fullText = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'))
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6))
        const text = data.choices?.[0]?.delta?.content || ''
        if (text) {
          fullText += text
          res.write(`data: ${JSON.stringify({ text })}\n\n`)
        }
      } catch {}
    }
  }

  // Try to parse final JSON and inject files
  try {
    const parsed = JSON.parse(fullText)
    if (parsed.files) res.write(`data: ${JSON.stringify({ files: parsed.files })}\n\n`)
    else if (parsed.file) res.write(`data: ${JSON.stringify({ file: parsed.file, content: parsed.content })}\n\n`)
  } catch {}

  res.write('data: [DONE]\n\n')
  res.end()
}

async function callAnthropic(userMessage, res) {
  const body = JSON.stringify({
    model: AI_MODEL,
    max_tokens: 4096,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  })

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': AI_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Anthropic error ${response.status}: ${err.slice(0, 200)}`)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let fullText = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6))
        const text = data.delta?.text || ''
        if (text) {
          fullText += text
          res.write(`data: ${JSON.stringify({ text })}\n\n`)
        }
      } catch {}
    }
  }

  try {
    const parsed = JSON.parse(fullText)
    if (parsed.files) res.write(`data: ${JSON.stringify({ files: parsed.files })}\n\n`)
  } catch {}

  res.write('data: [DONE]\n\n')
  res.end()
}

async function callGemini(userMessage, res) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:streamGenerateContent?key=${AI_API_KEY}&alt=sse`
  const body = JSON.stringify({
    contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\n---\n\n' + userMessage }] }],
    generationConfig: { maxOutputTokens: 4096 }
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini error ${response.status}: ${err.slice(0, 200)}`)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  let fullText = ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
    for (const line of lines) {
      try {
        const data = JSON.parse(line.slice(6))
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
        if (text) {
          fullText += text
          res.write(`data: ${JSON.stringify({ text })}\n\n`)
        }
      } catch {}
    }
  }

  try {
    const parsed = JSON.parse(fullText)
    if (parsed.files) res.write(`data: ${JSON.stringify({ files: parsed.files })}\n\n`)
  } catch {}

  res.write('data: [DONE]\n\n')
  res.end()
}
