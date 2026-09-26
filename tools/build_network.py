"""Build src/data/network.js + network.json from OpenStreetMap route relations.

Source data (fetched from the Overpass API, Sept 2026):
  ref/osm_routes.json     - type=route relations for Delhi Metro / Noida Metro / Rapid Metro
  ref/osm_stopnodes.json  - every stop_position node referenced by those relations
  ref/extra_lines.json    - hand-maintained lines that OSM has no relation for (Namo Bharat)

The operational network was cross-checked against DMRC's official
"Metro Network in Delhi-NCR" map (as on August 2026).
"""
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(HERE, "ref")
OUT_DIR = os.path.join(ROOT, "src", "data")


def load(name):
    with open(os.path.join(REF, name), encoding="utf-8-sig") as f:
        return json.load(f)["elements"]


stops = {e["id"]: e for e in load("osm_stopnodes.json")}
routes = {e["id"]: e for e in load("osm_routes.json")}

# OSM name -> display name used by DMRC / this app
RENAME = {
    "A.I.I.M.S.": "AIIMS",
    "Vishwa Vidyalaya": "Vishwavidyalaya",
    "Dwarka - Kakrola": "Dwarka",
    "Rohini Sector 18, 19": "Rohini Sector 18-19",
    "M G Road": "MG Road",
    "Barakhambha Road": "Barakhamba Road",
    "Surajmal Stadium": "Maharaja Surajmal Stadium",
    "Brigadier Hoshiyar Singh": "Brigadier Hoshiar Singh",
    "Satguru Ramsingh Marg": "Satguru Ram Singh Marg",
    "Badarpur": "Badarpur Border",
    "N.H.P.C. Chowk": "NHPC Chowk",
    "Sector 28": "Sector 28 Faridabad",
    "Badhkal Mor": "Badkal Mor",
    "Maujpur-Babarpur": "Maujpur - Babarpur",
    "R. K. Puram": "R.K. Puram",
    "IGI Airport": "Airport (T-3)",
    "New Delhi Airport Express Terminal": "New Delhi",
    "Depot Station": "Depot",
    "Rainbow Metro Station": "Noida Sector 50",
    "Moulsari Avenue Station": "Moulsari Avenue",
    "Phase 3 Station": "DLF Phase 3",
    "Sector 42-43": "Sector 42-43 (Gurugram)",
    "Sector 53-54": "Sector 53-54 (Gurugram)",
    "Sector 54 Chowk": "Sector 54 Chowk (Gurugram)",
    "Sector 55-56": "Sector 55-56 (Gurugram)",
}
SUFFIX = re.compile(
    r"\s*\((?:Blue|Pink|Red|Yellow|Magenta|Violet|Grey|Green|Orange|Aqua) Line\)\s*$", re.I
)


def fix_mojibake(n):
    """PowerShell decoded the Overpass body as Latin-1 before saving; undo that."""
    if "Ã" not in n and "â" not in n:
        return n
    for enc in ("latin-1", "cp1252"):
        try:
            return n.encode(enc).decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
    return n


def norm_name(n):
    n = fix_mojibake(n)
    n = n.replace("–", "-").replace("—", "-").strip()
    n = SUFFIX.sub("", n)
    n = re.sub(r"\s+", " ", n)
    return RENAME.get(n, n)


def slug(n):
    s = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s


# id, display name, official colour, OSM relation ids (one direction), colour family,
# typical headway in minutes (blend of peak and off-peak; the router waits half of it when boarding)
LINES = [
    ("red", "Red Line", "#E4002B", [447214], "red", 3.5),
    ("yellow", "Yellow Line", "#FFD200", [447210], "yellow", 2.5),
    ("blue", "Blue Line", "#0057A8", [447209], "blue", 3),
    ("blue-branch", "Blue Line (Yamuna Bank - Vaishali)", "#0057A8", [2535795], "blue", 6),
    ("green", "Green Line", "#00A651", [8037666], "green", 4.5),
    ("green-branch", "Green Line (Kirti Nagar - Ashok Park Main)", "#00A651", [2535796], "green", 9),
    ("violet", "Violet Line", "#6E2C91", [2535797], "violet", 3.5),
    ("pink", "Pink Line", "#E8368F", [8241298], "pink", 5.5),
    ("magenta", "Magenta Line", "#C21F8F", [8385429], "magenta", 5),
    ("magenta-north", "Magenta Line (Majlis Park - Deepali Chowk)", "#C21F8F", [20300114], "magenta", 7),
    ("grey", "Grey Line", "#8C8C8C", [3537978], "grey", 8),
    ("orange", "Airport Express (Orange Line)", "#F58220", [2535798], "orange", 10),
    ("aqua", "Aqua Line (Noida Metro)", "#00B5CC", [9268568], "aqua", 7.5),
    ("rapid", "Rapid Metro Gurugram", "#4A4A4A", [4481323], "rapid", 4),
]

stations = {}
lines_out = []


def add_station(name, lat, lon, line_id):
    sid = slug(name)
    st = stations.setdefault(sid, {"id": sid, "name": name, "lines": [], "pts": []})
    st["pts"].append((lat, lon))
    if line_id not in st["lines"]:
        st["lines"].append(line_id)
    return sid


for lid, lname, colour, relids, group, headway in LINES:
    seq = []
    for rid in relids:
        rel = routes[rid]
        for m in rel["members"]:
            if m["type"] == "node" and "stop" in m["role"]:
                n = stops[m["ref"]]
                name = norm_name(n["tags"]["name"])
                seq.append(add_station(name, n["lat"], n["lon"], lid))
    seq = [s for i, s in enumerate(seq) if i == 0 or s != seq[i - 1]]
    lines_out.append({"id": lid, "name": lname, "colour": colour, "group": group, "headway": headway, "stations": seq})

# Hand-maintained lines (no usable OSM relation): see ref/extra_lines.json
extra_path = os.path.join(REF, "extra_lines.json")
if os.path.exists(extra_path):
    with open(extra_path, encoding="utf-8") as f:
        for line in json.load(f):
            seq = []
            for st in line["stations"]:
                seq.append(add_station(st["name"], st["lat"], st["lon"], line["id"]))
            lines_out.append(
                {
                    "id": line["id"],
                    "name": line["name"],
                    "colour": line["colour"],
                    "group": line["group"],
                    "headway": line.get("headway", 10),
                    "stations": seq,
                    "kind": line.get("kind", "metro"),
                }
            )

for st in stations.values():
    pts = st.pop("pts")
    st["lat"] = round(sum(p[0] for p in pts) / len(pts), 6)
    st["lon"] = round(sum(p[1] for p in pts) / len(pts), 6)

# Walkway / footbridge interchanges between differently named stations
LINKS = [
    ("durgabai-deshmukh-south-campus", "dhaula-kuan", "walkway", 8),
    ("noida-sector-52", "noida-sector-51", "walkway", 8),
]
extra_links_path = os.path.join(REF, "extra_links.json")
if os.path.exists(extra_links_path):
    with open(extra_links_path, encoding="utf-8") as f:
        LINKS += [tuple(x) for x in json.load(f)]
for a, b, kind, mins in LINKS:
    missing = [x for x in (a, b) if x not in stations]
    if missing:
        sys.exit(f"link references unknown station(s): {missing}")

groups = {}
for line in lines_out:
    for sid in line["stations"]:
        groups.setdefault(sid, set()).add(line["group"])
interchanges = sorted(sid for sid, g in groups.items() if len(g) > 1)

# platform-to-platform walking minutes at interchanges (tools/ref/interchanges.json)
ix_path = os.path.join(REF, "interchanges.json")
ix = {"default": 3, "stations": {}, "pairs": {}}
if os.path.exists(ix_path):
    with open(ix_path, encoding="utf-8") as f:
        ix.update({k: v for k, v in json.load(f).items() if not k.startswith("_")})
unknown = [s for s in ix["stations"] if s not in stations]
if unknown:
    sys.exit(f"interchanges.json names unknown station(s): {unknown}")

out = {
    "meta": {
        "title": "Metro Network in Delhi-NCR",
        "asOf": "2026-08",
        "source": "OpenStreetMap route relations (ODbL), cross-checked with DMRC official map (Aug 2026)",
        "stationCount": len(stations),
        "lineCount": len(lines_out),
    },
    "lines": lines_out,
    "stations": sorted(stations.values(), key=lambda s: s["name"]),
    "links": [{"a": a, "b": b, "kind": k, "minutes": m} for a, b, k, m in LINKS],
    "interchanges": ix,
}

os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "network.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
with open(os.path.join(OUT_DIR, "network.js"), "w", encoding="utf-8") as f:
    f.write("// Generated by tools/build_network.py - do not edit by hand.\n")
    f.write("window.NETWORK = ")
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    f.write(";\n")

print(f"lines: {len(lines_out)}")
for line in lines_out:
    print(f"  {line['id']:<14} {len(line['stations']):>3} stations  {line['stations'][0]} -> {line['stations'][-1]}")
print(f"stations: {len(stations)}  interchanges (across colour families): {len(interchanges)}")
print("interchanges:", ", ".join(interchanges))
