#!/usr/bin/env python3
"""Fetch and build verified public heritage, boundary, footfall, and ASI budget datasets for India."""

import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "public" / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

SOI_URL = "https://raw.githubusercontent.com/datameet/maps/master/Country/india-soi.geojson"
LSIB_DISPUTED_URL = "https://raw.githubusercontent.com/datameet/maps/master/Country/disputed/india-disputed-lsib.geojson"
POK_DISPUTED_URL = "https://raw.githubusercontent.com/datameet/maps/master/Country/disputed/pok-districts-alhasan.geojson"
SHAKSGAM_DISPUTED_URL = "https://raw.githubusercontent.com/datameet/maps/master/Country/disputed/shaksgam-ne.geojson"
NE_GEOG_POLYS_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_regions_polys.geojson"
NE_GLACIERS_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_glaciated_areas.geojson"

WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
UNESCO_URL = (
    "https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/records"
    "?where=search(states_names%2C%20%22India%22)&limit=60"
)

ASI_STATE_CODES = {
    "AN": "Andaman & Nicobar Islands",
    "AP": "Andhra Pradesh",
    "AR": "Arunachal Pradesh",
    "AS": "Assam",
    "BR": "Bihar",
    "CH": "Chandigarh",
    "CG": "Chhattisgarh",
    "DD": "Dadra & Nagar Haveli and Daman & Diu",
    "DL": "Delhi",
    "GA": "Goa",
    "GJ": "Gujarat",
    "HR": "Haryana",
    "HP": "Himachal Pradesh",
    "JK": "Jammu & Kashmir",
    "JH": "Jharkhand",
    "KA": "Karnataka",
    "KL": "Kerala",
    "LA": "Ladakh",
    "LD": "Lakshadweep",
    "MP": "Madhya Pradesh",
    "MH": "Maharashtra",
    "MN": "Manipur",
    "ML": "Meghalaya",
    "MZ": "Mizoram",
    "NL": "Nagaland",
    "OR": "Odisha",
    "OD": "Odisha",
    "PY": "Puducherry",
    "PB": "Punjab",
    "RJ": "Rajasthan",
    "SK": "Sikkim",
    "TN": "Tamil Nadu",
    "TS": "Telangana",
    "TG": "Telangana",
    "TR": "Tripura",
    "UP": "Uttar Pradesh",
    "UK": "Uttarakhand",
    "UA": "Uttarakhand",
    "WB": "West Bengal",
}

# Verified FY 2023-24 ASI Circle Conservation Expenditure (PIB / Ministry of Culture) + ASI Circle counts
ASI_CIRCLE_BUDGETS = {
    "Delhi": {"circle": "Delhi Circle", "monuments": 170, "exp_cr": 36.14, "fy": "2023-24"},
    "Maharashtra": {"circle": "Mumbai / Aurangabad / Nagpur", "monuments": 286, "exp_cr": 15.56, "fy": "2023-24 (Mumbai Circle)"},
    "Telangana": {"circle": "Hyderabad Circle", "monuments": 8, "exp_cr": 14.38, "fy": "2023-24"},
    "Bihar": {"circle": "Patna Circle", "monuments": 70, "exp_cr": 16.00, "fy": "2023-24"},
    "Tamil Nadu": {"circle": "Chennai Circle", "monuments": 257, "exp_cr": 12.95, "fy": "2023-24 (Chennai Circle)"},
    "Rajasthan": {"circle": "Jaipur Circle", "monuments": 88, "exp_cr": 12.75, "fy": "2023-24 (Jaipur Circle)"},
    "West Bengal": {"circle": "Kolkata Circle", "monuments": 86, "exp_cr": 9.10, "fy": "2023-24 (Kolkata Circle)"},
    "Assam": {"circle": "Guwahati Circle", "monuments": 70, "exp_cr": 8.78, "fy": "2023-24"},
    "Madhya Pradesh": {"circle": "Bhopal Circle", "monuments": 183, "exp_cr": 17.22, "fy": "2023-24 (Bhopal Circle)"},
    "Uttar Pradesh": {"circle": "Agra / Lucknow / Sarnath / Jhansi / Meerut", "monuments": 767, "exp_cr": 40.45, "fy": "2023-24 (Agra ₹23.52 Cr + Lucknow ₹16.93 Cr)"},
    "Karnataka": {"circle": "Dharwad / Bangalore / Hampi", "monuments": 506, "exp_cr": 39.16, "fy": "2023-24 (Dharwad ₹9.57 Cr + Blr/Hampi ₹29.59 Cr)"},
}

# Verified ASI Circle Breakdown for comparison chart (PIB / Ministry of Culture)
ASI_CIRCLES_SUMMARY = [
    {"circle": "Dharwad Circle", "state": "Karnataka", "monuments": 282, "exp_cr": 9.57, "fy": "2023-24"},
    {"circle": "Chennai Circle", "state": "Tamil Nadu & Puducherry", "monuments": 257, "exp_cr": 12.95, "fy": "2023-24"},
    {"circle": "Bangalore & Hampi Circles", "state": "Karnataka", "monuments": 224, "exp_cr": 29.59, "fy": "2023-24"},
    {"circle": "Lucknow Circle", "state": "Uttar Pradesh", "monuments": 196, "exp_cr": 16.93, "fy": "2023-24"},
    {"circle": "Agra Circle", "state": "Uttar Pradesh", "monuments": 187, "exp_cr": 23.52, "fy": "2023-24"},
    {"circle": "Bhopal Circle", "state": "Madhya Pradesh", "monuments": 183, "exp_cr": 17.22, "fy": "2023-24"},
    {"circle": "Delhi Circle", "state": "NCT Delhi", "monuments": 170, "exp_cr": 36.14, "fy": "2023-24"},
    {"circle": "Mumbai Circle", "state": "Maharashtra", "monuments": 117, "exp_cr": 15.56, "fy": "2023-24"},
    {"circle": "Jaipur Circle", "state": "Rajasthan", "monuments": 88, "exp_cr": 12.75, "fy": "2023-24"},
    {"circle": "Kolkata Circle", "state": "West Bengal", "monuments": 86, "exp_cr": 9.10, "fy": "2023-24"},
    {"circle": "Patna Circle", "state": "Bihar", "monuments": 70, "exp_cr": 16.00, "fy": "2023-24"},
    {"circle": "Guwahati Circle", "state": "NE States", "monuments": 70, "exp_cr": 8.78, "fy": "2023-24"},
    {"circle": "Hyderabad Circle", "state": "Telangana", "monuments": 8, "exp_cr": 14.38, "fy": "2023-24"},
]

# Verified Monument-Level Footfall & Ticket Revenue (Ministry of Culture / Rajya Sabha FY 2023-24 & 2024-25)
TICKETED_METRICS = [
    {"match": ["taj mahal"], "footfall_lakhs": 67.8, "revenue_cr": 98.55, "fy": "FY 2023-24", "note": "#1 ASI revenue & footfall monument (~69.05L visitors in FY 2024-25)"},
    {"match": ["sun temple, konark", "konark sun temple"], "footfall_lakhs": 35.0, "revenue_cr": 12.70, "fy": "FY 2023-24", "note": "Top domestic footfall draw in Eastern India"},
    {"match": ["qutub minar", "qutb minar"], "footfall_lakhs": 33.4, "revenue_cr": 23.80, "fy": "FY 2023-24", "note": "#2 ASI ticket revenue monument nationwide"},
    {"match": ["red fort", "lal qila"], "footfall_lakhs": 28.7, "revenue_cr": 18.09, "fy": "FY 2023-24", "note": "#3 ASI ticket revenue monument nationwide"},
    {"match": ["agra fort"], "footfall_lakhs": 16.2, "revenue_cr": 15.30, "fy": "FY 2023-24", "note": "Top-3 foreign visitor destination alongside Taj Mahal & Qutub Minar"},
    {"match": ["ellora caves"], "footfall_lakhs": 15.5, "revenue_cr": 7.10, "fy": "FY 2023-24", "note": "Major rock-cut UNESCO hub in Maharashtra"},
    {"match": ["humayun's tomb", "humayun’s tomb"], "footfall_lakhs": None, "revenue_cr": 10.00, "fy": "FY 2023-24", "note": "Major Delhi UNESCO ticketed complex"},
    {"match": ["mamallapuram", "mahabalipuram", "shore temple"], "footfall_lakhs": None, "revenue_cr": 7.40, "fy": "FY 2023-24", "note": "High-pressure coastal monument in Chennai Circle (₹5.04L/site avg circle spend)"},
    {"match": ["fatehpur sikri"], "footfall_lakhs": None, "revenue_cr": 6.70, "fy": "FY 2023-24", "note": "Major Agra Circle ticketed complex"},
    {"match": ["chittorgarh fort", "chittor fort"], "footfall_lakhs": None, "revenue_cr": 4.30, "fy": "FY 2023-24", "note": "High-footfall Rajasthan hill fort"},
]

# Verified 3D Photogrammetry / Digital Heritage Archives (CyArk / Google Open Heritage)
ARCHIVE_3D_LINKS = [
    {"match": ["gateway of india"], "label": "CyArk 3D LiDAR & Photogrammetry", "url": "https://www.cyark.org/projects/gateway-of-india/overview"},
    {"match": ["rani ki vav"], "label": "CyArk 3D Heritage Archive", "url": "https://www.cyark.org/projects/rani-ki-vav/overview"},
    {"match": ["ellora"], "label": "Sketchfab / Cultural Heritage 3D", "url": "https://sketchfab.com/search?q=ellora+caves&type=models"},
    {"match": ["hampi", "vittala", "virupaksha"], "label": "Digital Hampi / Sketchfab 3D", "url": "https://sketchfab.com/search?q=hampi&type=models"},
    {"match": ["taj mahal"], "label": "Sketchfab 3D Photogrammetry", "url": "https://sketchfab.com/search?q=taj+mahal&type=models"},
    {"match": ["konark"], "label": "Sketchfab 3D Archive", "url": "https://sketchfab.com/search?q=konark+sun+temple&type=models"},
    {"match": ["ajanta"], "label": "Sketchfab 3D Archive", "url": "https://sketchfab.com/search?q=ajanta+caves&type=models"},
]

ADOPT_A_HERITAGE = [
    {"match": ["qutub minar", "qutb minar"], "partner": "Ease My Trip Foundation / Yatra Online", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["agra fort"], "partner": "Ease My Trip Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["konark", "sun temple, konark"], "partner": "Ease My Trip Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["kandariya mahadeva", "kandariya temple"], "partner": "Ease My Trip Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["humayun's tomb", "humayun’s tomb"], "partner": "Sabhyata Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["safdarjung", "safdarjung's tomb"], "partner": "Sabhyata Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["purana qila"], "partner": "Sabhyata Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["mehrauli archaeological park", "balban", "jamali kamali"], "partner": "Sabhyata Foundation", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["mamallapuram", "mahabalipuram"], "partner": "Cholamandalam Investment & Finance Co. (CIFCL)", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["kailasanatha temple", "kailasanathar"], "partner": "Cholamandalam Investment & Finance Co. (CIFCL)", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["elephanta caves"], "partner": "Mahesh Enterprises & Infra India Pvt. Ltd.", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["aguada", "fort aguada"], "partner": "Drishti Lifesaving Pvt. Ltd.", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["jantar mantar"], "partner": "Powerlinks Transmission Ltd.", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["agrasen ki baoli", "ugrasen ki baoli"], "partner": "Zee Akash", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["hauz khas"], "partner": "Tata Power Trading Pvt. Ltd.", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["kashmiri gate", "kashmere gate", "delhi gate", "mori gate"], "partner": "Redtape Ltd.", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["kesariya"], "partner": "IDD Trade Council", "program": "Adopt a Heritage 2.0", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["red fort", "lal qila"], "partner": "Dalmia Bharat Pvt. Ltd.", "program": "Adopt a Heritage (Phase 1 legacy)", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
    {"match": ["gandikota"], "partner": "Dalmia Bharat Pvt. Ltd.", "program": "Adopt a Heritage (Phase 1 legacy)", "scope": "Visitor amenities (CSR funded; core conservation by ASI)"},
]

PRASHAD_PROJECTS = [
    {"name": "Development of Amaravati Town", "state": "Andhra Pradesh", "year": "2015–16", "approved_cr": 27.77, "released_cr": 27.77, "progress": "100%", "coords": [80.3580, 16.5720], "wiki": "Amaravati_Stupa"},
    {"name": "Development of Srisailam Temple", "state": "Andhra Pradesh", "year": "2017–18", "approved_cr": 43.08, "released_cr": 43.08, "progress": "100%", "coords": [78.8686, 16.0738], "wiki": "Mallikarjuna_Temple,_Srisailam"},
    {"name": "Simhachalam Temple, Visakhapatnam", "state": "Andhra Pradesh", "year": "2022–23", "approved_cr": 54.04, "released_cr": 27.37, "progress": "~65%", "coords": [83.2505, 17.7663], "wiki": "Varaha_Lakshmi_Narasimha_temple,_Simhachalam"},
    {"name": "Parshuram Kund (Lohit)", "state": "Arunachal Pradesh", "year": "2020–21", "approved_cr": 37.88, "released_cr": 31.02, "progress": "~92%", "coords": [96.3611, 27.8783], "wiki": "Parshuram_Kund"},
    {"name": "Kamakhya Temple & Surroundings, Guwahati", "state": "Assam", "year": "2015–16", "approved_cr": 29.80, "released_cr": 29.80, "progress": "100%", "coords": [91.7055, 26.1665], "wiki": "Kamakhya_Temple"},
    {"name": "Development at Patna Sahib", "state": "Bihar", "year": "2015–16", "approved_cr": 29.62, "released_cr": 29.62, "progress": "100%", "coords": [85.2314, 25.5952], "wiki": "Takht_Sri_Patna_Sahib"},
    {"name": "Vishnupad Temple, Gaya", "state": "Bihar", "year": "2014–15", "approved_cr": 3.63, "released_cr": 3.63, "progress": "100%", "coords": [85.0079, 24.7770], "wiki": "Vishnupad_Temple"},
    {"name": "Development of Bom Jesus Basilica", "state": "Goa", "year": "2024–25", "approved_cr": 16.46, "released_cr": None, "progress": "Initial Stages", "coords": [73.9116, 15.5009], "wiki": "Basilica_of_Bom_Jesus"},
    {"name": "Pilgrimage Amenities & Promenade at Somnath", "state": "Gujarat", "year": "2016–19", "approved_cr": 92.48, "released_cr": 92.48, "progress": "100%", "coords": [70.4012, 20.8880], "wiki": "Somnath_temple"},
    {"name": "Mata Mansa Devi & Nada Saheb Gurudwara", "state": "Haryana", "year": "2019–20", "approved_cr": 48.53, "released_cr": 34.68, "progress": "~74%", "coords": [76.8606, 30.7204], "wiki": "Mansa_Devi_Temple,_Panchkula"},
    {"name": "Hazratbal Shrine, Srinagar", "state": "Jammu & Kashmir", "year": "2016–17", "approved_cr": 40.46, "released_cr": 34.30, "progress": "100%", "coords": [74.8419, 34.1297], "wiki": "Hazratbal_Shrine"},
    {"name": "Baba Baidyanath Dham, Deoghar", "state": "Jharkhand", "year": "2018–19", "approved_cr": 36.79, "released_cr": None, "progress": "On-going", "coords": [86.7000, 24.4925], "wiki": "Baidyanath_Temple"},
    {"name": "Chamundeshwari Devi Temple, Mysuru", "state": "Karnataka", "year": "2023–24", "approved_cr": 45.38, "released_cr": None, "progress": "On-going", "coords": [76.6708, 12.2725], "wiki": "Chamundeshwari_Temple"},
    {"name": "Guruvayur Temple", "state": "Kerala", "year": "2016–17", "approved_cr": 45.19, "released_cr": None, "progress": "On-going", "coords": [76.0392, 10.5945], "wiki": "Guruvayur_Temple"},
    {"name": "Omkareshwar", "state": "Madhya Pradesh", "year": "2017–18", "approved_cr": 43.93, "released_cr": None, "progress": "On-going", "coords": [76.1508, 22.2456], "wiki": "Omkareshwar_Temple"},
    {"name": "Amarkantak", "state": "Madhya Pradesh", "year": "2020–21", "approved_cr": 49.99, "released_cr": None, "progress": "On-going", "coords": [81.7517, 22.6744], "wiki": "Amarkantak"},
    {"name": "Trimbakeshwar, Nashik", "state": "Maharashtra", "year": "2017–18", "approved_cr": 45.41, "released_cr": None, "progress": "On-going", "coords": [73.5308, 19.9322], "wiki": "Trimbakeshwar_Shiva_Temple"},
]


def fetch_json(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(
        url,
        headers=headers or {"User-Agent": "MonumentMapAtlas/1.0 (https://github.com/shashwathsantosh/Monument-Map)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def perpendicular_distance(pt, line_start, line_end):
    x, y = pt
    x1, y1 = line_start
    x2, y2 = line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def rdp(points, epsilon):
    if len(points) < 3:
        return points
    dmax = 0.0
    index = 0
    for i in range(1, len(points) - 1):
        d = perpendicular_distance(points[i], points[0], points[-1])
        if d > dmax:
            index = i
            dmax = d
    if dmax > epsilon:
        left = rdp(points[: index + 1], epsilon)
        right = rdp(points[index:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]


def simplify_ring(ring, epsilon=0.008):
    if len(ring) < 4:
        return [[round(c[0], 4), round(c[1], 4)] for c in ring]
    simplified = rdp(ring[:-1], epsilon)
    if len(simplified) < 3:
        return []
    out = [[round(c[0], 4), round(c[1], 4)] for c in simplified]
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def simplify_geometry(geom, epsilon=0.008):
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        new_rings = [simplify_ring(r, epsilon) for r in coords]
        new_rings = [r for r in new_rings if len(r) >= 4]
        return {"type": "Polygon", "coordinates": new_rings}
    if gtype == "MultiPolygon":
        new_polys = []
        for poly in coords:
            outer = simplify_ring(poly[0], epsilon)
            if len(outer) < 4:
                continue
            holes = [simplify_ring(h, epsilon) for h in poly[1:]]
            holes = [h for h in holes if len(h) >= 4]
            new_polys.append([outer] + holes)
        return {"type": "MultiPolygon", "coordinates": new_polys}
    return geom


def build_india_border():
    print("Downloading Survey of India GeoJSON...")
    raw = fetch_json(SOI_URL)
    simplified_features = []
    for feat in raw.get("features", []):
        simplified_features.append(
            {
                "type": "Feature",
                "properties": {"name": "India (Survey of India)"},
                "geometry": simplify_geometry(feat.get("geometry", {}), 0.008),
            }
        )
    out = {"type": "FeatureCollection", "features": simplified_features}
    out_path = DATA_DIR / "india-border.geojson"
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Saved {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")
    build_india_mask(out)
    return out


def ring_area(ring):
    area = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        area += x1 * y2 - x2 * y1
    return area / 2.0


def build_india_mask(border_geojson):
    world = [[-179.9, -85.0], [179.9, -85.0], [179.9, 85.0], [-179.9, 85.0], [-179.9, -85.0]]
    if ring_area(world) < 0:
        world.reverse()
    holes = []
    for feat in border_geojson.get("features", []):
        geom = feat.get("geometry", {})
        polys = [geom["coordinates"]] if geom.get("type") == "Polygon" else geom.get("coordinates", [])
        for poly in polys:
            outer = poly[0]
            if len(outer) < 4 or abs(ring_area(outer)) < 0.0005:
                continue
            r = list(outer)
            if ring_area(r) > 0:
                r.reverse()
            holes.append(r)
    mask = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "Outside India Mask"},
                "geometry": {"type": "Polygon", "coordinates": [world] + holes},
            }
        ],
    }
    mask_path = DATA_DIR / "india-mask.geojson"
    mask_path.write_text(json.dumps(mask, separators=(",", ":")))
    print(f"Saved {mask_path} ({mask_path.stat().st_size / 1024:.1f} KB)")


def geom_intersects_india(geom):
    def _pts(coords):
        if isinstance(coords[0], (int, float)):
            yield coords
        else:
            for c in coords:
                yield from _pts(c)

    xs, ys = [], []
    for x, y in _pts(geom.get("coordinates", [])):
        xs.append(x)
        ys.append(y)
    return bool(xs and ys and max(xs) > 67.0 and min(xs) < 98.0 and max(ys) > 6.0 and min(ys) < 38.0)


def build_geozones():
    """Extract Indian physiographic & glaciated zones for engraved architectural hatching."""
    zone_styles = {
        "GANGES PLAIN": ("dots-fine", 1),
        "Ganges Delta": ("dots-fine", 1),
        "DECCAN PLATEAU": ("crosshatch-open", 1),
        "Chota Nägpur Plateau": ("crosshatch-open", 1),
        "THAR DESERT": ("stipple-sand", 1),
        "PUNJAB": ("stipple-sand", 1),
        "Kathiawar Pen.": ("stipple-sand", 1),
        "HIMALAYAS": ("plus-grid", 1),
        "KARAKORAM RA.": ("plus-grid", 1),
        "HINDU KUSH": ("plus-grid", 1),
        "Siwalik Hills": ("crosshatch-dense", 2),
        "WESTERN GHATS": ("crosshatch-dense", 2),
        "EASTERN GHATS": ("crosshatch-dense", 2),
        "Southern Ghats": ("crosshatch-dense", 2),
        "Vindhya Range": ("crosshatch-dense", 2),
        "Satpura Range": ("crosshatch-dense", 2),
        "Arvalli Ra.": ("crosshatch-dense", 2),
        "Naga Hills": ("crosshatch-dense", 2),
        "Khasi Hills": ("crosshatch-dense", 2),
        "Malabar Coast": ("mesh-coastal", 2),
        "Coromandel Coast": ("mesh-coastal", 2),
        "Sundarbans": ("mesh-coastal", 2),
        "Vale of Kashmir": ("mesh-coastal", 2),
    }

    print("Downloading Natural Earth physical geography & glacier belts...")
    raw = fetch_json(NE_GEOG_POLYS_URL)
    features = []
    for feat in raw.get("features", []):
        name = feat.get("properties", {}).get("NAME")
        if name not in zone_styles:
            continue
        pattern, ztier = zone_styles[name]
        geom = simplify_geometry(feat.get("geometry", {}), 0.008)
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "pattern": pattern, "tier": ztier},
                "geometry": geom,
            }
        )

    glaciers = fetch_json(NE_GLACIERS_URL)
    for feat in glaciers.get("features", []):
        geom = feat.get("geometry", {})
        if not geom_intersects_india(geom):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"name": "Himalayan Glacier", "pattern": "pocket-grey", "tier": 3},
                "geometry": simplify_geometry(geom, 0.006),
            }
        )

    features.sort(key=lambda f: f["properties"]["tier"])
    out = {"type": "FeatureCollection", "features": features}
    out_path = DATA_DIR / "india-geozones.geojson"
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Saved {len(features)} physiographic/glacier zones to {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


def build_contested_regions():
    print("Downloading contested boundary layers (DataMeet LSIB / PoK / Shaksgam)...")
    contested_features = []

    lsib_labels = {
        "Aksai Chin (disp)": ("Aksai Chin", "Administered by China · Claimed by India"),
        "Siachen-Saltoro (disp)": ("Siachen–Saltoro Glacier", "Administered by India · Contested sector"),
        "CH-IN (disp)": ("Sino-Indian LAC Border Sectors", "Line of Actual Control contested sectors"),
        "Demchok (disp)": ("Demchok Sector", "Contested LAC sector (Ladakh / Tibet)"),
        "Kalapani (disp)": ("Kalapani–Limpiyadhura", "Administered by India · Claimed by Nepal"),
    }
    lsib = fetch_json(LSIB_DISPUTED_URL)
    for feat in lsib.get("features", []):
        cname = feat.get("properties", {}).get("COUNTRY_NA", "Disputed Region")
        title, status = lsib_labels.get(cname, (cname, "Contested border sector"))
        geom = simplify_geometry(feat.get("geometry", {}), 0.006)
        contested_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": title,
                    "status": status,
                    "source": "US Dept. of State LSIB / DataMeet",
                },
                "geometry": geom,
            }
        )

    pok = fetch_json(POK_DISPUTED_URL)
    for feat in pok.get("features", []):
        prov = (feat.get("properties", {}).get("PROVINCE") or "Pakistan-Administered Kashmir").title()
        dist = (feat.get("properties", {}).get("DISTRICT") or "").title()
        geom = simplify_geometry(feat.get("geometry", {}), 0.008)
        contested_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": f"{dist} ({prov})" if dist else prov,
                    "status": "Administered by Pakistan (PoK / Gilgit-Baltistan) · Claimed by India",
                    "source": "Alhasan / DataMeet",
                },
                "geometry": geom,
            }
        )

    shaksgam = fetch_json(SHAKSGAM_DISPUTED_URL)
    for feat in shaksgam.get("features", []):
        geom = simplify_geometry(feat.get("geometry", {}), 0.006)
        contested_features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": "Shaksgam Valley",
                    "status": "Administered by China (ceded by Pakistan, 1963) · Claimed by India",
                    "source": "Natural Earth / DataMeet",
                },
                "geometry": geom,
            }
        )

    out = {"type": "FeatureCollection", "features": contested_features}
    out_path = DATA_DIR / "contested-regions.geojson"
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Saved {len(contested_features)} contested polygons to {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")


def point_in_ring(lng, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def point_in_india(lng, lat, border_geojson):
    offsets = [(0.0, 0.0), (0.04, 0.0), (-0.04, 0.0), (0.0, 0.04), (0.0, -0.04)]
    for dx, dy in offsets:
        px, py = lng + dx, lat + dy
        for feat in border_geojson.get("features", []):
            geom = feat.get("geometry", {})
            gtype = geom.get("type")
            coords = geom.get("coordinates", [])
            if gtype == "Polygon":
                if coords and point_in_ring(px, py, coords[0]):
                    return True
            elif gtype == "MultiPolygon":
                for poly in coords:
                    if poly and point_in_ring(px, py, poly[0]):
                        return True
    return False


def parse_wkt_point(wkt: str):
    m = re.match(r"Point\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)", wkt or "")
    if not m:
        return None
    lng, lat = float(m.group(1)), float(m.group(2))
    if not (67.0 <= lng <= 98.0 and 6.0 <= lat <= 38.0):
        return None
    return [round(lng, 5), round(lat, 5)]


def parse_state_from_asi(asi_id: str | None) -> str | None:
    if not asi_id:
        return None
    m = re.match(r"^[NS]-([A-Z]{2})-", asi_id.upper())
    if m:
        return ASI_STATE_CODES.get(m.group(1))
    return None


def fetch_unesco_india():
    print("Fetching UNESCO World Heritage Sites in India...")
    data = fetch_json(UNESCO_URL)
    sites = {}
    for rec in data.get("results", []):
        name = rec.get("name_en")
        if not name:
            continue
        geom = (rec.get("coordinates") or {}).get("geometry") or {}
        raw_coords = geom.get("coordinates") or []
        points = []
        if geom.get("type") == "MultiPoint":
            points = raw_coords
        elif geom.get("type") == "Point" and len(raw_coords) == 2:
            points = [raw_coords]
        sites[name.lower()] = {
            "name": name,
            "date_inscribed": rec.get("date_inscribed"),
            "category": rec.get("category"),
            "points": points,
        }
    print(f"Fetched {len(sites)} UNESCO records for India")
    return sites


def fetch_wikidata_monuments():
    print("Querying Wikidata SPARQL for ASI & National Importance monuments (+ parent images, Commons categories, 3D, epigraphy)...")
    query = """
    SELECT ?item ?itemLabel ?itemDescription ?asi1 ?asi2 ?coord ?image ?parentImage ?commonsCat ?styleLabel ?adminLabel ?inception ?article ?insc ?model3d WHERE {
      { ?item wdt:P1435 wd:Q3559621 . }
      UNION
      { ?item wdt:P5270 ?asi1 . }
      UNION
      { ?item wdt:P1371 ?asi2 . }
      ?item wdt:P625 ?coord .
      OPTIONAL { ?item wdt:P5270 ?asi1 . }
      OPTIONAL { ?item wdt:P1371 ?asi2 . }
      OPTIONAL { ?item wdt:P18 ?image . }
      OPTIONAL { ?item wdt:P361 ?parent . ?parent wdt:P18 ?parentImage . }
      OPTIONAL { ?item wdt:P373 ?commonsCat . }
      OPTIONAL { ?item wdt:P149 ?style . }
      OPTIONAL { ?item wdt:P131 ?admin . }
      OPTIONAL { ?item wdt:P571 ?inception . }
      OPTIONAL { ?item wdt:P1684 ?insc . }
      OPTIONAL { ?item wdt:P4896 ?model3d . }
      OPTIONAL {
        ?article schema:about ?item ;
                 schema:isPartOf <https://en.wikipedia.org/> .
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    """
    url = f"{WIKIDATA_SPARQL_URL}?format=json&query={urllib.parse.quote(query)}"
    data = fetch_json(
        url,
        headers={
            "Accept": "application/sparql-results+json",
            "User-Agent": "MonumentMapAtlas/1.0 (https://github.com/shashwathsantosh/Monument-Map)",
        },
    )
    rows = data.get("results", {}).get("bindings", [])
    print(f"Raw Wikidata bindings: {len(rows)}")
    return rows


def fetch_wikipedia_pageimages(titles: list[str]) -> dict[str, str]:
    """Batch fetch official Wikipedia lead thumbnails (50 titles per HTTP call)."""
    result = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i : i + 50]
        joined = "|".join(chunk)
        url = (
            "https://en.wikipedia.org/w/api.php?action=query&prop=pageimages"
            f"&piprop=thumbnail&pithumbsize=640&redirects=1&format=json&titles={urllib.parse.quote(joined)}"
        )
        try:
            data = fetch_json(url)
            pages = data.get("query", {}).get("pages", {})
            norm_map = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
            redir_map = {r["to"]: r["from"] for r in data.get("query", {}).get("redirects", [])}
            for page in pages.values():
                thumb = page.get("thumbnail", {}).get("source")
                if thumb:
                    t = page.get("title", "")
                    result[t] = thumb
                    if t in redir_map:
                        result[redir_map[t]] = thumb
                    if t in norm_map:
                        result[norm_map[t]] = thumb
        except Exception as exc:
            print(f"Wikipedia pageimages batch error: {exc}")
        time.sleep(0.15)
    return result


def fetch_commons_category_image(cat_name: str) -> str | None:
    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&list=categorymembers"
        f"&cmtitle={urllib.parse.quote('Category:' + cat_name)}&cmtype=file&cmlimit=3&format=json"
    )
    try:
        data = fetch_json(url)
        for m in data.get("query", {}).get("categorymembers", []):
            title = m.get("title", "")
            if title.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                fname = title.replace("File:", "", 1).replace(" ", "_")
                return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(fname)}?width=640"
    except Exception:
        return None
    return None


def match_first(name: str, table: list[dict]):
    lower = name.lower()
    for entry in table:
        if any(kw in lower for kw in entry["match"]):
            return entry
    return None


def match_unesco(name: str, coords: list[float], unesco_sites: dict):
    lower = name.lower()
    for uname, info in unesco_sites.items():
        if uname in lower or lower in uname:
            return info
        for pt in info.get("points", []):
            if len(pt) == 2 and abs(pt[0] - coords[0]) < 0.05 and abs(pt[1] - coords[1]) < 0.05:
                words = [w for w in re.findall(r"[a-z]{4,}", uname) if w not in {"group", "monuments", "india", "national", "park", "forts"}]
                if any(w in lower for w in words):
                    return info
    return None


def normalize_commons_url(url: str | None) -> str:
    if not url:
        return ""
    img_url = url.replace("http://", "https://")
    if "Special:FilePath" in img_url and "?" not in img_url:
        img_url += "?width=640"
    return img_url


def build_monuments(border_geojson):
    unesco_sites = fetch_unesco_india()
    rows = fetch_wikidata_monuments()
    by_qid = {}

    for row in rows:
        uri = row["item"]["value"]
        qid = uri.rsplit("/", 1)[-1]
        coords = parse_wkt_point(row.get("coord", {}).get("value"))
        if not coords or not point_in_india(coords[0], coords[1], border_geojson):
            continue
        name = row.get("itemLabel", {}).get("value", qid)
        if name == qid:
            continue
        asi_id = row.get("asi1", {}).get("value") or row.get("asi2", {}).get("value")
        desc = row.get("itemDescription", {}).get("value")
        image = row.get("image", {}).get("value")
        parent_image = row.get("parentImage", {}).get("value")
        commons_cat = row.get("commonsCat", {}).get("value")
        style = row.get("styleLabel", {}).get("value")
        admin = row.get("adminLabel", {}).get("value")
        inception_raw = row.get("inception", {}).get("value")
        article = row.get("article", {}).get("value")
        has_insc = "insc" in row
        model3d = row.get("model3d", {}).get("value")

        year = None
        if inception_raw:
            ym = re.match(r"^(-?\d{1,4})-", inception_raw)
            if ym:
                year = int(ym.group(1))

        rec = by_qid.get(qid)
        if not rec:
            rec = {
                "qid": qid,
                "name": name,
                "desc": desc,
                "asiId": asi_id,
                "coords": coords,
                "image": image,
                "parentImage": parent_image,
                "commonsCat": commons_cat,
                "styles": set(),
                "admins": set(),
                "year": year,
                "wikipedia": article,
                "hasInsc": has_insc,
                "model3d": model3d,
            }
            by_qid[qid] = rec
        if asi_id and not rec["asiId"]:
            rec["asiId"] = asi_id
        if desc and not rec["desc"]:
            rec["desc"] = desc
        if image and not rec["image"]:
            rec["image"] = image
        if parent_image and not rec["parentImage"]:
            rec["parentImage"] = parent_image
        if commons_cat and not rec["commonsCat"]:
            rec["commonsCat"] = commons_cat
        if style and not style.startswith("Q"):
            rec["styles"].add(style)
        if admin and not admin.startswith("Q"):
            rec["admins"].add(admin)
        if year is not None and rec["year"] is None:
            rec["year"] = year
        if article and not rec["wikipedia"]:
            rec["wikipedia"] = article
        if has_insc:
            rec["hasInsc"] = True
        if model3d and not rec["model3d"]:
            rec["model3d"] = model3d

    # 1. Batch-fetch Wikipedia lead images for entries without P18
    wiki_titles_needed = []
    wiki_title_to_qids = {}
    for qid, rec in by_qid.items():
        if not rec["image"] and rec["wikipedia"]:
            title = urllib.parse.unquote(rec["wikipedia"].rsplit("/wiki/", 1)[-1]).replace("_", " ")
            wiki_titles_needed.append(title)
            wiki_title_to_qids.setdefault(title, []).append(qid)
    if wiki_titles_needed:
        print(f"Fetching Wikipedia PageImages for {len(wiki_titles_needed)} sites without P18...")
        wiki_imgs = fetch_wikipedia_pageimages(wiki_titles_needed)
        filled_wiki = 0
        for title, thumb in wiki_imgs.items():
            for qid in wiki_title_to_qids.get(title, []):
                if not by_qid[qid]["image"]:
                    by_qid[qid]["image"] = thumb
                    filled_wiki += 1
        print(f"Enriched {filled_wiki} monuments from Wikipedia PageImages")

    # 2. Fetch Commons category images for remaining sites that have P373
    cat_needed = [rec for rec in by_qid.values() if not rec["image"] and rec["commonsCat"]]
    if cat_needed:
        print(f"Fetching Wikimedia Commons category photos for {len(cat_needed)} sites...")
        filled_cat = 0
        for rec in cat_needed:
            img = fetch_commons_category_image(rec["commonsCat"])
            if img:
                rec["image"] = img
                filled_cat += 1
            time.sleep(0.12)
        print(f"Enriched {filled_cat} monuments from Commons categories (P373)")

    # 3. Fallback to parent complex image (P361 -> P18) for sub-structures
    filled_parent = 0
    for rec in by_qid.values():
        if not rec["image"] and rec["parentImage"]:
            rec["image"] = rec["parentImage"]
            filled_parent += 1
    print(f"Enriched {filled_parent} sub-monuments from parent complex P18 images")

    features = []
    for rec in by_qid.values():
        state = parse_state_from_asi(rec["asiId"])
        admins = sorted(rec["admins"])
        resolved_state = state or (admins[0] if admins else "India")
        unesco = match_unesco(rec["name"], rec["coords"], unesco_sites)
        adopt = match_first(rec["name"], ADOPT_A_HERITAGE)
        ticket = match_first(rec["name"], TICKETED_METRICS)
        archive3d = match_first(rec["name"], ARCHIVE_3D_LINKS)
        circle_info = ASI_CIRCLE_BUDGETS.get(resolved_state)

        combined_text = f"{rec['name']} {rec['desc'] or ''}".lower()
        is_epigraphy = rec["hasInsc"] or any(
            kw in combined_text
            for kw in ["inscription", "edict", "ashoka", "asoka", "epigraph", "copper plate", "brahmi"]
        )

        budget_per_site = None
        underfunded_circle = False
        if circle_info:
            budget_per_site = round((circle_info["exp_cr"] * 100.0) / circle_info["monuments"], 2)
            if resolved_state in {"Tamil Nadu", "Karnataka"} and budget_per_site < 8.5:
                underfunded_circle = True
        if resolved_state == "Tamil Nadu":
            budget_per_site = 5.04
            underfunded_circle = True

        model3d_url = ""
        model3d_label = ""
        if rec["model3d"]:
            fname = rec["model3d"].replace(" ", "_")
            model3d_url = f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(fname)}"
            model3d_label = "Wikimedia 3D Model"
        elif archive3d:
            model3d_url = archive3d["url"]
            model3d_label = archive3d["label"]

        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": rec["coords"]},
                "properties": {
                    "qid": rec["qid"],
                    "name": rec["name"],
                    "desc": rec["desc"] or "",
                    "asiId": rec["asiId"] or "",
                    "state": resolved_state,
                    "location": ", ".join(admins[:2]),
                    "style": ", ".join(sorted(rec["styles"])[:2]),
                    "year": rec["year"],
                    "image": normalize_commons_url(rec["image"]),
                    "wikipedia": rec["wikipedia"] or "",
                    "unesco": unesco["name"] if unesco else "",
                    "unescoYear": unesco["date_inscribed"] if unesco else "",
                    "adoptPartner": adopt["partner"] if adopt else "",
                    "adoptProgram": adopt["program"] if adopt else "",
                    "adoptScope": adopt["scope"] if adopt else "",
                    "footfallLakhs": ticket["footfall_lakhs"] if ticket else None,
                    "revenueCr": ticket["revenue_cr"] if ticket else None,
                    "ticketFy": ticket["fy"] if ticket else "",
                    "ticketNote": ticket["note"] if ticket else "",
                    "circleName": circle_info["circle"] if circle_info else "",
                    "circleExpCr": circle_info["exp_cr"] if circle_info else None,
                    "circleMonuments": circle_info["monuments"] if circle_info else None,
                    "circlePerSiteLakh": budget_per_site,
                    "underfundedCircle": underfunded_circle,
                    "epigraphy": is_epigraphy,
                    "model3dUrl": model3d_url,
                    "model3dLabel": model3d_label,
                },
            }
        )

    features.sort(key=lambda f: f["properties"]["name"])
    out = {"type": "FeatureCollection", "features": features}
    out_path = DATA_DIR / "monuments.geojson"
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    with_img = sum(1 for f in features if f["properties"]["image"])
    print(f"Saved {len(features)} monuments ({with_img} with photos) to {out_path} ({out_path.stat().st_size / 1024:.1f} KB)")

    # Fetch Wikipedia thumbnails for PRASHAD projects too
    prashad_wiki_titles = [p["wiki"].replace("_", " ") for p in PRASHAD_PROJECTS if p.get("wiki")]
    prashad_imgs = fetch_wikipedia_pageimages(prashad_wiki_titles)

    prashad_features = []
    for p in PRASHAD_PROJECTS:
        wtitle = (p.get("wiki") or "").replace("_", " ")
        prashad_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": p["coords"]},
                "properties": {
                    "name": p["name"],
                    "state": p["state"],
                    "year": p["year"],
                    "approvedCr": p["approved_cr"],
                    "releasedCr": p["released_cr"],
                    "progress": p["progress"],
                    "image": prashad_imgs.get(wtitle, ""),
                    "wikipedia": f"https://en.wikipedia.org/wiki/{p['wiki']}" if p.get("wiki") else "",
                },
            }
        )
    prashad_out = {"type": "FeatureCollection", "features": prashad_features}
    prashad_path = DATA_DIR / "prashad-projects.geojson"
    prashad_path.write_text(json.dumps(prashad_out, separators=(",", ":")))
    print(f"Saved {len(prashad_features)} PRASHAD projects to {prashad_path}")

    # Save ASI circle comparison JSON
    circles_out = []
    for c in ASI_CIRCLES_SUMMARY:
        per_site = round((c["exp_cr"] * 100.0) / c["monuments"], 2)
        circles_out.append({**c, "per_site_lakh": per_site})
    circles_out.sort(key=lambda x: x["per_site_lakh"])
    circles_path = DATA_DIR / "asi-circles.json"
    circles_path.write_text(json.dumps(circles_out, indent=2))
    print(f"Saved {len(circles_out)} ASI circle budget benchmarks to {circles_path}")


if __name__ == "__main__":
    border = build_india_border()
    build_contested_regions()
    build_geozones()
    build_monuments(border)
