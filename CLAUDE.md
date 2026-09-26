# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Botanical Network is a small desktop app (Tauri 2) that shows a Delhi Metro map, pins the user's saved places to their nearest stations, plans journeys and schedules visits. It ships on Windows (WebView2). A macOS version (WKWebView) is being ported from the **same** `src/` and `src-tauri/`. There is no separate Mac codebase: per-OS differences live in config files and in `platforms/`. README.md is the user-facing spec. When you change behaviour it describes (import rules, time model, UI gestures, performance notes), update it too.

## Commands

```
npm install              # once: installs the Tauri CLI
npm run dev              # run the app window (compiles the Rust shell)
npm run build            # this OS's bundle: NSIS installer on Windows, .app + .dmg on macOS
npm run build:portable   # Windows: release exe only -> src-tauri/target/release/
npm run build:mac        # macOS: universal .app + .dmg -> src-tauri/target/universal-apple-darwin/release/bundle/
npm run package          # after a build: dist/<windows|macos>/ share folder + zip (platforms/package.mjs)
npm run package:web      # browser version (src/ + launcher), no build needed: dist/web/
npm run fetch:mac        # download the Mac build GitHub made (mac-build branch) -> dist/macos/
```

- **Mac builds happen on GitHub, not locally.** The development PC runs Windows. `.github/workflows/build-macos.yml` builds on `macos-latest` for every push to `main` that touches the app (or on a manual *Run workflow*). It then force-pushes the packaged `dist/macos/` as the sole commit of the `mac-build` branch. Never merge that branch or build on top of it.

- **Frontend-only check:** open `src/index.html` directly in Edge or Chrome. There is no bundler and no dev server. The page loads plain `<script>` files, so `file://` works. With no `window.__TAURI__`, state goes to `localStorage` (key `botanical-network`) instead of `%APPDATA%\com.botanicalnetwork.app\state.json`.
- **Data pipeline (Python 3; Pillow is optional and only used for the preview image).** Order matters because the layout step reads the network step's output:
  ```
  python tools/build_network.py   # tools/ref/*.json -> src/data/network.json + network.js
  python tools/build_layout.py    # network.json + tools/layout/anchors.json -> src/data/layout.js + tools/layout/preview.png
  python tools/make_places.py places.csv -o out.json [--geocode]
  ```
  After a layout change, check `tools/layout/preview.png` and the "stations closer than 22 units" warning.
- The project has no test suite, linter or formatter. It is a git repository with a private GitHub remote (`origin`, account rishabhk571), whose default branch is `main`.
- **Browser check without a visible pane:** `.claude/launch.json` defines `web-preview`, which serves `src/` on port 5178. When the preview pane is hidden, the page has no layout and no animation frames, so zoom code can't be exercised there. Drive headless Edge over the DevTools protocol instead. In browser mode, `window.__bn` exposes `view`, `state`, `moving` and the other internals for such tests.

## Architecture

**Rust is deliberately thin.** `src-tauri/src/lib.rs` exposes only five commands: `read_text_file`, `write_text_file`, `state_file_path`, `load_state` and `save_state` (saves go through a temp file and a rename). Everything else lives in the webview. `tauri.conf.json` serves `../src` as-is (`frontendDist`) with `withGlobalTauri: true`, so JS reaches Tauri through `window.__TAURI__`. Any new plugin API also needs a permission in `src-tauri/capabilities/default.json`. The release profile is tuned for size (`opt-level = "s"`, LTO, strip) because the app targets old PCs.

**Per-OS config:** the Tauri CLI merges `tauri.windows.conf.json` or `tauri.macos.conf.json` over `tauri.conf.json` as a JSON Merge Patch, so an array in a platform file replaces the base array outright. Shared settings belong in the base. The OS-specific ones are:
- Windows: NSIS target, WebView2 bootstrapper.
- macOS: `app`/`dmg` targets, macOS 11 minimum, ad-hoc signing.
- The macOS bundle id is `com.botanicalnetwork.desktop`, while Windows keeps `com.botanicalnetwork.app`. The id names the app-data folder, so changing either strands that platform's saved state.

**Two webview engines:** frontend changes must work in WebView2 (Chromium) and WKWebView (Safari's WebKit). The checklist in `platforms/macos/README.md` tracks the differences. Already handled in code:
- WebKit trackpad pinch arrives as `gesture*` events, and the handler sits beside the wheel listener.
- Every blur pairs `-webkit-backdrop-filter` with `backdrop-filter`.
- All copying goes through `copyText()`, which falls back to `execCommand`.
- Shortcut hints use `IS_MAC`.

Keep new code on these paths, and tick items off in the checklist as they are verified on a real Mac.

**Frontend** is `src/index.html` + `style.css` + `app.js` with no framework. Load order: `data/network.js` sets `window.NETWORK`, then `data/layout.js` sets `window.LAYOUT`, then `app.js`. `app.js` is a single IIFE split into sections by `// ------ name` banners (helpers, network indexes, state, map rendering, categories, pan/zoom, popover, journey, lists, search, time capsule, import/export, boot). `const TAURI = window.__TAURI__ || null`. Every native call must keep a browser fallback so the `file://` preview keeps working.

- **Two projections:** `P` points to either `SCH` (schematic coordinates from `LAYOUT`) or `GEO` (lat/lon projected with the same `KX`/`KY` maths as `build_layout.py`). Rendering code must go through `P`, not one of the maps directly. Schematic lines are octolinear polylines with rounded corners (`filletPath`); geographic lines are Catmull-Rom curves.
- **Routing:** `adj` is the station graph. `shortest()` runs Dijkstra (a custom `Heap`) under `ROUTE_MODES` (`fast`, `changes`, `short`). Cost model: 1.5 min/km, 0.35 min/stop, the interchange walk from `NET.interchanges`, and half the line headway on each boarding. Headways live in the `LINES` table in `tools/build_network.py`, not in JS.
- **Performance invariant:** during zoom or drag, only the CSS transform of `#mapLayer` changes (with 25% overscan). The SVG is redrawn once in `settle()`. Pulses pause and the popover closes while moving. Keep DOM or SVG work out of the gesture path. See "Performance notes" in README.md.
- **State:** `state = { places, route, journeys, settings }`, persisted by a debounced `persist()` as `{ v: 1, places, journeys, settings }`. `loadState()` holds the one-off migrations (e.g. `settings.catv`). It resets `route` on every launch and drops saved journeys whose stations no longer exist.
- **Regional lines** (`kind: "regional"`: Namo Bharat and Meerut Metro, from `tools/ref/extra_lines.json`) are excluded from nearest-station matching in both `app.js` and `make_places.py`.

## Data and cross-file couplings

- `src/data/network.*` and `src/data/layout.js` are generated. Edit the inputs and re-run the scripts instead. The inputs are:
  - `tools/ref/osm_*.json`: the OSM snapshot.
  - `extra_lines.json`: lines that have no OSM relation.
  - `extra_links.json`: walkways between stations with different names.
  - `interchanges.json`: platform walk minutes.
  - the `RENAME` map in `build_network.py`: OSM names mapped to DMRC display names.
  - `tools/layout/anchors.json`: hand-placed positions on an 8-unit grid, plus label sides, bends and loops. `anchors.auto.json` is an output, not an input.
- **Station ids are slugs of the display name.** Renaming a station changes its id, so these must be updated to match:
  - `anchors.json`
  - `interchanges.json`
  - `extra_links.json`
  - `STATION_ALIASES` in `app.js`
  - saved user data. Places store `station` ids, and journeys with unknown ids are silently dropped on load.

  `build_network.py` exits with an error when links or interchanges reference an unknown station.
- **Place categories** are duplicated. Keep these in sync:
  - `CATEGORIES` and `CAT_RULES` (the inference regexes) in `app.js`
  - in `index.html`: the filter chips, the `#ic-<cat>` SVG symbols, the `<select>` options, and the copyable AI prompt (`#helpPrompt`)
  - the allowed set in `tools/make_places.py`
- **The import format string `botanical-network/1`** appears in `app.js` (import and export), in the `#helpPrompt` text in `index.html`, and in `make_places.py`. The importer is deliberately lenient: it pulls the JSON block out of a pasted AI reply, never overwrites existing places, and reports every adjustment. Keep new import rules reported in the same way.

## Releases

The version string appears in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, and in the text of both `platforms/*/READ ME FIRST.txt` files.

`dist/` is gitignored output; never edit it. `npm run package` (and `package:web`) rebuilds `dist/<target>/` from scratch using:
- the build artifacts in `src-tauri/target/`; for `web`, `src/` copied as `app/`
- every file in `platforms/<target>/` except `README.md`: the recipient's `READ ME FIRST.txt`, and for `web` the `Open Botanical Network.html` launcher, which redirects to `app/index.html`
- every `*.json` in `places/` and `places/samples/`, flattened into `places/`

The web package is the Mac stopgap until a Mac build exists. It relies on the browser-mode fallbacks in `app.js` (file input, drop, blob download, localStorage), so keep those working.

It then zips the folder with the OS's built-in bsdtar. `places/delhi-all-places.json` is the combined list that recipients import first.
