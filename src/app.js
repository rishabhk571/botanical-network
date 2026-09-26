/* Botanical Network — a lightweight Delhi Metro companion.
   Plain ES2020, no framework, a single SVG layer. Runs inside Tauri (WebView2)
   or in an ordinary browser (state then lives in localStorage). */
(() => {
'use strict';

const NET = window.NETWORK;
if (!NET) { document.body.textContent = 'network data missing (src/data/network.js)'; return; }
const TAURI = window.__TAURI__ || null;

// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
}
const f2 = n => Math.round(n * 100) / 100;
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
const IS_MAC = /Mac/.test(navigator.platform || navigator.userAgent);
// Clipboard: the async API where the page counts as a secure context (WebView2,
// browsers), else the older execCommand route, which WebKit (the macOS app)
// still honours inside a click handler. Resolves to whether the copy worked.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  }
  const ta = h('textarea', { readonly: '', style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' });
  ta.value = text; document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  ta.remove();
  return ok;
}
function haversineKm(a, b) {
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const pad2 = n => String(n).padStart(2, '0');
const fmtTime = m => { const hh = Math.floor(m / 60), mm = m % 60; return `${((hh + 11) % 12) + 1}:${pad2(mm)} ${hh < 12 ? 'am' : 'pm'}`; };
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtWhen = w => w ? `${fmtDate(w.date)}${w.minutes != null ? ' · ' + fmtTime(w.minutes) : ''}` : '';

// ---------------------------------------------------------------- network indexes
const stationById = new Map(NET.stations.map(s => [s.id, s]));
const stationBySlug = new Map(NET.stations.map(s => [slug(s.name), s.id]));
// Everyday names people use for stations that differ from the official ones.
const STATION_ALIASES = {
  'rk-ashram-marg': 'ramakrishna-ashram-marg', 'r-k-ashram-marg': 'ramakrishna-ashram-marg', 'ramakrishna-ashram': 'ramakrishna-ashram-marg',
  'ina': 'dilli-haat-ina', 'dilli-haat': 'dilli-haat-ina', 'ina-market': 'dilli-haat-ina',
  'huda-city-centre': 'millennium-city-centre-gurugram', 'huda-city-center': 'millennium-city-centre-gurugram', 'millennium-city-centre': 'millennium-city-centre-gurugram',
  'pragati-maidan': 'supreme-court', 'udyog-bhawan': 'seva-teerth', 'race-course': 'lok-kalyan-marg',
  'igi-airport': 'airport-t-3', 'airport': 'airport-t-3', 'terminal-3': 'airport-t-3', 't3': 'airport-t-3', 'terminal-1': 'terminal-1-igi-airport',
  'nsp': 'netaji-subhash-place', 'netaji-subhas-place': 'netaji-subhash-place',
  'qutub-minar': 'qutab-minar', 'tughlaqabad': 'tughlakabad', 'chhattarpur': 'chhatarpur', 'vishwa-vidyalaya': 'vishwavidyalaya',
  'hazrat-nizamuddin': 'sarai-kale-khan-nizamuddin', 'nizamuddin': 'sarai-kale-khan-nizamuddin',
  'mayur-vihar-1': 'mayur-vihar-i', 'mayur-vihar-phase-1': 'mayur-vihar-i', 'mayur-vihar-phase-i': 'mayur-vihar-i',
  'karkardooma': 'karkarduma', 'jln-stadium': 'jawaharlal-nehru-stadium', 'moti-bagh': 'sir-m-vishweshwaraiah-moti-bagh',
  'south-campus': 'durgabai-deshmukh-south-campus', 'rk-puram': 'r-k-puram', 'badarpur': 'badarpur-border', 'jamia': 'jamia-millia-islamia',
  'noida-sec-18': 'noida-sector-18', 'sector-18-noida': 'noida-sector-18', 'noida-city-center': 'noida-city-centre',
  'kalkaji': 'kalkaji-mandir', 'rajiv-chowk-connaught-place': 'rajiv-chowk', 'connaught-place': 'rajiv-chowk', 'cp': 'rajiv-chowk',
};
// Last-resort key: no spaces, no bracketed suffix, so "Govindpuri" finds Govind Puri and
// "Sector 54 Chowk" finds Sector 54 Chowk (Gurugram). Ambiguous keys are dropped.
const bareKey = s => slug(String(s).replace(/\(.*?\)/g, '').replace(/\b(metro|station)\b/gi, '')).replace(/-/g, '');
const stationByBare = new Map();
for (const s of NET.stations) { const k = bareKey(s.name); stationByBare.set(k, stationByBare.has(k) ? null : s.id); }
function resolveStation(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (stationById.has(raw)) return raw;
  const s = slug(raw).replace(/-metro(-station)?$/, '').replace(/-station$/, '');
  return stationBySlug.get(s) || STATION_ALIASES[s] || stationByBare.get(bareKey(raw)) || null;
}
const lineById = new Map(NET.lines.map(l => [l.id, l]));
const REGIONAL = new Set(NET.lines.filter(l => l.kind === 'regional').map(l => l.id));
const isRegionalStation = s => s.lines.every(l => REGIONAL.has(l));
const groupsOf = new Map();
for (const line of NET.lines) for (const sid of line.stations) {
  if (!groupsOf.has(sid)) groupsOf.set(sid, new Set());
  groupsOf.get(sid).add(line.group);
}
const linkedStations = new Set(NET.links.flatMap(l => [l.a, l.b]));
const isInterchange = sid => (groupsOf.get(sid)?.size || 0) > 1 || linkedStations.has(sid);
const terminals = new Set();
for (const line of NET.lines) { terminals.add(line.stations[0]); terminals.add(line.stations[line.stations.length - 1]); }

// Two geometries: the hand-tuned octolinear schematic (src/data/layout.js) and a
// plain equirectangular projection of the real coordinates. P holds the active one.
const LAYOUT = window.LAYOUT || null;
const core = NET.stations.filter(s => !isRegionalStation(s));
const latC = avg(core.map(s => s.lat)), lonC = avg(core.map(s => s.lon));
const KX = 1000 * Math.cos(latC * Math.PI / 180), KY = 1000;
const GEO = new Map(NET.stations.map(s => [s.id, { x: (s.lon - lonC) * KX, y: (latC - s.lat) * KY }]));
const SCH = LAYOUT ? new Map(NET.stations.map(s => { const v = LAYOUT.stations[s.id]; return [s.id, v ? { x: v[0], y: v[1], side: v[2] } : GEO.get(s.id)]; })) : null;
let P = SCH || GEO;
const isSchematic = () => P === SCH;

// graph for routing: station -> [{to, line, min, km}]
// Time model calibrated on DMRC's published journey times (about 1.7-1.8 min/km all-in):
// 1.5 min per km of track plus 0.35 min dwell per stop; regional rail is faster.
const adj = new Map();
const addEdge = (a, b, line, min, km) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, line, min, km }); };
for (const line of NET.lines) for (let i = 0; i < line.stations.length - 1; i++) {
  const a = line.stations[i], b = line.stations[i + 1];
  const km = haversineKm(stationById.get(a), stationById.get(b));
  const min = REGIONAL.has(line.id) ? km * 0.7 + 0.5 : km * 1.5 + 0.35;
  addEdge(a, b, line.id, min, km); addEdge(b, a, line.id, min, km);
}
for (const l of NET.links) { addEdge(l.a, l.b, 'walk', l.minutes, 0); addEdge(l.b, l.a, 'walk', l.minutes, 0); }
const IX = NET.interchanges || { default: 3, stations: {}, pairs: {} };
const headwayOf = lid => lineById.get(lid)?.headway || 5;
// Minutes lost going from `fromLine` to `toLine` at `station`: the platform-to-platform walk
// (station specific) plus the expected wait for the next train (half the headway of the line
// being boarded). '*' is the origin, 'walk' a footbridge link between two stations.
function transferMinutes(station, fromLine, toLine) {
  if (toLine === 'walk') return 0;
  const wait = headwayOf(toLine) / 2;
  if (fromLine === '*' || fromLine === 'walk') return wait;
  if (fromLine === toLine) return 0;
  const pair = IX.pairs[`${station}|${fromLine}|${toLine}`] ?? IX.pairs[`${station}|${toLine}|${fromLine}`];
  return (pair ?? IX.stations[station] ?? IX.default) + wait;
}
const isChange = (fromLine, toLine) => fromLine !== '*' && fromLine !== 'walk' && toLine !== fromLine;
// Ranking modes, like DMRC's planner: fastest door to door, fewest line changes, shortest track distance.
const ROUTE_MODES = {
  fast: (e, tr, change) => e.min + tr,
  changes: (e, tr, change) => e.min + tr + (change ? 1000 : 0),
  short: (e, tr, change) => e.km * 100 + e.min * 0.01 + (change ? 0.5 : 0),
};
const ROUTE_KINDS = [['fast', 'Fastest'], ['changes', 'Fewest changes'], ['short', 'Shortest']];
const KIND_LABEL = Object.fromEntries(ROUTE_KINDS);

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(p, v) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } } return top; }
}

// Dijkstra over (station, line) states. `startLine` is the line we arrive on when the search
// continues from a via-stop, so a change there is costed like any other. Returns the step list.
function shortest(from, to, mode = 'fast', startLine = null) {
  const cost = ROUTE_MODES[mode] || ROUTE_MODES.fast;
  if (from === to) return [{ station: from, line: startLine }];
  const dist = new Map(), prev = new Map(), heap = new Heap();
  const start = from + '|' + (startLine || '*');
  dist.set(start, 0); heap.push(0, start);
  let end = null;
  while (heap.size) {
    const [d, key] = heap.pop();
    if (d > (dist.get(key) ?? Infinity)) continue;
    const bar = key.indexOf('|'), st = key.slice(0, bar), ln = key.slice(bar + 1);
    if (st === to) { end = key; break; }
    for (const e of adj.get(st) || []) {
      if (!state.settings.regional && REGIONAL.has(e.line)) continue;
      const nd = d + cost(e, transferMinutes(st, ln, e.line), isChange(ln, e.line)), nk = e.to + '|' + e.line;
      if (nd < (dist.get(nk) ?? Infinity)) { dist.set(nk, nd); prev.set(nk, key); heap.push(nd, nk); }
    }
  }
  if (!end) return null;
  const steps = [];
  for (let k = end; k; k = prev.get(k)) { const bar = k.indexOf('|'); const ln = k.slice(bar + 1); steps.push({ station: k.slice(0, bar), line: ln === '*' ? null : ln }); }
  steps.reverse();
  steps[0].line = startLine;
  return steps;
}

// Totals along a step list, always in the time model so that options stay comparable.
function summarise(steps) {
  let minutes = 0, km = 0, changes = 0; const segments = [];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], s = steps[i], prevLine = a.line || '*';
    const e = (adj.get(a.station) || []).find(x => x.to === s.station && x.line === s.line);
    minutes += (e ? e.min : 0) + transferMinutes(a.station, prevLine, s.line);
    km += e ? e.km : 0;
    if (isChange(prevLine, s.line)) changes++;
    const last = segments[segments.length - 1];
    if (last && last.line === s.line) { last.to = s.station; last.count++; }
    else segments.push({ line: s.line, from: a.station, to: s.station, count: 1 });
  }
  return { minutes, km, changes, segments };
}

// Route through the via-stops in order; returns the concatenated steps or null.
function planSteps(from, stops, to, mode) {
  const seq = [from, ...stops, to], steps = [];
  for (let i = 0; i < seq.length - 1; i++) {
    const part = shortest(seq[i], seq[i + 1], mode, steps.length ? steps[steps.length - 1].line : null);
    if (!part) return null;
    if (steps.length) part.shift();
    steps.push(...part);
  }
  return steps;
}

function nearestStation(lat, lon) {
  let best = null, bd = Infinity;
  for (const s of NET.stations) {
    if (isRegionalStation(s)) continue;
    const d = haversineKm({ lat, lon }, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? { station: best.id, distanceM: Math.round(bd * 1000) } : null;
}

// ---------------------------------------------------------------- state
const state = {
  places: {},                      // id -> place
  route: { from: null, to: null, stops: [], pick: 'fast' },
  journeys: [],                    // saved commutes: {id, name, from, to, stops, pick}
  settings: { lite: false, hints: false, regional: false, labels: 'auto', mapStyle: LAYOUT ? 'schematic' : 'geo', cat: 'all' },
};
let routeOptions = [];             // ranked alternatives for the current from/to
let routeResult = null;            // the selected option: { steps, minutes, km, changes, stations:Set, segments }
let placeFilter = 'all';

const persist = debounce(async () => {
  const json = JSON.stringify({ v: 1, places: state.places, journeys: state.journeys, settings: state.settings });
  try {
    if (TAURI) await TAURI.core.invoke('save_state', { contents: json });
    else localStorage.setItem('botanical-network', json);
  } catch (e) { console.warn('save failed', e); }
}, 400);

async function loadState() {
  let json = null;
  try { json = TAURI ? await TAURI.core.invoke('load_state') : localStorage.getItem('botanical-network'); } catch (e) { console.warn('load failed', e); }
  if (!json) return;
  try {
    const s = JSON.parse(json);
    state.places = s.places || {};
    for (const p of Object.values(state.places)) if (!CAT_LABEL[p.category]) p.category = inferCategory(p);
    if ((s.settings || {}).catv !== 2) {   // one-off when Culture and Activities were added: lift places parked in the generic buckets
      for (const p of Object.values(state.places)) if (p.category === 'other' || p.category === 'sights') { const c = inferCategory(p); if (c === 'culture' || c === 'activity') p.category = c; }
    }
    // Each launch starts with an empty journey; saved journeys are the way to recall one.
    state.route = { from: null, to: null, stops: [], pick: 'fast' };
    state.journeys = (s.journeys || []).filter(j => j && stationById.has(j.from) && stationById.has(j.to));
    state.settings = Object.assign(state.settings, s.settings || {}, { catv: 2 });
  } catch (e) { console.warn('bad state', e); }
}

// ---------------------------------------------------------------- map rendering
const app = $('#app'), mapWrap = $('#mapWrap'), mapEl = $('#map'), viewport = $('#viewport');
const gLines = $('#gLines'), gLinks = $('#gLinks'), gRoute = $('#gRoute'), gStations = $('#gStations'), gLabels = $('#gLabels'), gPlaces = $('#gPlaces');
const segs = new Map();            // geographic mode: `${line}|${a}|${b}` -> [p1, c1, c2, p2]
const stationEls = new Map(), labelEls = new Map();

// --- geographic geometry: Catmull-Rom curve through the real station positions
function geoLinePath(line) {
  const ids = line.stations, pts = ids.map(id => P.get(id));
  if (pts.length < 2) return '';
  let d = `M${f2(pts[0].x)} ${f2(pts[0].y)}`;
  const t = 0.16;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
    const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t };
    segs.set(`${line.id}|${ids[i]}|${ids[i + 1]}`, [p1, c1, c2, p2]);
    d += ` C${f2(c1.x)} ${f2(c1.y)} ${f2(c2.x)} ${f2(c2.y)} ${f2(p2.x)} ${f2(p2.y)}`;
  }
  return d;
}

// --- schematic geometry: octolinear polylines with rounded corners
const BEND_R = 20, STATION_R = 6;   // corner radii (layout units) at free bends / at stations where a line turns
const schVerts = lid => (LAYOUT.lines[lid] || []).map(v => ({ x: v[0], y: v[1], kind: v[2], sid: v[3], off: v[4] || 0 }));

// Apply per-segment perpendicular offsets (lines sharing a stretch of track run side by side).
function offsetPolyline(vs) {
  const n = vs.length, out = [], norm = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = vs[i + 1].x - vs[i].x, dy = vs[i + 1].y - vs[i].y, d = Math.hypot(dx, dy) || 1;
    norm.push({ x: -dy / d, y: dx / d });
  }
  for (let i = 0; i < n; i++) {
    const v = vs[i], oPrev = i > 0 ? vs[i - 1].off : 0, oNext = i < n - 1 ? v.off : 0;
    if (oPrev && oNext && oPrev === oNext) {
      const a = norm[i - 1], b = norm[i], s = oPrev / (1 + a.x * b.x + a.y * b.y);
      out.push({ x: v.x + (a.x + b.x) * s, y: v.y + (a.y + b.y) * s, kind: v.kind });
      continue;
    }
    if (oPrev) out.push({ x: v.x + norm[i - 1].x * oPrev, y: v.y + norm[i - 1].y * oPrev, kind: v.kind });
    if (!(oPrev && oNext)) out.push({ x: v.x, y: v.y, kind: v.kind });
    if (oNext) out.push({ x: v.x + norm[i].x * oNext, y: v.y + norm[i].y * oNext, kind: v.kind });
  }
  return out;
}

// Polyline -> SVG path with circular fillets at every direction change.
function filletPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${f2(pts[0].x)} ${f2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], b = pts[i + 1];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y), l2 = Math.hypot(b.x - p.x, b.y - p.y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u1 = { x: (p.x - a.x) / l1, y: (p.y - a.y) / l1 }, u2 = { x: (b.x - p.x) / l2, y: (b.y - p.y) / l2 };
    const cross = u1.x * u2.y - u1.y * u2.x, dot = clamp(u1.x * u2.x + u1.y * u2.y, -1, 1);
    const r0 = p.kind === 'bend' ? BEND_R : STATION_R;
    if (Math.abs(cross) < 1e-6 || dot < -0.999) { d += ` L${f2(p.x)} ${f2(p.y)}`; continue; }
    const theta = Math.acos(dot);                       // turn angle
    let t = r0 * Math.tan(theta / 2);
    t = Math.min(t, l1 / 2, l2 / 2);
    const r = t / Math.tan(theta / 2);
    const t1 = { x: p.x - u1.x * t, y: p.y - u1.y * t }, t2 = { x: p.x + u2.x * t, y: p.y + u2.y * t };
    d += ` L${f2(t1.x)} ${f2(t1.y)} A${f2(r)} ${f2(r)} 0 0 ${cross > 0 ? 1 : 0} ${f2(t2.x)} ${f2(t2.y)}`;
  }
  const e = pts[pts.length - 1];
  return d + ` L${f2(e.x)} ${f2(e.y)}`;
}

// Vertices of line `lid` between two consecutive stations (either direction), offsets preserved.
function schSpan(lid, a, b) {
  const vs = schVerts(lid);
  const idx = sid => vs.map((v, i) => v.sid === sid ? i : -1).filter(i => i >= 0);
  for (const ia of idx(a)) for (const ib of idx(b)) {
    const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    if (hi - lo < 1) continue;
    if (vs.slice(lo + 1, hi).some(v => v.kind === 'st')) continue;
    const span = vs.slice(lo, hi + 1);
    if (ia < ib) return span.map(v => ({ ...v }));
    // reversed traversal: the offset of each segment moves to its new first vertex and flips sign
    const rev = span.slice().reverse();
    return rev.map((v, k) => ({ x: v.x, y: v.y, kind: v.kind, sid: v.sid, off: k < rev.length - 1 ? -(rev[k + 1].off || 0) : 0 }));
  }
  return [{ ...P.get(a), kind: 'st', off: 0 }, { ...P.get(b), kind: 'st', off: 0 }];
}

function linePath(line) {
  if (!isSchematic()) return geoLinePath(line);
  return filletPath(offsetPolyline(schVerts(line.id)));
}

function labelSide(sid) {
  if (!isSchematic()) return 'r';
  return P.get(sid).side || 'r';
}

function renderNetwork() {
  gLines.textContent = ''; gLinks.textContent = ''; gStations.textContent = ''; gLabels.textContent = '';
  stationEls.clear(); labelEls.clear(); segs.clear();
  for (const line of NET.lines) {
    const p = svg('path', { d: linePath(line), class: 'ln' + (REGIONAL.has(line.id) ? ' regional' : ''), 'data-line': line.id }, gLines);
    p.style.setProperty('--official', line.colour);
  }
  for (const l of NET.links) {
    const a = P.get(l.a), b = P.get(l.b);
    svg('line', { x1: f2(a.x), y1: f2(a.y), x2: f2(b.x), y2: f2(b.y), class: 'walk' }, gLinks);
  }
  for (const s of NET.stations) {
    const p = P.get(s.id);
    const cls = [];
    if (isInterchange(s.id)) cls.push('ix');
    if (terminals.has(s.id)) cls.push('term');
    if (isRegionalStation(s)) cls.push('regional');
    const c = svg('circle', { cx: f2(p.x), cy: f2(p.y), class: ['st', ...cls].join(' '), 'data-id': s.id }, gStations);
    const g = svg('g', { transform: `translate(${f2(p.x)} ${f2(p.y)})` }, gLabels);
    const t = svg('text', { class: ['lbl', 's-' + labelSide(s.id), ...cls].join(' '), 'data-id': s.id }, g);
    t.textContent = s.name;
    stationEls.set(s.id, c); labelEls.set(s.id, t);
  }
}

function setMapStyle(style) {
  const next = style === 'geo' || !SCH ? GEO : SCH;
  if (next === P && gLines.childElementCount) return;
  P = next;
  renderNetwork();
  renderPlaces();
  fitView();
  applyRoute();
}

const placeState = pl => pl.status === 'visited' ? 'visited' : (pl.when ? 'scheduled' : (pl.status === 'next' ? 'next' : 'saved'));

// ---------------------------------------------------------------- categories
const CATEGORIES = [
  ['worship', 'Worship'], ['food', 'Food'], ['sights', 'Sights'], ['monument', 'Monuments'],
  ['nature', 'Nature'], ['culture', 'Culture'], ['activity', 'Activities'], ['shopping', 'Shopping'], ['other', 'Other'],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);
// Keyword rules, checked against tags first, then the name, then the notes. Order matters when
// several match: a "gaming cafe" is an activity, a "museum in a fort" is culture.
const CAT_RULES = [
  ['worship', /\b(mandir(?!\s+marg)|temple|masjid|mosque|gurudwara|gurdwara|church|cathedral|dargah|shrine|bahai|kali ?bari|worship|religious|ashram)\b/i],
  ['shopping', /\b(market|bazaar|bazar|mall|shopping|shops?|bookshop|haat|emporium)\b/i],
  ['activity', /\b(escape ?rooms?|escape|gaming|arcade|bowling|go[- ]?kart\w*|trampoline|adventure|climbing|paintball|laser ?tag|karaoke|vr|workshops?|pottery|sports?|swimming|skating|cycling|kayak\w*|board ?games?|games?|cinema|movies?|multiplex|activit\w*|things to do)\b/i],
  ['food', /\b(cafe|café|restaurant|food|eatery|eat|dhaba|chai|kitchen|bakery|bar|pub|brewery|pizza|biryani|momos?|paranth\w*|kebab|dessert|ice ?cream|coffee|sweets?|boba)\b/i],
  ['culture', /\b(museum|sangrahalaya|galler(?:y|ies)|librar(?:y|ies)|planetarium|theatre|theater|auditorium|exhibition|science cent(?:re|er)|street ?art|murals?|art district|books?|reading|literature|cultural|culture)\b/i],
  ['monument', /\b(tomb|fort|baoli|mahal|minar|qila|kot|heritage|historic\w*|ruins?|memorial|pillar|tower|gate|haveli|stepwell|archaeolog\w*|monument|folly|kotla|mausoleum)\b/i],
  ['nature', /\b(park|garden|sanctuary|biodiversity|lake|wetland|nature|forest|ridge|valley|hauz|nursery|trails?)\b/i],
  ['sights', /\b(sightseeing|tourist|viewpoint|attraction|bhavan|bhawan|stadium|zoo|sights?|landmark|art)\b/i],
];
function inferCategory(p) {
  const tags = (p.tags || []).join(' ');
  for (const [cat, re] of CAT_RULES) if (re.test(tags)) return cat;
  for (const [cat, re] of CAT_RULES) if (re.test(p.name || '')) return cat;
  for (const [cat, re] of CAT_RULES) if (re.test(p.notes || '')) return cat;
  return 'other';
}
const categoryOf = p => CAT_LABEL[p.category] ? p.category : inferCategory(p);
function catIcon(cat, cls = 'ico') {
  const s = svg('svg', { class: `${cls} c-${cat}`, viewBox: '0 0 24 24' });
  svg('use', { href: '#ic-' + cat }, s);
  return s;
}
const catIconHtml = cat => `<svg class="ico c-${cat}" viewBox="0 0 24 24"><use href="#ic-${cat}"/></svg>`;
const placesAt = sid => Object.values(state.places).filter(p => p.station === sid).sort((a, b) => a.name.localeCompare(b.name));

// Stations that hold saved places get a heartbeat ring. The places themselves stay in the
// tooltip, popover and list (progressive disclosure). With a category filter active, that
// category's icon is drawn beside the station so the map can be scanned for, say, food.
function renderPlaces() {
  gPlaces.textContent = '';
  for (const c of stationEls.values()) c.classList.remove('has-places');
  const cat = state.settings.cat || 'all';
  const by = new Map();
  for (const pl of Object.values(state.places)) {
    if (!P.has(pl.station)) continue;
    if (cat !== 'all' && categoryOf(pl) !== cat) continue;
    if (!by.has(pl.station)) by.set(pl.station, []);
    by.get(pl.station).push(pl);
  }
  const onRoute = routeResult && !routeResult.error ? routeResult.stations : null;
  for (const [sid, list] of by) {
    const p = P.get(sid), c = stationEls.get(sid);
    if (c) c.classList.add('has-places');
    const hot = list.some(pl => pl.status === 'next' || (pl.when && pl.status !== 'visited'));
    const cls = ['pulse']; if (hot) cls.push('hot'); if (onRoute && onRoute.has(sid)) cls.push('on-route');
    svg('circle', { cx: f2(p.x), cy: f2(p.y), class: cls.join(' '), 'data-station': sid }, gPlaces);
    if (cat !== 'all') {
      const g = svg('g', { class: 'mk' + (onRoute && onRoute.has(sid) ? ' on-route' : ''), 'data-station': sid }, gPlaces);
      g.style.cssText = `--sx:${f2(p.x)};--sy:${f2(p.y)}`;
      svg('circle', { class: 'mk-bg', r: 9 }, g);
      svg('use', { href: '#ic-' + cat, x: -6, y: -6, width: 12, height: 12 }, g);
      if (list.length > 1) { const t = svg('text', { class: 'mk-n', x: 8, y: -6 }, g); t.textContent = list.length; }
    }
  }
  const ids = Object.keys(state.places);
  $('#placesCount').textContent = ids.length;
  $('#placesHint').hidden = ids.length > 0;
  cullPulses();
}

// ---------------------------------------------------------------- pan / zoom
const view = { k: 1, tx: 0, ty: 0, k0: 1 };
let lastK = null;
// While a gesture is in progress (wheel zoom, drag, pinch, slider) the map is
// "moving": the expensive per-frame work is skipped. Sizes that depend on --k
// (node radii, label font sizes, strokes) are only recomputed when the gesture
// settles, so a zoom frame is a single transform update; labels scale with the
// map in between and snap to their true size at the end.
let moving = false, settleTimer = 0;
function setMoving(on) {
  if (on) {
    clearTimeout(settleTimer);
    if (!moving) { moving = true; app.classList.add('moving'); closePopover(); }
  } else {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 120);
  }
}
function settle() {
  moving = false; app.classList.remove('moving');
  applyView(true); cullPulses();
}
// `view` is the effective screen transform used by hit-testing and positioning.
// `baked` is what the SVG itself currently draws. Between them sits #mapLayer, a
// composited wrapper: during a gesture only its CSS transform changes (a GPU
// operation), and the SVG is re-drawn once on settle, or whenever the gesture
// has drifted more than 1.6x from the baked scale so nodes never balloon.
const mapLayer = $('#mapLayer');
const OVERSCAN = 0.25;
const baked = { k: 0, tx: 0, ty: 0 };
function applyView(force) {
  const ox = mapWrap.clientWidth * OVERSCAN, oy = mapWrap.clientHeight * OVERSCAN;
  const drift = baked.k ? Math.abs(Math.log(view.k / baked.k)) : Infinity;
  if (moving && !force && drift < Math.log(1.6)) {
    const gk = view.k / baked.k, gx = view.tx - gk * baked.tx, gy = view.ty - gk * baked.ty;
    mapLayer.style.transform = `translate(${f2(gx)}px, ${f2(gy)}px) scale(${gk})`;
  } else {
    baked.k = view.k; baked.tx = view.tx; baked.ty = view.ty;
    mapLayer.style.transform = '';
    viewport.setAttribute('transform', `translate(${f2(view.tx + ox)} ${f2(view.ty + oy)}) scale(${view.k})`);
    if (view.k !== lastK) {
      lastK = view.k;
      viewport.style.setProperty('--k', view.k);
      const rel = view.k / view.k0;
      const z = rel < 1.7 ? 'zoom-far' : rel < 3.4 ? 'zoom-mid' : 'zoom-near';
      if (!app.classList.contains(z)) { app.classList.remove('zoom-far', 'zoom-mid', 'zoom-near'); app.classList.add(z); }
    }
  }
  if (!sliderActive) zoomRange.value = kToSlider(view.k);
  if (!moving) positionPopover();
}
// Heartbeat rings outside the viewport are switched off so only visible ones animate.
function cullPulses() {
  const w = mapWrap.clientWidth, hgt = mapWrap.clientHeight;
  for (const el of gPlaces.querySelectorAll('.pulse')) {
    const p = P.get(el.dataset.station); if (!p) continue;
    const x = p.x * view.k + view.tx, y = p.y * view.k + view.ty;
    el.classList.toggle('off', x < -40 || y < -40 || x > w + 40 || y > hgt + 40);
  }
}
let fitRetry = null;
function fitView() {
  const w = mapWrap.clientWidth, hgt = mapWrap.clientHeight, pad = 48;
  if (w < 2 * pad + 20 || hgt < 2 * pad + 20) {        // not laid out yet (hidden tab, first paint): try again shortly
    clearTimeout(fitRetry); fitRetry = setTimeout(fitView, 250); return;
  }
  const xs = core.map(s => P.get(s.id).x), ys = core.map(s => P.get(s.id).y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((w - 2 * pad) / (maxX - minX), (hgt - 2 * pad) / (maxY - minY));
  view.k0 = k; view.k = k;
  view.tx = w / 2 - (minX + maxX) / 2 * k; view.ty = hgt / 2 - (minY + maxY) / 2 * k;
  applyView();
}
// Zooming is eased: wheel, pinch and slider input only move a target, and a
// frame loop glides the view toward it. A touchpad emits dozens of tiny deltas
// per second; easing turns that stream into one continuous motion.
const ZOOM_MIN = 0.5, ZOOM_MAX = 14;                 // relative to the fit scale
const zoomAnim = { target: 0, ax: 0, ay: 0, raf: 0, snap: false };
const zoomTargetK = () => zoomAnim.raf ? zoomAnim.target : view.k;
function zoomTo(k, ax, ay, snap) {
  zoomAnim.target = clamp(k, view.k0 * ZOOM_MIN, view.k0 * ZOOM_MAX);
  zoomAnim.ax = ax; zoomAnim.ay = ay; zoomAnim.snap = !!snap;
  setMoving(true);
  if (!zoomAnim.raf) zoomAnim.raf = requestAnimationFrame(zoomStep);
}
function zoomStep() {
  const za = zoomAnim;
  const ratio = za.target / view.k;
  const ease = za.snap || state.settings.lite ? 1 : 0.3;
  const nk = Math.abs(Math.log(ratio)) < 0.003 ? za.target : view.k * Math.pow(ratio, ease);
  const r = nk / view.k;
  view.tx = za.ax - (za.ax - view.tx) * r; view.ty = za.ay - (za.ay - view.ty) * r; view.k = nk;
  applyView();
  if (nk === za.target) { za.raf = 0; if (!sliderActive) setMoving(false); }
  else za.raf = requestAnimationFrame(zoomStep);
}
function zoomAt(factor, cx, cy, snap) { zoomTo(zoomTargetK() * factor, cx, cy, snap); }
function stopZoomAnim() { if (zoomAnim.raf) { cancelAnimationFrame(zoomAnim.raf); zoomAnim.raf = 0; } }

// zoom slider (log scale between the min and max zoom)
const zoomRange = $('#zoomRange');
let sliderActive = false;
const sliderToK = v => view.k0 * ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, v / 1000);
const kToSlider = k => Math.round(1000 * Math.log(k / (view.k0 * ZOOM_MIN)) / Math.log(ZOOM_MAX / ZOOM_MIN));
zoomRange.addEventListener('input', () => { sliderActive = true; zoomTo(sliderToK(+zoomRange.value), mapWrap.clientWidth / 2, mapWrap.clientHeight / 2, true); });
zoomRange.addEventListener('change', () => { sliderActive = false; setMoving(false); });
function centerOn(sid, minRel) {
  const p = P.get(sid); if (!p) return;
  const w = mapWrap.clientWidth, hgt = mapWrap.clientHeight;
  if (minRel && view.k < view.k0 * minRel) view.k = view.k0 * minRel;
  view.tx = w / 2 - p.x * view.k; view.ty = hgt / 2 - p.y * view.k;
  applyView();
}
const toScreen = sid => { const p = P.get(sid); return { x: p.x * view.k + view.tx, y: p.y * view.k + view.ty }; };

mapWrap.addEventListener('wheel', e => {
  e.preventDefault();
  if (gesture && e.ctrlKey) return;              // a WebKit pinch is already being handled below
  const r = mapWrap.getBoundingClientRect();
  // Normalise the delta: a mouse wheel reports ~100 px per notch, a touchpad a
  // stream of small pixel deltas, and a precision-touchpad pinch arrives as
  // ctrl+wheel with small deltas. Work in zoom levels (powers of two).
  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
  d = clamp(d, -160, 160);
  const levels = -d / 100 * (e.ctrlKey ? 0.9 : 0.45);
  zoomAt(Math.pow(2, levels), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

// Safari's engine (WKWebView, the macOS app) reports a trackpad pinch as
// gesturestart/change/end with a running scale instead of ctrl+wheel. Each step
// goes through the same eased zoom; Chromium never fires these events.
let gesture = null;
mapWrap.addEventListener('gesturestart', e => { e.preventDefault(); gesture = { scale: 1 }; });
mapWrap.addEventListener('gesturechange', e => {
  e.preventDefault();
  if (!gesture) gesture = { scale: 1 };
  if (!(e.scale > 0)) return;
  const r = mapWrap.getBoundingClientRect();
  const cx = Number.isFinite(e.clientX) ? e.clientX - r.left : r.width / 2;
  const cy = Number.isFinite(e.clientY) ? e.clientY - r.top : r.height / 2;
  zoomAt(e.scale / gesture.scale, cx, cy);
  gesture.scale = e.scale;
});
mapWrap.addEventListener('gestureend', e => { e.preventDefault(); gesture = null; });

// drag to pan; two touch points pinch-zoom (touchscreen laptops)
let drag = null, pinch = null;
const touches = new Map();
mapWrap.addEventListener('pointerdown', e => {
  if (e.target.closest('.popover, #zoomControls, #toast')) return;
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    mapWrap.setPointerCapture(e.pointerId);
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null; mapWrap.classList.remove('dragging'); stopZoomAnim(); setMoving(true);
      return;
    }
  } else if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false, target: e.target };
  mapWrap.setPointerCapture(e.pointerId);
});
mapWrap.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const dist = Math.hypot(b.x - a.x, b.y - a.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const r = mapWrap.getBoundingClientRect(), cx = mx - r.left, cy = my - r.top;
    view.tx += mx - pinch.mx; view.ty += my - pinch.my;
    const nk = clamp(view.k * (dist / (pinch.dist || 1)), view.k0 * ZOOM_MIN, view.k0 * ZOOM_MAX), rr = nk / view.k;
    view.tx = cx - (cx - view.tx) * rr; view.ty = cy - (cy - view.ty) * rr; view.k = nk;
    pinch = { dist, mx, my };
    applyView();
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; mapWrap.classList.add('dragging'); setMoving(true); }
  if (drag.moved) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; applyView(); }
});
mapWrap.addEventListener('pointerup', e => {
  const wasPinch = !!pinch;
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch = null;
  if (wasPinch) { if (!pinch) setMoving(false); return; }
  if (!drag) return;
  const d = drag; drag = null; mapWrap.classList.remove('dragging');
  if (d.moved) { setMoving(false); return; }
  if (d.target.closest('.popover')) return;
  // Hover opens the station panel; a tap does the same on touch screens, which have no hover.
  const near = nearestStationOnScreen(e.clientX, e.clientY, 14);
  if (near && e.pointerType === 'touch') openStationPopover(near);
  else if (!near) closePopover();
});
function nearestStationOnScreen(clientX, clientY, maxPx) {
  const r = mapWrap.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  let best = null, bd = maxPx * maxPx;
  for (const s of NET.stations) {
    if (!state.settings.regional && isRegionalStation(s)) continue;
    const p = P.get(s.id);
    const dx = p.x * view.k + view.tx - x, dy = p.y * view.k + view.ty - y;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = s.id; }
  }
  return best;
}
mapWrap.addEventListener('pointercancel', e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; drag = null; mapWrap.classList.remove('dragging'); setMoving(false); });
$('#zoomFit').onclick = () => { stopZoomAnim(); fitView(); };
window.addEventListener('resize', debounce(() => { if (view.k === view.k0) fitView(); else applyView(true); }, 120));
document.addEventListener('visibilitychange', () => { if (!document.hidden && view.k === view.k0) fitView(); });

// ---------------------------------------------------------------- station popover (hover)
// One surface per station, opened by hovering the node (with a 12 px snap so the
// small stones are easy to hit). It stays while the pointer is on the station or on
// the panel itself, and folds away shortly after the pointer leaves both.
const popover = $('#popover');
let popoverStation = null, popoverTimer = 0;
const fmtDist = m => m ? (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`) : '';
const cancelPopoverClose = () => { clearTimeout(popoverTimer); popoverTimer = 0; };
const schedulePopoverClose = () => { cancelPopoverClose(); popoverTimer = setTimeout(closePopover, 280); };
mapWrap.addEventListener('pointermove', e => {
  if (drag || pinch || e.pointerType === 'touch') return;
  if (e.target.closest('.popover')) { cancelPopoverClose(); return; }
  const sid = nearestStationOnScreen(e.clientX, e.clientY, 12);
  if (sid) { cancelPopoverClose(); if (sid !== popoverStation || popover.hidden) openStationPopover(sid); }
  else if (popoverStation) schedulePopoverClose();
});
popover.addEventListener('pointerenter', cancelPopoverClose);
popover.addEventListener('pointerleave', () => { if (popoverStation) schedulePopoverClose(); });
mapWrap.addEventListener('pointerleave', () => { if (popoverStation) schedulePopoverClose(); });
function openStationPopover(sid) {
  cancelPopoverClose();
  popoverStation = sid;
  const s = stationById.get(sid);
  const r = state.route;
  const here = placesAt(sid);
  popover.textContent = '';
  popover.append(h('h4', { text: s.name }));
  const lines = h('div', { class: 'lines' });
  for (const lid of s.lines) {
    const line = lineById.get(lid);
    const chip = h('span', { class: 'line-chip' }, h('i'), line.name.replace(/ \(.*\)$/, ''));
    chip.style.setProperty('--official', line.colour);
    lines.append(chip);
  }
  popover.append(lines);
  const acts = h('div', { class: 'acts' });
  acts.append(h('button', { class: 'btn tiny', type: 'button', onclick: () => { setEndpoint('from', sid); closePopover(); } }, r.from === sid ? '✓ Start' : 'Start here'));
  acts.append(h('button', { class: 'btn tiny ghost', type: 'button', onclick: () => { setEndpoint('to', sid); closePopover(); } }, r.to === sid ? '✓ End' : 'End here'));
  if (r.from && r.to && sid !== r.from && sid !== r.to) {
    const inStops = r.stops.includes(sid);
    acts.append(h('button', { class: 'btn tiny ghost', type: 'button', onclick: () => { inStops ? removeStop(sid) : addStop(sid); closePopover(); } }, inStops ? 'Remove stop' : 'Add as stop'));
  }
  popover.append(acts);
  if (here.length) {
    const ul = h('ul', { class: 'pp-places' });
    for (const p of here) {
      const meta = [p.gate ? `Gate ${p.gate}` : '', fmtDist(p.distanceM), p.when && p.status !== 'visited' ? fmtDate(p.when.date) : (p.status === 'next' ? 'next up' : p.status === 'visited' ? 'visited' : '')].filter(Boolean).join(' · ');
      ul.append(h('li', { onclick: () => { closePopover(); openPlace(p.id); } }, placeIcon(p), h('span', { class: 'pp-name', text: p.name }), meta ? h('span', { class: 'pp-meta', text: meta }) : null));
    }
    popover.append(ul);
  }
  popover.hidden = false;
  positionPopover();
}
function positionPopover() {
  if (popover.hidden || !popoverStation) return;
  const { x, y } = toScreen(popoverStation);
  const w = popover.offsetWidth, hgt = popover.offsetHeight;
  let left = x + 14, top = y - hgt / 2;
  if (left + w > mapWrap.clientWidth - 8) left = x - w - 14;
  top = clamp(top, 8, mapWrap.clientHeight - hgt - 8);
  popover.style.left = left + 'px'; popover.style.top = top + 'px';
}
function closePopover() { cancelPopoverClose(); popover.hidden = true; popoverStation = null; }

// ---------------------------------------------------------------- journey
function setEndpoint(which, sid) {
  const r = state.route;
  if (r[which] === sid) r[which] = null;
  else {
    r[which] = sid;
    if (r.from === r.to) r[which === 'from' ? 'to' : 'from'] = null;
  }
  r.stops = r.stops.filter(id => id !== r.from && id !== r.to);
  computeRoute(); persist();
}
function addStop(sid) { if (!state.route.stops.includes(sid)) state.route.stops.push(sid); computeRoute(); persist(); }
function removeStop(sid) { state.route.stops = state.route.stops.filter(id => id !== sid); computeRoute(); persist(); }

function computeRoute() {
  routeResult = null; routeOptions = [];
  const r = state.route;
  if (r.from && r.to) {
    const seen = new Map();
    for (const [mode, label] of ROUTE_KINDS) {
      const steps = planSteps(r.from, r.stops, r.to, mode);
      if (!steps) continue;
      const sig = steps.map(s => s.station + ':' + s.line).join('>');
      if (seen.has(sig)) { seen.get(sig).kinds.push(mode); continue; }
      const opt = { mode, kinds: [mode], label, steps, ...summarise(steps), stations: new Set(steps.map(s => s.station)) };
      seen.set(sig, opt); routeOptions.push(opt);
    }
    routeResult = routeOptions.length
      ? (routeOptions.find(o => o.kinds.includes(r.pick)) || routeOptions[0])
      : { error: true, stations: new Set() };
  }
  applyRoute();
}
// Stations where a route changes line (or crosses a footbridge), in travel order.
function changeStations(o) {
  const out = [];
  for (let i = 1; i < o.segments.length; i++) { const s = o.segments[i].from; if (out[out.length - 1] !== s) out.push(s); }
  return out;
}

let prevRouteEls = [];
function applyRoute() {
  gRoute.textContent = '';
  for (const el of prevRouteEls) el.classList.remove('on-route', 'rt-end', 'rt-stop', 'rt-key');
  prevRouteEls = [];
  $$('.ln.rt', gLines).forEach(el => el.classList.remove('rt'));
  const has = routeResult && !routeResult.error;
  app.classList.toggle('has-route', !!has);
  if (has) {
    const { steps } = routeResult;
    if (isSchematic()) {
      // Build one continuous polyline per ride (walk links break it), then fillet it like the lines.
      let run = [];
      const flush = () => { if (run.length > 1) svg('path', { d: filletPath(offsetPolyline(run)), class: 'rt' }, gRoute); run = []; };
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1].station, b = steps[i].station, ln = steps[i].line;
        if (ln === 'walk') {
          flush();
          const pa = P.get(a), pb = P.get(b);
          svg('path', { d: `M${f2(pa.x)} ${f2(pa.y)} L${f2(pb.x)} ${f2(pb.y)}`, class: 'rt walk' }, gRoute);
          continue;
        }
        const span = schSpan(ln, a, b);
        if (run.length) span.shift();
        run.push(...span);
      }
      flush();
    } else {
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1].station, b = steps[i].station, ln = steps[i].line;
        let d;
        if (ln === 'walk') { const pa = P.get(a), pb = P.get(b); d = `M${f2(pa.x)} ${f2(pa.y)} L${f2(pb.x)} ${f2(pb.y)}`; }
        else {
          const s = segs.get(`${ln}|${a}|${b}`);
          const rv = !s && segs.get(`${ln}|${b}|${a}`);
          const [p1, c1, c2, p2] = s || (rv ? [rv[3], rv[2], rv[1], rv[0]] : [P.get(a), P.get(a), P.get(b), P.get(b)]);
          d = `M${f2(p1.x)} ${f2(p1.y)} C${f2(c1.x)} ${f2(c1.y)} ${f2(c2.x)} ${f2(c2.y)} ${f2(p2.x)} ${f2(p2.y)}`;
        }
        svg('path', { d, class: 'rt' + (ln === 'walk' ? ' walk' : '') }, gRoute);
      }
    }
    const keyStations = new Set([state.route.from, state.route.to, ...state.route.stops, ...routeResult.segments.map(sg => sg.from), ...routeResult.segments.map(sg => sg.to)]);
    for (const st of routeResult.stations) {
      const c = stationEls.get(st), t = labelEls.get(st);
      c.classList.add('on-route'); t.classList.add('on-route'); prevRouteEls.push(c, t);
      if (keyStations.has(st)) t.classList.add('rt-key');
      if (st === state.route.from || st === state.route.to) c.classList.add('rt-end');
      else if (state.route.stops.includes(st)) c.classList.add('rt-stop');
    }
  }
  for (const el of gPlaces.children) el.classList.toggle('on-route', !!(has && routeResult.stations.has(el.dataset.station)));
  renderJourneyPanel();
  renderPlacesList();
}

function renderJourneyPanel() {
  const r = state.route;
  const fromBtn = $('#routeFrom'), toBtn = $('#routeTo');
  fromBtn.textContent = r.from ? stationById.get(r.from).name : 'Start · click a station';
  toBtn.textContent = r.to ? stationById.get(r.to).name : 'End · click a station';
  fromBtn.classList.toggle('empty', !r.from); toBtn.classList.toggle('empty', !r.to);
  const stops = $('#routeStops'); stops.textContent = '';
  for (const sid of r.stops) stops.append(h('li', null, stationById.get(sid).name, h('button', { class: 'icon-btn x', type: 'button', title: 'Remove stop', onclick: () => removeStop(sid) }, '✕')));
  // Segmented control: one pill with a segment per distinct route; the active
  // segment's summary and timeline sit below it. Segments show their minutes so
  // the routes can be compared without switching.
  const opts = $('#routeOptions'); opts.textContent = '';
  if (routeOptions.length > 1) {
    const segc = h('div', { class: 'segc', role: 'tablist', 'aria-label': 'Route ranking' });
    for (const o of routeOptions) {
      const sel = o === routeResult;
      segc.append(h('button', { type: 'button', role: 'tab', class: 'segb' + (sel ? ' sel' : ''), 'aria-selected': String(sel),
        onclick: () => { r.pick = o.mode; routeResult = o; applyRoute(); persist(); } },
        h('span', { class: 'segb-l', text: o.kinds.map(k => KIND_LABEL[k]).join(' · ') }),
        h('span', { class: 'segb-m', text: `${Math.round(o.minutes)} min` })));
    }
    opts.append(segc);
  }
  if (routeResult && !routeResult.error) {
    const o = routeResult;
    const via = changeStations(o).map(s => stationById.get(s).name);
    const nPlaces = Object.values(state.places).filter(p => o.stations.has(p.station)).length;
    opts.append(h('div', { class: 'route-sum' },
      h('div', { class: 'opt-s', text: `≈ ${Math.round(o.minutes)} min · ${o.changes} change${o.changes === 1 ? '' : 's'} · ${o.steps.length - 1} stops · ${o.km.toFixed(1)} km` }),
      h('div', { class: 'opt-v', text: (via.length ? 'via ' + via.join(', ') : 'no change') + (nPlaces ? ` · ${nPlaces} saved place${nPlaces > 1 ? 's' : ''}` : '') })));
    opts.append(h('div', { class: 'route-tl' }, renderTimeline(o)));
  }
  const note = $('#routeNote');
  note.hidden = routeOptions.length > 0;
  note.textContent = !routeResult ? 'Pick a start and an end station. Saved places along the way will pulse.'
    : routeResult.error ? 'No connection found between those stations. Try enabling regional rail, or pick another station.' : '';
  $('#journeyBar').hidden = !(r.from || r.to);
  $('#routeSave').disabled = !(routeResult && !routeResult.error);
  if (!routeResult || routeResult.error) $('#journeyForm').hidden = true;
  renderJourneys();
}

// Route as a vertical timeline: nodes at the start, every change and the end;
// thick line-coloured bars between them, with saved places marked along each leg.
function timelineItems(o) {
  const steps = o.steps, items = [];
  items.push({ type: 'node', station: steps[0].station, kind: 'start' });
  let seg = null;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1], s = steps[i], prevLine = a.line || '*';
    const e = (adj.get(a.station) || []).find(x => x.to === s.station && x.line === s.line);
    if (!seg || seg.line !== s.line) {
      if (seg) {
        items.push(seg);
        items.push({ type: 'node', station: a.station, kind: 'change', walk: s.line === 'walk' || prevLine === 'walk', minutes: transferMinutes(a.station, prevLine, s.line) });
      }
      seg = { type: 'seg', line: s.line, count: 0, minutes: 0, stations: [] };
    }
    seg.count++; seg.minutes += e ? e.min : 0; seg.stations.push(s.station);
  }
  if (seg) items.push(seg);
  items.push({ type: 'node', station: steps[steps.length - 1].station, kind: 'end' });
  // colour the start and end nodes like the line they touch
  const segs = items.filter(x => x.type === 'seg' && x.line !== 'walk');
  if (segs.length) { items[0].colour = lineById.get(segs[0].line).colour; items[items.length - 1].colour = lineById.get(segs[segs.length - 1].line).colour; }
  return items;
}
function placeIcons(sid, max = 3) {
  const here = placesAt(sid);
  if (!here.length) return null;
  const box = h('span', { class: 'tl-places', title: here.map(p => p.name + (p.gate ? ` (Gate ${p.gate})` : '')).join(', ') });
  here.slice(0, max).forEach(p => box.append(catIcon(categoryOf(p))));
  if (here.length > max) box.append(h('small', { text: `+${here.length - max}` }));
  return box;
}
function renderTimeline(o) {
  const tl = h('div', { class: 'tl' });
  for (const it of timelineItems(o)) {
    if (it.type === 'node') {
      const node = h('div', { class: 'tl-node ' + it.kind }, h('i', { class: 'dot' }),
        h('div', { class: 'tl-name' }, stationById.get(it.station).name, placeIcons(it.station)));
      if (it.colour) node.style.setProperty('--c', it.colour);
      if (it.kind === 'change') node.append(h('div', { class: 'tl-meta', text: it.walk ? 'walk across' : `change · ${Math.round(it.minutes)} min` }));
      tl.append(node);
    } else {
      const walk = it.line === 'walk', line = walk ? null : lineById.get(it.line);
      const seg = h('div', { class: 'tl-seg' + (walk ? ' walk' : '') },
        h('div', { class: 'tl-line', text: walk ? 'Walk across' : line.name.replace(/ \(.*\)$/, '') }),
        h('div', { class: 'tl-sub', text: walk ? `${Math.round(it.minutes)} min` : `${it.count} stop${it.count > 1 ? 's' : ''} · ${Math.round(it.minutes)} min` }));
      seg.style.setProperty('--c', walk ? 'var(--sage-2)' : line.colour);
      for (const sid of it.stations.slice(0, -1)) {           // the leg's last station is drawn as a node
        const icons = placeIcons(sid);
        if (icons) seg.append(h('div', { class: 'tl-stop' }, stationById.get(sid).name, icons));
      }
      tl.append(seg);
    }
  }
  return tl;
}

// ---- saved journeys (commutes you take often)
function renderJourneys() {
  const ul = $('#journeyList'); ul.textContent = '';
  for (const j of state.journeys) {
    const via = j.stops.length ? ' · via ' + j.stops.map(s => stationById.get(s)?.name).filter(Boolean).join(', ') : '';
    ul.append(h('li', { onclick: () => loadJourney(j.id) },
      h('div', { class: 't' }, h('div', { class: 'n', text: j.name }),
        h('div', { class: 's', text: `${stationById.get(j.from)?.name} → ${stationById.get(j.to)?.name}${via} · ${KIND_LABEL[j.pick] || 'Fastest'}` })),
      h('button', { class: 'icon-btn x', type: 'button', title: 'Delete journey', onclick: e => { e.stopPropagation(); state.journeys = state.journeys.filter(x => x.id !== j.id); persist(); renderJourneys(); } }, '✕')));
  }
  $('#journeyHint').hidden = state.journeys.length > 0;
}
function loadJourney(id) {
  const j = state.journeys.find(x => x.id === id); if (!j) return;
  state.route = { from: j.from, to: j.to, stops: [...j.stops], pick: j.pick || 'fast' };
  computeRoute(); persist(); toast(`Loaded ${j.name}`);
}
$('#routeSave').onclick = () => {
  const r = state.route; if (!r.from || !r.to || !routeResult || routeResult.error) return;
  const via = changeStations(routeResult).map(s => stationById.get(s).name);
  $('#journeyForm').hidden = false;
  const input = $('#journeyName');
  input.value = `${stationById.get(r.from).name} → ${stationById.get(r.to).name}${via.length ? ' via ' + via[0] : ''}`;
  input.focus(); input.select();
};
$('#journeyCancel').onclick = () => { $('#journeyForm').hidden = true; };
$('#journeyForm').addEventListener('submit', e => {
  e.preventDefault();
  const r = state.route; if (!r.from || !r.to) return;
  const name = $('#journeyName').value.trim() || `${stationById.get(r.from).name} → ${stationById.get(r.to).name}`;
  state.journeys.push({ id: Date.now().toString(36), name, from: r.from, to: r.to, stops: [...r.stops], pick: (routeResult && routeResult.mode) || 'fast' });
  $('#journeyForm').hidden = true; persist(); renderJourneys(); toast(`Saved "${name}"`);
});
$('#routeClear').onclick = () => { state.route = { from: null, to: null, stops: [], pick: 'fast' }; computeRoute(); persist(); };
$('#routeSwap').onclick = () => { const r = state.route; [r.from, r.to] = [r.to, r.from]; r.stops.reverse(); computeRoute(); persist(); };
$('#routeFrom').onclick = () => { if (state.route.from) { centerOn(state.route.from); } };
$('#routeTo').onclick = () => { if (state.route.to) { centerOn(state.route.to); } };

// ---------------------------------------------------------------- lists
const placeIcon = p => catIcon(categoryOf(p));
function renderPlacesList() {
  const ul = $('#placesList'); ul.textContent = '';
  const onRoute = routeResult && !routeResult.error ? routeResult.stations : null;
  const cat = state.settings.cat || 'all';
  const list = Object.values(state.places).filter(p => {
    if (cat !== 'all' && categoryOf(p) !== cat) return false;
    const st = placeState(p);
    if (placeFilter === 'route') return onRoute && onRoute.has(p.station);
    if (placeFilter === 'all') return true;
    return st === placeFilter;
  }).sort((a, b) => a.name.localeCompare(b.name));
  for (const p of list) {
    const st = placeState(p);
    const li = h('li', { class: onRoute && onRoute.has(p.station) ? 'on-route' : '', onclick: () => openPlace(p.id),
      onmouseenter: () => highlightPlace(p.id, true), onmouseleave: () => highlightPlace(p.id, false) },
      placeIcon(p),
      h('div', { class: 't' }, h('div', { class: 'n', text: p.name }), h('div', { class: 's', text: (stationById.get(p.station)?.name || '—') + (p.gate ? ' · Gate ' + p.gate : '') })),
      st !== 'saved' ? h('span', { class: 'tag ' + st, text: st === 'next' ? 'next up' : st }) : null);
    ul.append(li);
  }
  if (!list.length && Object.keys(state.places).length) ul.append(h('li', { class: 'muted', text: placeFilter === 'route' ? 'No saved places on this journey.' : 'Nothing here yet.' }));
  markScroll(ul);
  renderUpcoming();
}
// The lists show five rows and scroll inside themselves; a fade at the foot says there is more below.
function markScroll(ul) { ul.classList.toggle('more', ul.scrollHeight - ul.scrollTop - ul.clientHeight > 4); }
for (const id of ['#placesList', '#upcomingList']) $(id).addEventListener('scroll', e => markScroll(e.currentTarget), { passive: true });
// Hovering a place in the list lights up its station on the map.
function highlightPlace(id, on) { const p = state.places[id]; const c = p && stationEls.get(p.station); if (c) c.classList.toggle('hi', on); }
function renderUpcoming() {
  const ul = $('#upcomingList'); ul.textContent = '';
  const list = Object.values(state.places).filter(p => p.when && p.status !== 'visited')
    .sort((a, b) => (a.when.date + pad2(a.when.minutes ?? 0)).localeCompare(b.when.date + pad2(b.when.minutes ?? 0)));
  for (const p of list) {
    ul.append(h('li', { onclick: () => openPlace(p.id) }, placeIcon(p),
      h('div', { class: 't' }, h('div', { class: 'n', text: p.name }), h('div', { class: 's', text: (stationById.get(p.station)?.name || '') + (p.gate ? ' · Gate ' + p.gate : '') })),
      h('div', { class: 'when', text: fmtWhen(p.when) })));
  }
  $('#upcomingHint').hidden = list.length > 0;
  markScroll(ul);
}
$('#placeFilters').addEventListener('click', e => {
  const b = e.target.closest('.filter'); if (!b) return;
  placeFilter = b.dataset.f;
  $$('#placeFilters .filter').forEach(x => x.classList.toggle('sel', x === b));
  renderPlacesList();
});
// Category filter: narrows the list and, on the map, shows that category's icon at its stations.
$('#catFilters').addEventListener('click', e => {
  const b = e.target.closest('.filter'); if (!b) return;
  state.settings.cat = b.dataset.c;
  applySettings(); renderPlaces(); renderPlacesList(); persist();
});

// ---------------------------------------------------------------- search
const searchIn = $('#search'), results = $('#searchResults');
let searchSel = -1;
function runSearch() {
  const q = searchIn.value.trim().toLowerCase();
  results.textContent = ''; searchSel = -1;
  if (q.length < 2) { results.hidden = true; return; }
  const out = [];
  for (const p of Object.values(state.places)) if (p.name.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q)) out.push({ kind: 'place', p });
  for (const s of NET.stations) if (s.name.toLowerCase().includes(q) && (state.settings.regional || !isRegionalStation(s))) out.push({ kind: 'station', s });
  out.sort((a, b) => { const an = a.kind === 'place' ? a.p.name : a.s.name, bn = b.kind === 'place' ? b.p.name : b.s.name; const ai = an.toLowerCase().startsWith(q) ? 0 : 1, bi = bn.toLowerCase().startsWith(q) ? 0 : 1; return ai - bi || an.localeCompare(bn); });
  for (const r of out.slice(0, 9)) {
    if (r.kind === 'place') results.append(h('li', { onclick: () => { pickResult(r); } }, placeIcon(r.p), r.p.name, h('span', { class: 'kind', text: stationById.get(r.p.station)?.name || 'place' })));
    else results.append(h('li', { onclick: () => { pickResult(r); } }, r.s.name, h('span', { class: 'kind', text: r.s.lines.map(l => lineById.get(l).name.split(' ')[0]).join(' · ') })));
  }
  results.hidden = !out.length;
}
function pickResult(r) {
  results.hidden = true; searchIn.value = '';
  if (r.kind === 'place') { centerOn(r.p.station, 3.5); openPlace(r.p.id); }
  else { centerOn(r.s.id, 3.5); openStationPopover(r.s.id); }
}
searchIn.addEventListener('input', runSearch);
searchIn.addEventListener('keydown', e => {
  const items = $$('li', results);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((li, i) => li.classList.toggle('sel', i === searchSel)); }
  else if (e.key === 'Enter') { (items[searchSel >= 0 ? searchSel : 0])?.click(); }
  else if (e.key === 'Escape') { results.hidden = true; searchIn.blur(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) results.hidden = true; });

// ---------------------------------------------------------------- time capsule (modal)
const modal = $('#modal');
let modalPlace = null, modalDate = null, removeArmed = 0;
function buildDateStrip(selected) {
  const strip = $('#mDates'); strip.textContent = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = 60;
  const dates = [];
  for (let i = 0; i < days; i++) { const d = new Date(today); d.setDate(d.getDate() + i); dates.push(isoDate(d)); }
  if (selected && !dates.includes(selected)) dates.push(selected);
  dates.sort();
  for (const iso of dates) {
    const d = new Date(iso + 'T00:00:00');
    const chip = h('div', { class: 'date-chip' + (iso === selected ? ' sel' : '') + (iso === todayISO() ? ' today' : ''), 'data-d': iso, onclick: () => { modalDate = modalDate === iso ? null : iso; $$('.date-chip', strip).forEach(c => c.classList.toggle('sel', c.dataset.d === modalDate)); } },
      h('small', { text: d.toLocaleDateString(undefined, { weekday: 'short' }) }), h('b', { text: String(d.getDate()) }), h('small', { text: d.toLocaleDateString(undefined, { month: 'short' }) }));
    strip.append(chip);
  }
  requestAnimationFrame(() => { const sel = strip.querySelector('.sel'); if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' }); });
}
function updateSky() {
  const m = +$('#mTime').value;
  $('#mTimeLabel').textContent = fmtTime(m);
  $('#mSky').classList.toggle('night', m >= 18 * 60 + 30 || m < 6 * 60);
}
$('#mTime').addEventListener('input', updateSky);
function openPlace(id) {
  const p = state.places[id]; if (!p) return;
  modalPlace = id; modalDate = p.when ? p.when.date : null; removeArmed = 0;
  $('#mName').textContent = p.name;
  const st = stationById.get(p.station);
  $('#mStation').textContent = (st ? st.name : 'Unknown station') + (p.distanceM ? ` · ${p.distanceM < 1000 ? p.distanceM + ' m' : (p.distanceM / 1000).toFixed(1) + ' km'} from the station` : '') + (p.tags && p.tags.length ? ` · ${p.tags.join(', ')}` : '');
  $('#mNotes').value = p.notes || '';
  $('#mGate').value = p.gate || '';
  $('#mCategory').value = categoryOf(p);
  $('#mSourceRow').hidden = !p.source; $('#mSource').textContent = p.source || '';
  $$('#mStatus .status').forEach(b => b.classList.toggle('sel', b.dataset.s === (p.status || 'saved')));
  buildDateStrip(modalDate);
  $('#mTime').value = p.when && p.when.minutes != null ? p.when.minutes : 1080; updateSky();
  $('#mRemove').textContent = 'Remove';
  const r = state.route;
  $('#mAddStop').hidden = !(r.from && r.to && p.station !== r.from && p.station !== r.to && !r.stops.includes(p.station));
  modal.hidden = false;
  highlightPlace(id, true);
  $('#mNotes').focus({ preventScroll: true });
}
function closeModal() { if (modalPlace) highlightPlace(modalPlace, false); modal.hidden = true; modalPlace = null; }
$('#mClose').onclick = closeModal;
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
$('#mStatus').addEventListener('click', e => { const b = e.target.closest('.status'); if (!b) return; $$('#mStatus .status').forEach(x => x.classList.toggle('sel', x === b)); });
$('#mSave').onclick = () => {
  const p = state.places[modalPlace]; if (!p) return;
  p.notes = $('#mNotes').value.trim();
  p.gate = $('#mGate').value.replace(/^gate\s*(number|no\.?)?\s*/i, '').trim();
  p.category = CAT_LABEL[$('#mCategory').value] ? $('#mCategory').value : categoryOf(p);
  p.status = $('#mStatus .status.sel')?.dataset.s || 'saved';
  p.when = modalDate ? { date: modalDate, minutes: +$('#mTime').value } : null;
  afterChange(); closeModal();
  toast(p.when ? `${p.name} · ${fmtWhen(p.when)}` : 'Saved');
};
$('#mUnschedule').onclick = () => { modalDate = null; $$('.date-chip').forEach(c => c.classList.remove('sel')); };
$('#mRemove').onclick = () => {
  if (Date.now() - removeArmed > 3000) { removeArmed = Date.now(); $('#mRemove').textContent = 'Click again to remove'; setTimeout(() => { if (modal.hidden === false) $('#mRemove').textContent = 'Remove'; }, 3000); return; }
  const p = state.places[modalPlace]; delete state.places[modalPlace];
  afterChange(); closeModal(); toast(`Removed ${p.name}`);
};
$('#mAddStop').onclick = () => { const p = state.places[modalPlace]; if (p) addStop(p.station); closeModal(); };
$('#mCopy').onclick = async () => { toast(await copyText($('#mSource').textContent) ? 'Link copied' : 'Could not copy'); };

function afterChange() { renderPlaces(); applyRoute(); persist(); }

// ---------------------------------------------------------------- import / export
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) return { rows: [], header: [] };
  const header = rows[0].map(x => x.trim().toLowerCase());
  return { header, rows: rows.slice(1).map(r => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()]))) };
}
// Turn a JSON.parse error into something a person can act on.
function describeJsonError(e, src) {
  let pos = null;
  const m = /position (\d+)/.exec(e.message);
  if (m) pos = +m[1];
  else {                                   // newer engines quote a snippet instead: locate it in the file
    const snip = /"\.\.\.(.+?)"\s*(?:\.\.\.)?\s*is not valid JSON$/s.exec(e.message) || /"(.{4,})"\s*is not valid JSON$/s.exec(e.message);
    if (snip) { const at = src.indexOf(snip[1].replace(/\.\.\.$/, '')); if (at >= 0) pos = at; }
  }
  let where = '';
  if (pos != null) { const before = src.slice(0, pos); where = ` near line ${before.split('\n').length}, column ${pos - before.lastIndexOf('\n')}`; }
  const msg = e.message.replace(/ in JSON at position \d+.*$/, '').replace(/^JSON\.parse: /, '').replace(/,\s*"?\.\.\..*$/s, '').replace(/\s+is not valid JSON$/, '');
  return `Not valid JSON${where}: ${msg}. Common causes: a missing comma between two places, a comma after the last item, or curly quotes instead of straight quotes.`;
}
// Read the file into rows. Returns { rows, kind, note } or throws an Error whose message is meant for the user.
function parsePlaces(text) {
  const t = text.replace(/^﻿/, '').trim();
  if (!t) throw new Error('The file is empty.');
  const looksJson = t.startsWith('{') || t.startsWith('[');
  if (looksJson || /^```/.test(t) || /"places"\s*:/.test(t)) {
    let src = t, note = null;
    if (!looksJson) {                       // a whole AI-chat reply was saved: use the JSON block inside it
      const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fence) src = fence[1].trim();
      else { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) src = t.slice(a, b + 1); }
      note = 'The file had text around the JSON; only the JSON block was used.';
    }
    let j;
    try { j = JSON.parse(src); } catch (e) { throw new Error(describeJsonError(e, src)); }
    if (Array.isArray(j)) return { rows: j, kind: 'json', note };
    if (j && typeof j === 'object') {
      if (Array.isArray(j.places)) {
        if (j.format && j.format !== 'botanical-network/1') note = [note, `Format "${j.format}" is not the one this app writes (botanical-network/1); it was read anyway.`].filter(Boolean).join(' ');
        return { rows: j.places, kind: 'json', note };
      }
      if (j.name || j.station) return { rows: [j], kind: 'json', note };
      throw new Error(`The JSON has no "places" list. Expected {"places": [ … ]} with one object per place; the top level has ${Object.keys(j).length ? 'keys ' + Object.keys(j).slice(0, 6).join(', ') : 'nothing'}.`);
    }
    throw new Error('The JSON is not a list of places.');
  }
  const csv = parseCSV(t);
  if (!csv.header.length) throw new Error('The file is empty.');
  if (!csv.header.some(hd => ['name', 'title', 'place'].includes(hd))) throw new Error(`The CSV has no "name" column. Columns found: ${csv.header.join(', ')}. Needed: name plus station, or name plus lat and lon.`);
  return { rows: csv.rows, kind: 'csv', note: null };
}
// Closest station names to a misspelt one (bigram similarity), for "did you mean".
const bigrams = s => { const t = ` ${s} `, out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
const nameSim = (a, b) => { const x = bigrams(slug(a).replace(/-/g, ' ')), y = bigrams(slug(b).replace(/-/g, ' ')); let i = 0; for (const g of x) if (y.has(g)) i++; return x.size + y.size ? 2 * i / (x.size + y.size) : 0; };
function suggestStations(text, n = 2) {
  const q = bigrams(slug(text).replace(/-/g, ' '));
  if (q.size < 2) return [];
  const scored = [];
  for (const s of NET.stations) {
    if (isRegionalStation(s) && !state.settings.regional) continue;
    const b = bigrams(slug(s.name).replace(/-/g, ' '));
    let inter = 0; for (const g of q) if (b.has(g)) inter++;
    const score = 2 * inter / (q.size + b.size);
    if (score >= 0.45) scored.push([score, s.name]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  // a second suggestion only when it is nearly as good as the first
  return scored.filter((x, i) => i === 0 || x[0] >= 0.85 * scored[0][0]).slice(0, n).map(x => x[1]);
}
const DELHI = { lat: 28.62, lon: 77.2 };
// Validate one row. Returns { place, warnings } or { reason } when it cannot be imported.
function validatePlace(raw) {
  if (!raw || typeof raw !== 'object') return { reason: 'is not a place object' };
  const w = [];
  const name = (raw.name ?? raw.title ?? raw.place ?? '').toString().trim();
  if (!name) return { reason: 'has no name' };
  const num = v => (v === '' || v == null) ? null : (Number.isFinite(parseFloat(v)) ? parseFloat(v) : NaN);
  let lat = num(raw.lat ?? raw.latitude), lon = num(raw.lon ?? raw.lng ?? raw.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lon)) { w.push(`coordinates "${raw.lat ?? raw.latitude}", "${raw.lon ?? raw.lng ?? raw.longitude}" are not numbers; ignored`); lat = lon = null; }
  else if ((lat == null) !== (lon == null)) { w.push('only one of lat/lon was given; ignored'); lat = lon = null; }
  if (lat != null && haversineKm({ lat, lon }, DELHI) > 150) { w.push(`coordinates (${lat}, ${lon}) are ${Math.round(haversineKm({ lat, lon }, DELHI))} km from Delhi; ignored`); lat = lon = null; }
  const sRaw = (raw.station ?? raw.metro ?? raw.nearest_station ?? '').toString().trim();
  let station = sRaw ? resolveStation(sRaw) : null;
  if (sRaw && !station) {
    const sug = suggestStations(sRaw);
    const hint = sug.length ? ` (did you mean ${sug.join(' or ')}?)` : '';
    if (lat != null) { station = nearestStation(lat, lon).station; w.push(`station "${sRaw}" is not in the network${hint}; used the nearest station to its coordinates, ${stationById.get(station).name}`); }
    else return { reason: `station "${sRaw}" is not in the network${hint}` };
  }
  let distanceM = num(raw.distanceM ?? raw.distance_m ?? raw.distance); if (Number.isNaN(distanceM)) distanceM = null;
  if (!station) {
    if (lat == null) return { reason: 'has no station and no coordinates' };
    const n = nearestStation(lat, lon); station = n.station; distanceM = n.distanceM;
  } else if (lat != null && distanceM == null) distanceM = Math.round(haversineKm({ lat, lon }, stationById.get(station)) * 1000);
  let tags = raw.tags ?? [];
  if (typeof tags === 'string') tags = tags.split(/[,|]/).map(x => x.trim()).filter(Boolean);
  if (!Array.isArray(tags)) tags = [];
  const out = { id: (raw.id || slug(name)).toString(), name, station, notes: (raw.notes ?? raw.note ?? raw.description ?? '').toString().trim(), source: (raw.source ?? raw.url ?? raw.link ?? '').toString().trim(), tags: tags.map(String),
    gate: (raw.gate ?? raw.exit ?? raw.exit_gate ?? '').toString().replace(/^gate\s*(number|no\.?)?\s*/i, '').trim() };
  if (lat != null) { out.lat = lat; out.lon = lon; }
  if (distanceM != null) out.distanceM = Math.round(distanceM);
  const catRaw = String(raw.category ?? raw.type ?? raw.kind ?? '').toLowerCase().trim();
  if (catRaw) {
    if (CAT_LABEL[catRaw]) out.category = catRaw;
    else { out.category = inferCategory(out); w.push(`category "${catRaw}" is not one of ${CATEGORIES.map(c => c[0]).join(', ')}; set to ${CAT_LABEL[out.category]}`); }
  }
  if (raw.status != null && raw.status !== '') {
    if (['saved', 'next', 'visited'].includes(raw.status)) out.status = raw.status;
    else w.push(`status "${raw.status}" ignored (use saved, next or visited)`);
  }
  if (raw.when != null && raw.when !== '') {
    if (raw.when && typeof raw.when === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.when.date))) out.when = { date: raw.when.date, minutes: Number.isFinite(+raw.when.minutes) ? +raw.when.minutes : null };
    else w.push('schedule ignored: "when" must be {"date": "YYYY-MM-DD", "minutes": 1080}');
  }
  return { place: out, warnings: w };
}
// The report lists every row of the file in one of three states: imported (with the station it was
// placed at), already in your places (skipped, nothing changed), or skipped with the reason.
const newReport = label => ({ label, fatal: null, note: null, total: 0, imported: [], existing: [], skipped: [] });
const placeKey = p => `${slug(p.name)}|${p.station}`;
const stationName = sid => (stationById.get(sid) || {}).name || String(sid);
function importText(text, label) {
  const report = newReport(label);
  let parsed;
  try { parsed = parsePlaces(text); } catch (e) { report.fatal = e.message; showImportReport(report); return; }
  report.note = parsed.note; report.total = parsed.rows.length;
  if (!parsed.rows.length) { report.fatal = parsed.kind === 'csv' ? 'The CSV has a header row but no places under it.' : 'The places list is empty.'; showImportReport(report); return; }
  const byKey = new Map();               // name|station -> id, so a place saved under another id still counts as existing
  for (const p of Object.values(state.places)) byKey.set(placeKey(p), p.id);
  const fromFile = new Map();            // id -> row label, for places this import has already added
  parsed.rows.forEach((raw, i) => {
    const nm = raw && typeof raw === 'object' ? String(raw.name ?? raw.title ?? raw.place ?? '').trim() : '';
    const row = `${parsed.kind === 'csv' ? 'Row' : 'Place'} ${parsed.kind === 'csv' ? i + 2 : i + 1}${nm ? ` "${nm}"` : ''}`;
    const v = validatePlace(raw);
    if (v.reason) { report.skipped.push({ row, msg: v.reason }); return; }
    const p = v.place, notes = v.warnings;
    let old = state.places[byKey.get(placeKey(p))] || state.places[p.id];
    if (old && old.station !== p.station) {          // same name, different station: a different place
      notes.push(`shares its name with your saved place at ${stationName(old.station)}; kept as a separate place`);
      p.id = `${p.id}-${p.station}`; old = state.places[p.id];
    }
    if (old) {
      const dupRow = fromFile.get(old.id);
      const renamed = slug(old.name) !== slug(p.name) ? ` as "${old.name}"` : '';
      report.existing.push({ row, name: p.name, station: stationName(old.station), gate: old.gate, msg: dupRow ? `already listed as ${dupRow} in this file` : `already exists${renamed}` });
      return;
    }
    let twin = null, best = 0.75;        // closest-named saved place at the same station, if any is close enough
    for (const q of Object.values(state.places)) { if (q.station !== p.station || q.id === p.id) continue; const s = nameSim(q.name, p.name); if (s >= best) { best = s; twin = q; } }
    if (twin) notes.push(`looks like your saved place "${twin.name}" at the same station; remove one if they are the same`);
    state.places[p.id] = Object.assign({ status: 'saved', when: null, category: inferCategory(p) }, p);
    byKey.set(placeKey(p), p.id); fromFile.set(p.id, row);
    report.imported.push({ row, name: p.name, station: stationName(p.station), gate: p.gate, notes });
  });
  if (report.imported.length) { renderPlaces(); applyRoute(); persist(); }
  showImportReport(report);
}
async function importPath(path) {
  const label = path.split(/[\\/]/).pop();
  try { const text = await TAURI.core.invoke('read_text_file', { path }); importText(text, label); }
  catch (e) { const r = newReport(label); r.fatal = `The file could not be read: ${e}`; showImportReport(r); }
}
// ---- import report dialog
const importReport = $('#importReport');
const whereText = it => `${it.name} — ${it.station}${it.gate ? ` (Gate ${it.gate})` : ''}`;
function reportText(r) {
  const lines = [r.fatal ? `Could not import ${r.label}: ${r.fatal}` : `Imported ${r.imported.length} of ${r.total} from ${r.label} (${r.imported.length} new, ${r.existing.length} already saved, ${r.skipped.length} skipped)`];
  if (r.note) lines.push(r.note);
  for (const it of r.imported) { lines.push(`✓ ${whereText(it)}`); for (const n of it.notes) lines.push(`    note: ${n}`); }
  for (const it of r.existing) lines.push(`= ${whereText(it)}: ${it.msg}`);
  for (const s of r.skipped) lines.push(`✗ ${s.row}: ${s.msg}`);
  return lines.join('\n');
}
function showImportReport(r) {
  const body = $('#irBody'); body.textContent = '';
  const n = r.imported.length;
  $('#irTitle').textContent = r.fatal ? `Could not import ${r.label}` : `Imported ${n} of ${r.total} from ${r.label}`;
  $('#irSub').textContent = r.fatal ? 'Nothing was changed.' : `${n} new · ${r.existing.length} already saved · ${r.skipped.length} skipped`;
  if (r.fatal) body.append(h('p', { class: 'ir-fatal', text: r.fatal }));
  if (r.note) body.append(h('p', { class: 'ir-note', text: r.note }));
  const CAP = 80;
  const section = (title, items, cls, render) => {
    if (!items.length) return;
    body.append(h('h4', { text: title }));
    const ul = h('ul', { class: 'ir-list ' + cls });
    items.slice(0, CAP).forEach(it => ul.append(render(it)));
    if (items.length > CAP) ul.append(h('li', { class: 'muted', text: `… and ${items.length - CAP} more (copy the report for the full list)` }));
    body.append(ul);
  };
  const loc = it => h('span', { class: 'ir-loc', text: it.station + (it.gate ? ` · Gate ${it.gate}` : '') });
  section(`Imported (${n})`, r.imported, 'ok', it => h('li', null, h('b', { text: it.name }), ' ', loc(it), ...it.notes.map(t => h('div', { class: 'ir-sub', text: t }))));
  section(`Already in your places (${r.existing.length})`, r.existing, 'dup', it => h('li', null, h('b', { text: it.name }), ' ', loc(it), h('span', { class: 'ir-tag', text: it.msg })));
  section(`Skipped (${r.skipped.length})`, r.skipped, 'bad', it => h('li', null, h('b', { text: it.row }), ' ' + it.msg));
  $('#irCopy').onclick = async () => { toast(await copyText(reportText(r)) ? 'Report copied' : 'Could not copy'); };
  importReport.hidden = false;
}
$('#irClose').onclick = $('#irOk').onclick = () => { importReport.hidden = true; };
importReport.addEventListener('click', e => { if (e.target === importReport) importReport.hidden = true; });
async function importDialog() {
  if (TAURI) {
    const sel = await TAURI.dialog.open({ multiple: true, filters: [{ name: 'Places', extensions: ['json', 'csv', 'txt', 'tsv'] }] });
    if (!sel) return;
    for (const path of Array.isArray(sel) ? sel : [sel]) await importPath(path);
  } else $('#fileInput').click();
}
$('#importBtn').onclick = importDialog;
$('#fileInput').addEventListener('change', e => { for (const file of e.target.files) file.text().then(t => importText(t, file.name)); e.target.value = ''; });
async function exportPlaces() {
  const text = JSON.stringify({ format: 'botanical-network/1', generated: new Date().toISOString(), network: NET.meta.asOf, places: Object.values(state.places) }, null, 2);
  if (TAURI) {
    const path = await TAURI.dialog.save({ defaultPath: 'my-places.json', filters: [{ name: 'Botanical Network places', extensions: ['json'] }] });
    if (!path) return;
    try { await TAURI.core.invoke('write_text_file', { path, contents: text }); toast('Exported'); } catch (e) { toast(String(e)); }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = 'my-places.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
}
$('#exportBtn').onclick = exportPlaces;

// help sheet: how to get a places file written by an AI chat, with the prompt to copy
const help = $('#help');
$('#helpBtn').onclick = () => { help.hidden = false; };
$('#helpClose').onclick = () => { help.hidden = true; };
help.addEventListener('click', e => { if (e.target === help) help.hidden = true; });
$('#helpCopy').onclick = async () => {
  const ta = $('#helpPrompt');
  if (await copyText(ta.value)) { toast('Prompt copied'); return; }
  ta.focus(); ta.select();
  toast(`Select the text and press ${IS_MAC ? '⌘C' : 'Ctrl+C'}`);
};

// drag & drop (Tauri delivers paths; a browser delivers File objects)
const dropOverlay = $('#dropOverlay'), rippleEl = $('#ripple');
function ripple(x, y) {
  rippleEl.style.left = x + 'px'; rippleEl.style.top = y + 'px';
  rippleEl.classList.remove('go'); void rippleEl.offsetWidth; rippleEl.classList.add('go');
}
if (TAURI && TAURI.webview) {
  TAURI.webview.getCurrentWebview().onDragDropEvent(ev => {
    const p = ev.payload;
    if (p.type === 'enter' || p.type === 'over') dropOverlay.hidden = false;
    else if (p.type === 'leave') dropOverlay.hidden = true;
    else if (p.type === 'drop') {
      dropOverlay.hidden = true;
      const s = window.devicePixelRatio || 1;
      if (p.position) ripple(p.position.x / s, p.position.y / s);
      for (const path of p.paths || []) importPath(path);
    }
  }).catch(e => console.warn('drag-drop listener failed', e));
}
let dragDepth = 0;
document.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; dropOverlay.hidden = false; });
document.addEventListener('dragover', e => { e.preventDefault(); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.hidden = true; });
document.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; dropOverlay.hidden = true;
  const r = mapWrap.getBoundingClientRect(); ripple(e.clientX - r.left, e.clientY - r.top);
  for (const file of e.dataTransfer.files) file.text().then(t => importText(t, file.name));
});

// ---------------------------------------------------------------- toast, settings, sidebar, keys
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200); }

function applySettings() {
  const s = state.settings;
  app.classList.toggle('lite', !!s.lite);
  app.classList.toggle('hints', !!s.hints);
  app.classList.toggle('regional-on', !!s.regional);
  app.classList.toggle('labels-all', s.labels === 'all');
  app.classList.toggle('labels-off', s.labels === 'off');
  $('#setLite').checked = !!s.lite; $('#setHints').checked = !!s.hints; $('#setRegional').checked = !!s.regional; $('#setLabels').value = s.labels || 'auto';
  $('#setStyle').value = s.mapStyle === 'geo' ? 'geo' : 'schematic';
  $('#setStyle').disabled = !SCH;
  if (!CAT_LABEL[s.cat] && s.cat !== 'all') s.cat = 'all';
  $$('#catFilters .filter').forEach(x => x.classList.toggle('sel', x.dataset.c === (s.cat || 'all')));
}
$('#setStyle').onchange = e => { state.settings.mapStyle = e.target.value; setMapStyle(e.target.value); persist(); };
$('#setLite').onchange = e => { state.settings.lite = e.target.checked; applySettings(); persist(); };
$('#setHints').onchange = e => { state.settings.hints = e.target.checked; applySettings(); persist(); };
$('#setRegional').onchange = e => { state.settings.regional = e.target.checked; applySettings(); computeRoute(); persist(); };
$('#setLabels').onchange = e => { state.settings.labels = e.target.value; applySettings(); persist(); };

const sidebar = $('#sidebar');
$('#sidebarToggle').onclick = () => sidebar.classList.toggle('collapsed');
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!importReport.hidden) importReport.hidden = true; else if (!help.hidden) help.hidden = true; else if (!modal.hidden) closeModal(); else if (!popover.hidden) closePopover(); else results.hidden = true; }
  else if (e.key === 'Tab' && !e.target.closest('input, textarea, select, button, .pill')) { e.preventDefault(); sidebar.classList.toggle('collapsed'); }
  else if (e.key === '/' && !e.target.closest('input, textarea')) { e.preventDefault(); sidebar.classList.remove('collapsed'); searchIn.focus(); }
  else if ((e.key === '+' || e.key === '=' || e.key === '-') && !e.target.closest('input, textarea, select')) {
    e.preventDefault(); zoomAt(e.key === '-' ? 1 / 1.5 : 1.5, mapWrap.clientWidth / 2, mapWrap.clientHeight / 2);
  }
});

// ---------------------------------------------------------------- boot
(async () => {
  await loadState();
  P = state.settings.mapStyle === 'geo' || !SCH ? GEO : SCH;
  renderNetwork();
  applySettings();
  fitView();
  renderPlaces();
  computeRoute();
  if (TAURI) { try { $('#storageHint').textContent = 'Your places are stored in ' + await TAURI.core.invoke('state_file_path'); } catch { /* ignore */ } }
  else $('#storageHint').textContent = 'Browser mode: places are stored in this browser only.';
  if (!TAURI) window.__bn = { view, baked, zoomAnim, zoomStep, shortest, summarise, planSteps, adj, stationById, lineById, state, NET, validatePlace, inferCategory, nearestStation, haversineKm, resolveStation, importText, get routeOptions() { return routeOptions; }, get moving() { return moving; } };   // browser-mode testing hook
})();

})();
