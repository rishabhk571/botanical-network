"""Generate a schematic (octolinear) layout of the network -> src/data/layout.js

Design rules (the ones professional transit maps follow):
  * every segment runs at 0, 45 or 90 degrees, so lines are perfectly straight;
  * corners are rounded by the renderer, and never fall on a station unless the
    line genuinely turns there;
  * stations along a run are evenly spaced;
  * lines that share a stretch of track are drawn side by side.

Inputs are our own network.json plus tools/layout/anchors.json, where the
interchanges, terminals and any pinned stations are placed by hand on a grid.
Everything between two anchors (bend point, station spacing, label side) is
derived here. Anchors that are not hand-placed fall back to a relaxed
geographic position so the script always produces a complete layout.
"""
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NET_PATH = os.path.join(ROOT, "src", "data", "network.json")
OUT_JS = os.path.join(ROOT, "src", "data", "layout.js")
LAYOUT_DIR = os.path.join(HERE, "layout")
OVERRIDES = os.path.join(LAYOUT_DIR, "anchors.json")
AUTO_OUT = os.path.join(LAYOUT_DIR, "anchors.auto.json")
PREVIEW = os.path.join(LAYOUT_DIR, "preview.png")

S = 26          # minimum station spacing along a run (layout units = px at fit)
SEP = 48        # minimum distance between two auto-placed anchors
GRID = 8
SCALE = 1.85    # geo units (1/1000 deg) -> layout units, for auto anchors only
FISHEYE = 0.82
R0 = 170
OFF = 3.6       # half-gap for lines sharing a stretch of track
SQ2 = math.sqrt(2)

net = json.load(open(NET_PATH, encoding="utf-8"))
stations = {s["id"]: s for s in net["stations"]}
lines = net["lines"]
line_by_id = {l["id"]: l for l in lines}
regional = {l["id"] for l in lines if l.get("kind") == "regional"}

ov = {"anchors": {}, "pins": [], "labels": {}, "bends": {}, "loops": {}}
if os.path.exists(OVERRIDES):
    ov.update({k: v for k, v in json.load(open(OVERRIDES, encoding="utf-8")).items() if not k.startswith("_")})

# ------------------------------------------------------------------ anchors
line_ids_of = defaultdict(set)
for l in lines:
    for sid in l["stations"]:
        line_ids_of[sid].add(l["id"])
terminals = set()
twice = set()
for l in lines:
    terminals.add(l["stations"][0]); terminals.add(l["stations"][-1])
    seen = set()
    for sid in l["stations"]:
        if sid in seen:
            twice.add(sid)          # ring / loop junctions (Maujpur - Babarpur, DLF Phase 2)
        seen.add(sid)
linked = {x for lk in net["links"] for x in (lk["a"], lk["b"])}
anchors = ({sid for sid, ls in line_ids_of.items() if len(ls) >= 2} | terminals | linked | twice
           | set(ov["pins"]) | set(ov["anchors"]))

core = [s for s in stations.values() if not all(l in regional for l in s["lines"])]
latC = sum(s["lat"] for s in core) / len(core); lonC = sum(s["lon"] for s in core) / len(core)
KX = 1000 * math.cos(math.radians(latC)); KY = 1000
def geo(sid):
    s = stations[sid]
    return ((s["lon"] - lonC) * KX * SCALE, (latC - s["lat"]) * KY * SCALE)
cx, cy = geo("rajiv-chowk")
def fisheye(p):
    dx, dy = p[0] - cx, p[1] - cy
    r = math.hypot(dx, dy)
    if r < 1e-9:
        return (cx, cy)
    r2 = R0 * (r / R0) ** FISHEYE
    return (cx + dx / r * r2, cy + dy / r * r2)

pos = {a: list(fisheye(geo(a))) for a in anchors}
pinned = set()
for sid, xy in ov["anchors"].items():
    if sid not in stations:
        sys.exit(f"anchors.json names unknown station {sid!r}")
    pos[sid] = [float(xy[0]), float(xy[1])]; pinned.add(sid)

edges = []
for l in lines:
    seq = l["stations"]
    idx = [i for i, sid in enumerate(seq) if sid in anchors]
    for i, j in zip(idx, idx[1:]):
        edges.append((seq[i], seq[j], j - i - 1, l["id"]))

def octo_len(dx, dy):
    ax, ay = abs(dx), abs(dy)
    return max(ax, ay) + min(ax, ay) * (SQ2 - 1)

def relax(iters=600):
    """Only moves anchors that are not hand-placed."""
    free = [a for a in sorted(anchors) if a not in pinned]
    if not free:
        return
    alist = sorted(anchors)
    for it in range(iters):
        disp = defaultdict(lambda: [0.0, 0.0])
        for a, b, n, lid in edges:
            dx, dy = pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]
            d = math.hypot(dx, dy) or 1.0
            need = (n + 1) * S
            L = octo_len(dx, dy)
            if L < need:
                push = (need - L) * 0.5
                disp[a][0] -= dx / d * push; disp[a][1] -= dy / d * push
                disp[b][0] += dx / d * push; disp[b][1] += dy / d * push
            ang = math.atan2(dy, dx)
            snapped = round(ang / (math.pi / 4)) * (math.pi / 4)
            tx, ty = math.cos(snapped) * d, math.sin(snapped) * d
            disp[a][0] -= (tx - dx) * 0.03; disp[a][1] -= (ty - dy) * 0.03
            disp[b][0] += (tx - dx) * 0.03; disp[b][1] += (ty - dy) * 0.03
        for i in range(len(alist)):
            for j in range(i + 1, len(alist)):
                a, b = alist[i], alist[j]
                dx, dy = pos[b][0] - pos[a][0], pos[b][1] - pos[a][1]
                d = math.hypot(dx, dy)
                if d < SEP:
                    d = d or 1.0
                    push = (SEP - d) * 0.5
                    disp[a][0] -= dx / d * push; disp[a][1] -= dy / d * push
                    disp[b][0] += dx / d * push; disp[b][1] += dy / d * push
        damp = 0.5 if it < iters * 0.8 else 0.2
        for a in free:
            pos[a][0] += disp[a][0] * damp; pos[a][1] += disp[a][1] * damp
    for a in free:
        pos[a][0] = round(pos[a][0] / GRID) * GRID; pos[a][1] = round(pos[a][1] / GRID) * GRID

relax()
if anchors - pinned:
    print("auto-placed anchors (consider pinning):", ", ".join(sorted(anchors - pinned)))

# ------------------------------------------------------------------ connectors
def unit(dx, dy):
    d = math.hypot(dx, dy)
    return (dx / d, dy / d) if d > 1e-9 else (0.0, 0.0)

DIRS = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0), "NE": (1, -1), "NW": (-1, -1), "SE": (1, 1), "SW": (-1, 1)}

def connector(A, B, prev_dir, hint=None):
    """Octolinear path from A to B with at most one bend."""
    dx, dy = B[0] - A[0], B[1] - A[1]
    ax, ay = abs(dx), abs(dy)
    if ax < 1e-6 or ay < 1e-6 or abs(ax - ay) < 1e-6:
        return [A, B]
    if hint == "L-h":                       # horizontal leg, then vertical
        return [A, (B[0], A[1]), B]
    if hint == "L-v":                       # vertical leg, then horizontal
        return [A, (A[0], B[1]), B]
    sx, sy = (1 if dx > 0 else -1), (1 if dy > 0 else -1)
    if ax > ay:
        diag = (sx * ay, sy * ay); straight = (sx * (ax - ay), 0.0)
    else:
        diag = (sx * ax, sy * ax); straight = (0.0, sy * (ay - ax))
    opt_a = [A, (A[0] + straight[0], A[1] + straight[1]), B]   # straight first
    opt_b = [A, (A[0] + diag[0], A[1] + diag[1]), B]           # diagonal first
    if hint == "straight-first":
        return opt_a
    if hint == "diag-first":
        return opt_b
    def score(opt):
        d1 = unit(opt[1][0] - opt[0][0], opt[1][1] - opt[0][1])
        s = 2.0 * (d1[0] * prev_dir[0] + d1[1] * prev_dir[1]) if prev_dir else 0.0
        l1 = math.hypot(opt[1][0] - opt[0][0], opt[1][1] - opt[0][1])
        l2 = math.hypot(opt[2][0] - opt[1][0], opt[2][1] - opt[1][1])
        return s + (0.5 if l1 >= l2 else 0.0)
    return opt_a if score(opt_a) >= score(opt_b) else opt_b

def loop_path(A, n, spec):
    """Closed rectangular loop starting and ending at A (e.g. Rapid Metro's Cyber City loop)."""
    first, second = (spec.split("-") + ["W"])[:2]
    d1, d2 = DIRS[first], DIRS[second]
    side = 48
    while 4 * side - 6 * min(22.0, 0.4 * side) < (n + 1) * S:   # room for n stations on the straight parts
        side += GRID
    p1 = (A[0] + d1[0] * side, A[1] + d1[1] * side)
    p2 = (p1[0] + d2[0] * side, p1[1] + d2[1] * side)
    p3 = (A[0] + d2[0] * side, A[1] + d2[1] * side)
    return [A, p1, p2, p3, A]

def place_along(path, n):
    """n evenly spaced points along the straight parts of a polyline.

    The fillet zone around each corner (where the renderer rounds the bend) is
    excluded, so stations never sit on a curve and spacing stays even."""
    if n == 0:
        return []
    segs = [(path[i], path[i + 1]) for i in range(len(path) - 1)]
    lens = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs]
    L = sum(lens)
    corners = []           # (distance along path, fillet half-width)
    acc = 0.0
    for k in range(len(segs) - 1):
        acc += lens[k]
        corners.append((acc, min(22.0, 0.4 * min(lens[k], lens[k + 1]))))
    usable = L - sum(2 * r for _, r in corners)
    out = []
    for k in range(1, n + 1):
        u = usable * k / (n + 1)
        t = u
        for c, r in corners:          # skip over each fillet zone we have passed
            if t >= c - r:
                t += 2 * r
        acc = 0.0
        for (a, b), ln in zip(segs, lens):
            if t <= acc + ln + 1e-9:
                f = (t - acc) / ln if ln else 0
                out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, acc + f * ln))
                break
            acc += ln
    return out

layout_pos = {a: tuple(pos[a]) for a in anchors}
line_vertices = {}     # lid -> [x, y, kind, sid]
pair_of_vertex = {}    # (lid, vertex index) -> anchor pair key, for shared-track offsets
for l in lines:
    lid = l["id"]
    seq = l["stations"]
    idx = [i for i, sid in enumerate(seq) if sid in anchors]
    verts = []
    prev_dir = None
    for i, j in zip(idx, idx[1:]):
        a, b = seq[i], seq[j]
        A, B = layout_pos[a], layout_pos[b]
        n = j - i - 1
        hint = ov["bends"].get(f"{lid}|{a}|{b}") or ov["bends"].get(f"{a}|{b}")
        if a == b:
            path = loop_path(A, n, ov["loops"].get(f"{lid}|{a}", "N-W"))
        else:
            path = connector(A, B, prev_dir, hint)
        mids = place_along(path, n)
        if not verts:
            verts.append([A[0], A[1], "st", a])
        start = len(verts)
        # merge bends and stations in path order
        events = [(sum(math.hypot(path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]) for k in range(m)), "bend", path[m]) for m in range(1, len(path) - 1)]
        events += [(dist, "st", (p[0], p[1], sid)) for (p, sid) in zip(mids, seq[i + 1:j]) for dist in [p[2]]]
        events.sort(key=lambda e: e[0])
        for _, kind, p in events:
            if kind == "bend":
                verts.append([p[0], p[1], "bend", None])
            else:
                verts.append([p[0], p[1], "st", p[2]]); layout_pos[p[2]] = (p[0], p[1])
        verts.append([B[0], B[1], "st", b])
        key = tuple(sorted((a, b)))
        for k in range(start - 1, len(verts) - 1):
            pair_of_vertex[(lid, k)] = key
        prev_dir = unit(B[0] - path[-2][0], B[1] - path[-2][1])
    line_vertices[lid] = verts

# lines sharing an anchor pair run side by side: assign a perpendicular offset per segment
pair_lines = defaultdict(list)
for (lid, k), key in pair_of_vertex.items():
    if lid not in pair_lines[key]:
        pair_lines[key].append(lid)
for lid, verts in line_vertices.items():
    for k in range(len(verts) - 1):
        key = pair_of_vertex.get((lid, k))
        offs = 0.0
        if key and len(pair_lines[key]) > 1:
            group = pair_lines[key]
            offs = (group.index(lid) - (len(group) - 1) / 2) * 2 * OFF
        verts[k].append(round(offs, 2))
    verts[-1].append(0.0)

# ------------------------------------------------------------------ labels
def seg_classes(sid):
    out = set()
    for lid in line_ids_of[sid]:
        vs = line_vertices[lid]
        for k, v in enumerate(vs):
            if v[3] != sid:
                continue
            for m in (k - 1, k + 1):
                if 0 <= m < len(vs):
                    o = vs[m]
                    dx, dy = abs(o[0] - v[0]), abs(o[1] - v[1])
                    out.add("h" if dy < 1e-6 else ("v" if dx < 1e-6 else "d"))
    return out

labels = {}
for sid in stations:
    if sid in ov["labels"]:
        labels[sid] = ov["labels"][sid]; continue
    cls = seg_classes(sid)
    if len(line_ids_of[sid]) >= 2 or sid in terminals:
        labels[sid] = "r"
    elif "h" in cls and "v" not in cls and "d" not in cls:
        labels[sid] = "u45"
    else:
        labels[sid] = "r"

# ------------------------------------------------------------------ output
missing = [sid for sid in stations if sid not in layout_pos]
if missing:
    sys.exit(f"stations without a layout position: {missing}")
xs = [p[0] for p in layout_pos.values()]; ys = [p[1] for p in layout_pos.values()]
minx, miny = min(xs) - 40, min(ys) - 40
out = {
    "stations": {sid: [round(p[0] - minx, 1), round(p[1] - miny, 1), labels[sid]] for sid, p in layout_pos.items()},
    "lines": {lid: [[round(v[0] - minx, 1), round(v[1] - miny, 1), v[2], v[3], v[4]] for v in vs] for lid, vs in line_vertices.items()},
}
os.makedirs(LAYOUT_DIR, exist_ok=True)
json.dump({"anchors": {a: [round(pos[a][0]), round(pos[a][1])] for a in sorted(anchors)}}, open(AUTO_OUT, "w"), indent=1)
with open(OUT_JS, "w", encoding="utf-8") as f:
    f.write("// Generated by tools/build_layout.py - schematic coordinates, do not edit by hand.\n")
    f.write("window.LAYOUT = "); json.dump(out, f, separators=(",", ":")); f.write(";\n")
print(f"layout: {len(layout_pos)} stations, {len(anchors)} anchors ({len(pinned)} hand-placed), canvas {max(xs)-minx+40:.0f}x{max(ys)-miny+40:.0f}")

# closest pair of stations (spacing sanity check)
items = list(layout_pos.items())
worst = []
for i in range(len(items)):
    for j in range(i + 1, len(items)):
        d = math.hypot(items[i][1][0] - items[j][1][0], items[i][1][1] - items[j][1][1])
        if d < 22:
            worst.append((round(d, 1), items[i][0], items[j][0]))
if worst:
    print("stations closer than 22 units:", sorted(worst)[:12])

# ------------------------------------------------------------------ preview
try:
    from PIL import Image, ImageDraw, ImageFont
    W, H = int(max(xs) - minx + 40), int(max(ys) - miny + 40)
    Z = 1.6
    im = Image.new("RGB", (int(W * Z), int(H * Z)), (244, 241, 234))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 12)
        fontb = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 12)
    except OSError:
        font = fontb = ImageFont.load_default()
    def hexrgb(h):
        h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    for lid, vs in out["lines"].items():
        col = hexrgb(line_by_id[lid]["colour"])
        for k in range(len(vs) - 1):
            a, b = vs[k], vs[k + 1]
            ux, uy = unit(b[0] - a[0], b[1] - a[1]); nx, ny = -uy * a[4], ux * a[4]
            d.line([((a[0] + nx) * Z, (a[1] + ny) * Z), ((b[0] + nx) * Z, (b[1] + ny) * Z)], fill=col, width=5)
    for sid, (x, y, side) in out["stations"].items():
        r = 6 if len(line_ids_of[sid]) >= 2 else 4
        d.ellipse((x * Z - r, y * Z - r, x * Z + r, y * Z + r), fill=(244, 241, 234), outline=(126, 155, 140), width=2)
        name = stations[sid]["name"]
        fnt = fontb if len(line_ids_of[sid]) >= 2 else font
        ink = (59, 70, 64)
        if side in ("u45", "d45"):
            tw = int(d.textlength(name, font=fnt)) + 4
            tmp = Image.new("RGBA", (tw, 16), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((2, 1), name, font=fnt, fill=ink)
            rot = tmp.rotate(45, expand=True, resample=Image.BICUBIC)
            if side == "u45":
                im.paste(rot, (int(x * Z + 6), int(y * Z - rot.height + 2)), rot)
            else:
                im.paste(rot, (int(x * Z - rot.width - 2), int(y * Z - 2)), rot)
        elif side in ("l", "lu", "ld"):
            dy = {"l": 0, "lu": -9, "ld": 9}[side]
            d.text((x * Z - 8, y * Z + dy), name, font=fnt, fill=ink, anchor="rm")
        elif side == "a":
            d.text((x * Z, y * Z - 9), name, font=fnt, fill=ink, anchor="mb")
        elif side == "b":
            d.text((x * Z, y * Z + 9), name, font=fnt, fill=ink, anchor="mt")
        else:
            dy = {"r": 0, "ru": -9, "rd": 9}.get(side, 0)
            d.text((x * Z + 9, y * Z + dy), name, font=fnt, fill=ink, anchor="lm")
    im.save(PREVIEW)
    print("preview:", PREVIEW, im.size)
except ImportError:
    print("Pillow not available; no preview")
