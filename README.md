# Botanical Network

A tiny Windows app that plots the places you save on Instagram next to their
nearest Delhi Metro station, plans journeys across the DMRC network, and lets
you schedule when you'll visit. Parchment, sage and terracotta; one SVG layer;
no framework; built with Tauri 2 on WebView2 so it stays light on old PCs.
A macOS version is being set up from the same code: see
[platforms/macos/README.md](platforms/macos/README.md).

Network data: every operational line on DMRC's official *Metro Network in
Delhi-NCR* map (as on August 2026), including the 2026 Pink ring and the
Magenta Majlis Park - Deepali Chowk section, plus Noida Aqua Line, Rapid Metro
Gurugram and (toggle) Namo Bharat / Meerut Metro.

## Run it

```
npm install          # once: installs the Tauri CLI
npm run dev          # opens the app window
npm run build        # release build: src-tauri/target/release/bundle/nsis/*.exe
npm run build:portable   # release .exe only, no installer
npm run package      # after a build: share-ready folder and zip in dist/windows/
npm run package:web  # browser version for Mac or any computer, no build: dist/web/
```

The Mac app is built on GitHub's Macs (`.github/workflows/build-macos.yml`)
whenever the app changes on `main`; `npm run fetch:mac` downloads the result
into `dist/macos/`. On a Mac you can also run `npm run build:mac` then
`npm run package` (see [platforms/macos/README.md](platforms/macos/README.md)).

Requirements: Node LTS, Rust (MSVC toolchain), Visual Studio Build Tools with the
C++ workload, WebView2 runtime (ships with Windows 11).

The frontend is plain HTML/CSS/JS in `src/`, so you can also open
`src/index.html` in Edge for a browser-mode preview (state then lives in
localStorage instead of `%APPDATA%\com.botanicalnetwork.app\state.json`).

## Project layout

```
src/            the app: index.html, style.css, app.js; data/ holds the generated
                network and schematic layout (shared by Windows and macOS)
src-tauri/      the native shell (Rust, Tauri 2): two Rust files, icons, and
                tauri.conf.json with per-OS overrides in tauri.windows.conf.json
                and tauri.macos.conf.json; target/ is the build cache (safe to
                delete, rebuilds take longer)
places/         your place lists: delhi-all-places (the combined list that ships
                with the app), delhi-heritage, delhi-picks and their sources;
                samples/ has small demo files for trying the import
tools/          data pipeline scripts and their reference inputs (see below)
platforms/      packaging: package.mjs builds the share folders; windows/,
                macos/ and web/ hold what ships with each (READ ME FIRST.txt,
                the web launcher); macos/README.md is the Mac build guide and
                porting checklist
.github/        the GitHub Actions workflow that builds the Mac app
dist/           output of `npm run package` and `fetch:mac`: windows/, macos/
                and web/ share folders
```

## Sharing the app

`npm run build` leaves the installer in `src-tauri/target/release/bundle/nsis/`
and the bare exe in `src-tauri/target/release/`. `npm run package` then
collects both into `dist/windows/`, with `platforms/windows/READ ME FIRST.txt`,
every place list, and a zip of the lot. Send either one:

- the **installer** (about 1 MB) installs per user, adds a Start-menu entry
  and an uninstaller;
- the **portable exe** (about 3 MB) runs from anywhere with nothing to install.

For a Mac, run `npm run fetch:mac` and send
`dist/macos/Botanical Network 0.1.0 macOS (share).zip`: the `.dmg`, its
`READ ME FIRST.txt` and the place lists. For any other computer, send the
**browser version** instead: `npm run package:web` puts `src/` as-is into
`dist/web/app/`, next to an `Open Botanical Network.html` launcher, the place
lists and `platforms/web/READ ME FIRST.txt`, and zips it (about 300 KB). The
recipient unzips it and double-clicks the launcher; places then live in that
browser's localStorage, so the readme tells them to *Export…* now and then.

Both need the WebView2 runtime, which Windows 10 and 11 already ship; the
installer fetches it if it is missing. The build is not code-signed, so
SmartScreen shows "Windows protected your PC" on first launch: *More info*,
then *Run anyway*. Places live per user in `%APPDATA%\com.botanicalnetwork.app`,
so send a places file (*Export…*) along with the app if you want the recipient
to start with the same list.

## Your places file

Drop a `.json` or `.csv` file onto the map (or use *Import places*). Every
station that holds a saved place gets a slow heartbeat ring (terracotta when
something there is scheduled or tagged next up). Hover the station for the
list of places with their category icons, exit gates and dates; click it for
the full list. Each place has a category (worship, food, sights, monument,
nature, culture, activity, shopping, other), inferred from its tags, name and
notes unless you set `"category"` explicitly. Culture covers museums, galleries,
libraries, theatres and art districts; activity covers escape rooms, gaming,
sports, cinemas and workshops; sights is for viewpoints and landmarks that fit
nowhere else. the category chips under *Saved places* narrow the
list and draw that category's icon beside its stations so the map can be
scanned for one type at a time. Format:

```json
{
  "format": "botanical-network/1",
  "places": [
    {
      "name": "Cafe Lota",
      "notes": "Regional Indian, go for the sabudana popcorn",
      "source": "https://www.instagram.com/p/...",
      "lat": 28.6132, "lon": 77.2426,
      "tags": ["cafe", "food"]
    }
  ]
}
```

`station` (id or name) and `distanceM` are optional; the app computes them from
`lat`/`lon`. Add `"gate": "2"` for the exit gate you prefer at that station; it
shows in the tooltip, the place card and the list. Everyday station names such
as "RK Ashram Marg", "INA" or "Qutub Minar" are understood. A CSV with columns
`name,station,gate,lat,lon,notes,source,tags` works too.
Every import ends with a report, a checklist of the file in three groups:

- **Imported**: each new place with the station it was placed at and its gate.
  Adjustments made on the way are noted under the item (a misspelt station
  replaced by the nearest one to the coordinates, an unknown category inferred
  instead, coordinates far from Delhi ignored, an invalid status or schedule
  ignored).
- **Already in your places**: rows that match a place you already have (same
  `id`, or the same name at the same station) are skipped and marked *already
  exists*; your notes, gates and dates are never overwritten by an import. A
  row repeated inside the file is marked the same way. To refresh a place,
  remove it in the app and import again.
- **Skipped**: rows that could not be imported, with the reason (no name, a
  station that is not in the network with a "did you mean" suggestion, no
  station and no coordinates).

Files that cannot be read at all (invalid JSON with the line and column, no
`places` list, a CSV without a name column, an empty file) change nothing and
the report says why. If you save a whole AI-chat reply as the file, the JSON
block inside it is used and the report says so. *Copy report* puts the full
checklist on the clipboard.

Generate the file from a spreadsheet, with optional geocoding of names:

```
python tools/make_places.py places.csv -o my-places.json --geocode
```

## Using the app

- **Journey**: click a station, pick *Start here*, click another, *End here*.
  The rest of the network fades, the route glows clay, and saved places along
  it pulse. Click a pulsing leaf and *Add as stop* to route via it.
  Like DMRC's own planner, up to three ranked alternatives are offered:
  **Fastest**, **Fewest changes** and **Shortest** distance. Only the cards
  show by default; the selected card opens into a vertical timeline (line-
  coloured bars, change nodes with the walk time, saved places along each leg)
  and the others fold away. *Clear* and *Save journey* stay pinned at the foot
  of the panel; a saved journey keeps start, end, via-stops and the chosen
  ranking for one-click reloading.
- **Time model**: 1.5 min per km plus 0.35 min per stop (calibrated on
  DMRC's published journey times), a platform-to-platform walk at each
  interchange (`tools/ref/interchanges.json`, 34 stations), and an expected
  wait of half the line's headway whenever you board a train. Headways live in
  `tools/build_network.py`; edit either file and re-run the build to tune.
- **Time capsule**: click any leaf. Pick a day on the timeline, slide the time
  from sun to moon, tag it *Next up* or *Visited*. Scheduled places turn into
  filled terracotta circles and appear under *Time capsule*.
- **Zoom**: mouse wheel, touchpad two-finger scroll or pinch, touchscreen pinch,
  the slider at the bottom right, or the `+` / `-` keys. Zooming is eased over a
  few frames, so a touchpad's stream of small steps reads as one motion.
- **Lists**: Saved places and Time capsule each show five rows and scroll
  inside themselves (a fade at the foot means there is more), so Import,
  Export and Settings stay within reach however many places you save. Use the
  search box and the filter chips to narrow a long list.
- **Keys**: `Tab` toggles the panel, `/` searches, `Esc` closes.
- **Settings**: Lite mode disables blur and animation for very old machines;
  Colour hints tint each line toward its official colour.

## Performance notes

The map is one SVG inside a composited layer with 25% overscan. While you zoom
or drag, only that layer's CSS transform changes (GPU work, well under 1 ms of
main-thread time per frame); the SVG is redrawn once when the gesture settles,
which is also when node and label sizes are recomputed. During a gesture the
heartbeat rings pause, the sidebar's frosted blur is switched off, and the
station panel closes, so a frame is just a transform. Rings outside the
viewport are not animated at all. Lite mode goes further and hides labels
while moving. Measured on the development machine, a zoom frame went from
about 12.5 ms of style and layout work to under 1 ms.

## Data pipeline

`tools/build_network.py` turns OpenStreetMap route relations
(`tools/ref/osm_routes.json`, `tools/ref/osm_stopnodes.json`, ODbL) into
`src/data/network.js`. Lines OSM has no relation for live in
`tools/ref/extra_lines.json`. Re-run it after editing either.

`tools/build_layout.py` produces the schematic map (`src/data/layout.js`).
Interchanges, terminals and ring/loop junctions are placed by hand on an 8-unit
grid in `tools/layout/anchors.json`; the script draws every connection between
them at 0/45/90 degrees with at most one bend, spaces the intermediate stations
evenly along the straight parts, offsets lines that share track, and picks a
label side for each station (overridable in the same file). It also writes
`tools/layout/preview.png` so a layout change can be checked without
launching the app. The renderer rounds every bend with a circular fillet.
Settings > Map style switches between this schematic and the geographic
projection.
