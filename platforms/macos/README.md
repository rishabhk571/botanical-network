# Botanical Network for macOS

Status: **built by GitHub Actions; not yet tested on a real Mac.** The known
WebKit gaps are fixed in code (see the checklist) and still need checking by
hand.

## Build without a Mac (how it is done now)

`.github/workflows/build-macos.yml` builds the universal app on GitHub's macOS
runners whenever a push to `main` touches the app, or when you press *Run
workflow* on the repository's Actions tab. It runs `npm run build:mac` and
`npm run package`, then force-pushes the resulting share folder as the only
commit on the `mac-build` branch. Fetch it on any PC with:

```
npm run fetch:mac    # -> dist/macos/: the .dmg, READ ME FIRST.txt, places/, the share zip
```

The repository is private, so each build uses the free Actions quota. macOS
minutes count 10x, which allows about a dozen builds a month on the free plan.

The Mac version is the same app as the Windows one: same `src/` frontend, same
`src-tauri/` Rust shell. Only the packaging differs. On macOS the app runs in
WKWebView (Safari's engine) instead of WebView2 (Edge's), so the checklist
below is mostly about browser-engine differences.

| What | Where |
|---|---|
| Mac bundle settings (targets, bundle id, minimum macOS, signing) | `src-tauri/tauri.macos.conf.json`, merged over `tauri.conf.json` by the Tauri CLI |
| Windows-only settings (NSIS, WebView2 bootstrapper) | `src-tauri/tauri.windows.conf.json` |
| Mac icon | `src-tauri/icons/icon.icns`, generated from `src-tauri/app-icon.png` |
| Recipient notes shipped with the app | `platforms/macos/READ ME FIRST.txt` |
| Share-folder builder (both OSes) | `platforms/package.mjs`, run as `npm run package` |

## Build on a Mac (optional)

1. Copy the project folder **without** `node_modules/` and `src-tauri/target/`.
   Both hold Windows-only binaries.
2. Install the Xcode command line tools: `xcode-select --install`
3. Install Rust from <https://rustup.rs>, then add both CPU targets for a
   universal (Apple Silicon + Intel) build:
   `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
4. Install Node LTS, then run `npm install` in the project folder.

## Build

```
npm run dev          # run the app from source
npm run build:mac    # universal .app + .dmg -> src-tauri/target/universal-apple-darwin/release/bundle/
npm run package      # dist/macos/: the .dmg, READ ME FIRST.txt, places/, and a share zip
```

`npm run build` also works on a Mac, but it only builds for that Mac's CPU.
`npm run package` falls back to that build, with a warning, when no universal
one exists.

## Decisions already made (change before the first Mac release)

- **Bundle id `com.botanicalnetwork.desktop`**, not the Windows
  `com.botanicalnetwork.app`. An id ending in `.app` makes macOS treat the
  data folder `~/Library/Application Support/com.botanicalnetwork.app` as an
  application bundle. The id names that folder, so changing it after release
  strands users' places.
- **Minimum macOS 11 (Big Sur).** The frontend is ES2020 and uses modern CSS.
  WKWebView is the system's Safari engine, so older macOS means older Safari.
- **Ad-hoc signing (`signingIdentity: "-"`).** Apple Silicon refuses unsigned
  code, so this is the minimum for the app to launch. It is not notarised:
  recipients approve it once in System Settings (see `READ ME FIRST.txt`).
  Removing that step requires an Apple Developer ID certificate and
  notarisation. See Tauri's "macOS Code Signing" guide.

## Porting checklist

"Fixed" means changed in code and tested in Chromium with simulated WebKit
events. Every item still needs a check on a real Mac.

- [x] **Trackpad pinch-zoom (fixed).** WebKit reports a pinch as
  `gesturestart`, `gesturechange` and `gestureend` events (with `e.scale`),
  not as ctrl+wheel. `src/app.js` now feeds each gesture step into `zoomAt`
  beside the wheel listener. It ignores any ctrl+wheel that arrives
  mid-gesture, so a pinch cannot zoom twice.
- [x] **Frosted sidebar (fixed).** `-webkit-backdrop-filter` now sits beside
  `backdrop-filter` in `src/style.css`.
- [x] **Copy buttons (fixed).** Copy link, Copy report and Copy prompt all go
  through `copyText()` in `src/app.js`. It uses `navigator.clipboard` where
  the page is a secure context and falls back to `execCommand('copy')`. If
  that still fails in WKWebView, switch to `tauri-plugin-clipboard-manager`.
- [x] **Shortcut text (fixed).** The copy hint reads ⌘C on a Mac (`IS_MAC`).
- [ ] **Font.** The stack (`src/style.css:20`) falls through to San Francisco
  unless Nunito or Quicksand is installed. Check that the look still holds.
- [ ] **Menu shortcuts.** Tauri installs a default macOS menu. Check ⌘Q, and
  ⌘C, ⌘V and ⌘A in the search box and the time capsule.
- [ ] **File handling.** Test drag-and-drop import and the Import / Export
  dialogs.
- [ ] **Performance.** The zoom figures in the main README were measured on
  WebView2. Re-check that zoom and drag stay smooth under WebKit, with and
  without Lite mode.
- [ ] **Icon.** Check the icon in the Dock, Finder and the DMG window.
