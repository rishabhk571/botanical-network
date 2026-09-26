#!/usr/bin/env python3
"""Turn a list of places into an importable Botanical Network file.

    python tools/make_places.py places.csv -o my-places.json
    python tools/make_places.py places.csv -o my-places.json --geocode

Input: CSV / TSV (header row) or a JSON array of objects. Recognised columns:

    name       required
    lat, lon   decimal degrees (aliases: latitude, longitude, lng)
    notes      free text shown in the tooltip and the place card
    source     the Instagram / Maps link you saved it from
    tags       comma-separated (cafe, food, park ...)
    station    optional metro station name or id - skips the nearest-station search
    gate       preferred exit gate at that station (e.g. 2)
    category   worship | food | sights | monument | nature | culture | activity | shopping | other
               (else the app infers it from tags, name and notes)
    query      optional text to geocode instead of the name (e.g. "Cafe Lota, Pragati Maidan")

With --geocode, rows that have no lat/lon are looked up on OpenStreetMap
Nominatim (1 request per second, bounded to Delhi-NCR). Rows that still have no
coordinates and no station are reported and skipped.

The nearest station is chosen by straight-line distance over the metro network
in src/data/network.json (regional Namo Bharat / Meerut Metro stations are
excluded). The app recomputes it on import if you leave `station` empty.
"""
import argparse
import csv
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NETWORK = os.path.join(os.path.dirname(HERE), "src", "data", "network.json")
NCR_VIEWBOX = "76.70,29.20,77.90,28.20"  # left, top, right, bottom


def slug(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# Everyday station names that differ from the official ones (mirrors src/app.js).
STATION_ALIASES = {
    "rk-ashram-marg": "ramakrishna-ashram-marg", "r-k-ashram-marg": "ramakrishna-ashram-marg",
    "ina": "dilli-haat-ina", "dilli-haat": "dilli-haat-ina",
    "huda-city-centre": "millennium-city-centre-gurugram", "huda-city-center": "millennium-city-centre-gurugram",
    "pragati-maidan": "supreme-court", "udyog-bhawan": "seva-teerth", "race-course": "lok-kalyan-marg",
    "igi-airport": "airport-t-3", "airport": "airport-t-3", "terminal-3": "airport-t-3", "terminal-1": "terminal-1-igi-airport",
    "nsp": "netaji-subhash-place", "qutub-minar": "qutab-minar", "tughlaqabad": "tughlakabad", "chhattarpur": "chhatarpur",
    "vishwa-vidyalaya": "vishwavidyalaya", "hazrat-nizamuddin": "sarai-kale-khan-nizamuddin",
    "mayur-vihar-1": "mayur-vihar-i", "mayur-vihar-phase-1": "mayur-vihar-i", "karkardooma": "karkarduma",
    "jln-stadium": "jawaharlal-nehru-stadium", "moti-bagh": "sir-m-vishweshwaraiah-moti-bagh",
    "south-campus": "durgabai-deshmukh-south-campus", "rk-puram": "r-k-puram", "badarpur": "badarpur-border",
    "jamia": "jamia-millia-islamia", "kalkaji": "kalkaji-mandir", "connaught-place": "rajiv-chowk",
}


def resolve_station(text, by_id, by_slug):
    raw = (text or "").strip()
    if not raw:
        return None
    if raw in by_id:
        return raw
    s = re.sub(r"-metro(-station)?$", "", slug(raw))
    s = re.sub(r"-station$", "", s)
    return by_slug.get(s) or STATION_ALIASES.get(s)


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def load_network():
    with open(NETWORK, encoding="utf-8") as f:
        net = json.load(f)
    regional = {l["id"] for l in net["lines"] if l.get("kind") == "regional"}
    core = [s for s in net["stations"] if not all(l in regional for l in s["lines"])]
    by_id = {s["id"]: s for s in net["stations"]}
    by_slug = {slug(s["name"]): s["id"] for s in net["stations"]}
    return core, by_id, by_slug


def nearest(core, lat, lon):
    best, bd = None, float("inf")
    for s in core:
        d = haversine_km(lat, lon, s["lat"], s["lon"])
        if d < bd:
            best, bd = s, d
    return best["id"], round(bd * 1000)


def read_rows(path):
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    t = text.strip()
    if t.startswith("[") or t.startswith("{"):
        data = json.loads(t)
        return data if isinstance(data, list) else data.get("places", [])
    dialect = csv.Sniffer().sniff(t[:2048], delimiters=",\t;")
    reader = csv.DictReader(t.splitlines(), dialect=dialect)
    return [{(k or "").strip().lower(): (v or "").strip() for k, v in row.items()} for row in reader]


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def geocode(query):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": 1, "viewbox": NCR_VIEWBOX, "bounded": 1}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "botanical-network-places/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        hits = json.load(resp)
    time.sleep(1.1)  # Nominatim usage policy: max 1 request/second
    if not hits:
        return None
    return float(hits[0]["lat"]), float(hits[0]["lon"]), hits[0].get("display_name", "")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("-o", "--output", default="my-places.json")
    ap.add_argument("--geocode", action="store_true", help="look up missing coordinates on Nominatim")
    args = ap.parse_args()

    core, by_id, by_slug = load_network()
    rows = read_rows(args.input)
    places, skipped = [], []
    for row in rows:
        name = (row.get("name") or row.get("title") or "").strip()
        if not name:
            continue
        lat = num(row.get("lat") or row.get("latitude"))
        lon = num(row.get("lon") or row.get("lng") or row.get("longitude"))
        station = None
        s_raw = (row.get("station") or "").strip()
        if s_raw:
            station = resolve_station(s_raw, by_id, by_slug)
            if not station:
                print(f"  ! unknown station '{s_raw}' for {name}, will use coordinates", file=sys.stderr)
        matched = ""
        if (lat is None or lon is None) and args.geocode:
            q = (row.get("query") or "").strip() or f"{name}, Delhi"
            hit = geocode(q)
            if hit:
                lat, lon, matched = hit
                print(f"  geocoded {name!r} -> {matched[:70]}", file=sys.stderr)
            else:
                print(f"  ! no geocode hit for {q!r}", file=sys.stderr)
        distance_m = None
        if lat is not None and lon is not None:
            if station:
                st = by_id[station]
                distance_m = round(haversine_km(lat, lon, st["lat"], st["lon"]) * 1000)
            else:
                station, distance_m = nearest(core, lat, lon)
        if not station:
            skipped.append(name)
            continue
        tags = row.get("tags") or []
        if isinstance(tags, str):
            tags = [t.strip() for t in re.split(r"[,|]", tags) if t.strip()]
        place = {
            "id": (row.get("id") or slug(name)),
            "name": name,
            "station": station,
            "notes": (row.get("notes") or row.get("note") or "").strip(),
            "source": (row.get("source") or row.get("url") or row.get("link") or "").strip(),
            "tags": tags,
        }
        gate = re.sub(r"^gate\s*(number|no\.?)?\s*", "", (row.get("gate") or row.get("exit") or "").strip(), flags=re.I)
        if gate:
            place["gate"] = gate
        category = (row.get("category") or row.get("type") or "").strip().lower()
        if category in {"worship", "food", "sights", "monument", "nature", "culture", "activity", "shopping", "other"}:
            place["category"] = category      # otherwise the app infers it from tags, name and notes
        if lat is not None and lon is not None:
            place["lat"], place["lon"] = round(lat, 6), round(lon, 6)
        if distance_m is not None:
            place["distanceM"] = distance_m
        if matched:
            place["geocoded"] = matched
        places.append(place)

    out = {"format": "botanical-network/1", "generated": time.strftime("%Y-%m-%d"), "places": places}
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(places)} places to {args.output}")
    for p in places:
        st = by_id[p["station"]]
        d = f'{p["distanceM"]} m' if "distanceM" in p else "?"
        g = f' gate {p["gate"]}' if p.get("gate") else ""
        print(f"  {p['name']:<36} -> {st['name']:<32} {d:>8}{g}")
    if skipped:
        print(f"skipped (no station or coordinates): {', '.join(skipped)}", file=sys.stderr)


if __name__ == "__main__":
    main()
