# 🗼 Watchtower Dev Center

  A standalone web panel to browse and test all **Watchtower JS extensions** using the real extension engine — no Flutter app needed.

  ## Features
  - **506+ JS extensions** — Watch, Manga, Novel, Music, Game
  - **Real engine** — extensions run server-side in a Node.js `vm` sandbox with real HTTP requests
  - **Popular / Latest / Search** — all three tabs per extension
  - **Detail view** — episodes/chapters list from each source
  - **Dark UI** — matches Watchtower app aesthetic

  ## Architecture
  ```
  Browser → Express API → vm sandbox (extension JS + shims) → fetch → target website
  ```

  ## Setup
  ```bash
  npm install
  node server.js
  # Opens on http://localhost:5000
  ```

  ## Extension support
  | Type | sourceCodeLanguage |
  |---|---|
  | ✅ JavaScript (Watchtower native) | 1 |
  | ⏳ Dart (coming later) | 0 |
  | ❌ Mihon APK | 2 |
  