#!/usr/bin/env python3
"""
Enrich public/data/monuments.geojson using Wikidata Action API (wbgetentities)
and verified Wikipedia ASI/State Monument List table rows.
Preserves all existing curated fields in monuments.geojson.
"""

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

GEOJSON_PATH = Path(__file__).resolve().parent.parent / "public" / "data" / "monuments.geojson"
WD_API = "https://www.wikidata.org/w/api.php"
WP_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
UA = "MonumentMapAtlas/1.2 (https://github.com/shashwathsantosh/Monument-Map)"

# Official ASI Circle jurisdiction for Centrally Protected (N-*) monuments lacking P126/budget entry
OFFICIAL_ASI_CIRCLES = {
    "AP": "Amaravati Circle",
    "AR": "Itanagar / Guwahati Circle",
    "AS": "Guwahati Circle",
    "BR": "Patna Circle",
    "CT": "Raipur Circle",
    "CG": "Raipur Circle",
    "DD": "Vadodara Circle",
    "DL": "Delhi Circle",
    "GA": "Goa Circle",
    "GJ": "Vadodara / Rajkot Circle",
    "HP": "Shimla Circle",
    "HR": "Chandigarh Circle",
    "JH": "Ranchi Circle",
    "JK": "Srinagar / Jammu Circle",
    "KA": "Bangalore / Dharwad / Hampi Circle",
    "KL": "Thrissur Circle",
    "LA": "Leh Mini Circle",
    "MH": "Mumbai / Aurangabad / Nagpur Circle",
    "ML": "Guwahati Circle",
    "MN": "Guwahati Circle",
    "MP": "Bhopal / Jabalpur Circle",
    "MZ": "Aizawl / Guwahati Circle",
    "NL": "Guwahati Circle",
    "OR": "Bhubaneswar / Puri Circle",
    "OD": "Bhubaneswar / Puri Circle",
    "PB": "Chandigarh Circle",
    "PY": "Chennai Circle",
    "RJ": "Jaipur / Jodhpur Circle",
    "SK": "Kolkata / Raiganj Circle",
    "TG": "Hyderabad Circle",
    "TN": "Chennai / Trichy Circle",
    "TR": "Guwahati Circle",
    "UK": "Dehradun Circle",
    "UP": "Agra / Lucknow / Sarnath / Jhansi / Meerut Circle",
    "UT": "Dehradun Circle",
    "WB": "Kolkata / Raiganj Circle",
}

GENERIC_TYPES = {
    "archaeological site",
    "monument",
    "heritage site",
    "cultural property",
    "tourist attraction",
    "architectural structure",
    "building",
    "structure",
    "place",
    "geographic location",
    "ruins",
}

BAD_IMAGE_RE = re.compile(
    r"(no_image|placeholder|replace_this_image|missing|flag_of|emblem_of|locator|map_of|blank\.png|example\.jpg)",
    re.I,
)


def fetch_json(url: str, timeout: int = 25, retries: int = 4) -> dict:
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < retries - 1:
                ra = exc.headers.get("Retry-After")
                wait_s = int(ra) if (ra and ra.isdigit()) else 6 * (attempt + 1)
                time.sleep(min(wait_s, 30))
                continue
            raise
    return {}


def normalize_commons_file(filename: str) -> str:
    clean = filename.strip().replace("File:", "").replace("Image:", "").strip()
    if not clean or BAD_IMAGE_RE.search(clean):
        return ""
    if clean.lower().endswith((".svg", ".pdf", ".tif", ".tiff", ".ogg", ".ogv", ".webm")):
        return ""
    clean = clean.replace(" ", "_")
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(clean)}?width=640"


def clean_circle_label(raw: str) -> str:
    if not raw or raw.startswith("Q"):
        return ""
    s = raw.strip()
    s = re.sub(r"^Archaeological Survey of India,?\s*", "", s, flags=re.I)
    s = re.sub(r"\s+circle$", " Circle", s, flags=re.I)
    if s.lower() in {"archaeological survey of india", "asi"}:
        return ""
    return s.strip()


def clean_wikitext(text: str) -> str:
    s = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<ref[^/>]*/>", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\[\[[^|\]]+\|([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]+)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^}]+\}\}", "", s)
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,;:-")
    return s


def pick_best_type(types: list[str]) -> str:
    clean = [t for t in types if t and not t.startswith("Q")]
    if not clean:
        return ""
    specific = [t for t in clean if t.lower() not in GENERIC_TYPES]
    chosen = specific[0] if specific else clean[0]
    return chosen[0].upper() + chosen[1:] if len(chosen) > 1 else chosen


def claim_qids(claims: dict, prop: str) -> list[str]:
    out = []
    for c in claims.get(prop, []):
        dv = c.get("mainsnak", {}).get("datavalue", {})
        if dv.get("type") == "wikibase-entityid":
            qid = dv.get("value", {}).get("id", "")
            if qid:
                out.append(qid)
    return out


def claim_strings(claims: dict, prop: str) -> list[str]:
    out = []
    for c in claims.get(prop, []):
        dv = c.get("mainsnak", {}).get("datavalue", {})
        if dv.get("type") == "string":
            val = (dv.get("value") or "").strip()
            if val:
                out.append(val)
    return out


def claim_year(claims: dict) -> int | None:
    for c in claims.get("P571", []):
        dv = c.get("mainsnak", {}).get("datavalue", {})
        if dv.get("type") == "time":
            t = dv.get("value", {}).get("time", "")
            m = re.match(r"^[+-]?(-?\d{1,4})-", t)
            if m:
                return int(m.group(1))
    return None


def fetch_wikidata_entities(qids: list[str]) -> dict[str, dict]:
    entities = {}
    total_chunks = (len(qids) + 49) // 50
    for idx in range(0, len(qids), 50):
        chunk = qids[idx : idx + 50]
        if (idx // 50) % 15 == 0:
            print(f"Wikidata wbgetentities batch {idx // 50 + 1}/{total_chunks}...")
        url = (
            f"{WD_API}?action=wbgetentities&ids={'|'.join(chunk)}"
            "&props=claims|descriptions|sitelinks&languages=en&format=json"
        )
        try:
            data = fetch_json(url, timeout=25)
            entities.update(data.get("entities", {}))
        except Exception as exc:
            print(f"  Batch {idx // 50 + 1} error: {exc}")
        time.sleep(0.55)
    return entities


def fetch_target_labels_and_images(target_qids: list[str]) -> tuple[dict[str, str], dict[str, str]]:
    labels = {}
    parent_imgs = {}
    total_chunks = (len(target_qids) + 49) // 50
    print(f"Resolving {len(target_qids)} referenced Wikidata labels ({total_chunks} batches)...")
    for idx in range(0, len(target_qids), 50):
        chunk = target_qids[idx : idx + 50]
        url = (
            f"{WD_API}?action=wbgetentities&ids={'|'.join(chunk)}"
            "&props=labels|claims&languages=en&format=json"
        )
        try:
            data = fetch_json(url, timeout=25)
            for q, ent in data.get("entities", {}).items():
                lbl = ent.get("labels", {}).get("en", {}).get("value", "")
                if lbl:
                    labels[q] = lbl
                imgs = claim_strings(ent.get("claims", {}), "P18")
                if imgs:
                    u = normalize_commons_file(imgs[0])
                    if u:
                        parent_imgs[q] = u
        except Exception as exc:
            print(f"  Label batch {idx // 50 + 1} error: {exc}")
        time.sleep(0.55)
    return labels, parent_imgs


def fetch_wp_list_entries() -> dict[str, list[dict]]:
    titles = set()
    for sr in [
        '"List of Monuments of National Importance in"',
        '"List of State Protected Monuments in"',
    ]:
        url = (
            f"{WP_API}?action=query&list=search&srsearch={urllib.parse.quote(sr)}"
            "&srlimit=90&format=json"
        )
        try:
            res = fetch_json(url, timeout=20)
            for item in res.get("query", {}).get("search", []):
                t = item["title"]
                if t.startswith("List of ") and ("National Importance" in t or "State Protected" in t):
                    titles.add(t)
        except Exception as exc:
            print(f"WP list search error: {exc}")
        time.sleep(0.3)

    title_list = sorted(titles)
    print(f"Fetching {len(title_list)} Wikipedia monument list pages...")
    by_id: dict[str, list[dict]] = {}

    for i in range(0, len(title_list), 8):
        chunk = title_list[i : i + 8]
        url = (
            f"{WP_API}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json"
            f"&titles={urllib.parse.quote('|'.join(chunk))}"
        )
        try:
            data = fetch_json(url, timeout=30)
            for pg in data.get("query", {}).get("pages", {}).values():
                page_title = pg.get("title", "")
                revs = pg.get("revisions", [])
                if not revs:
                    continue
                wt = revs[0].get("slots", {}).get("main", {}).get("*", "")
                for blk in re.findall(r"\{\{[^{}]*\|\s*number\s*=[^{}]+\}\}", wt, flags=re.S | re.I):
                    fields = {}
                    for m in re.finditer(r"\|\s*([a-zA-Z0-9_]+)\s*=\s*([^\n|{}]*)", blk):
                        fields[m.group(1).strip().lower()] = m.group(2).strip()
                    num = clean_wikitext(fields.get("number", "")).upper()
                    if not num or not re.match(r"^[NS]-[A-Z]{2}-", num):
                        continue
                    desc = clean_wikitext(fields.get("description", ""))
                    loc = clean_wikitext(fields.get("location", ""))
                    dist = clean_wikitext(fields.get("district", ""))
                    img = normalize_commons_file(fields.get("image", ""))
                    by_id.setdefault(num, []).append(
                        {
                            "pageTitle": page_title,
                            "description": desc,
                            "location": loc,
                            "district": dist,
                            "image": img,
                        }
                    )
        except Exception as exc:
            print(f"WP wikitext chunk error: {exc}")
        time.sleep(0.55)
    print(f"Parsed {sum(len(v) for v in by_id.values())} Wikipedia monument list entries across {len(by_id)} IDs.")
    return by_id


def fetch_commons_cat_images(cats: list[str]) -> dict[str, str]:
    out = {}
    unique_cats = sorted(set(c for c in cats if c))
    for cat in unique_cats:
        url = (
            f"{COMMONS_API}?action=query&list=categorymembers"
            f"&cmtitle={urllib.parse.quote('Category:' + cat)}&cmtype=file&cmlimit=5&format=json"
        )
        try:
            data = fetch_json(url, timeout=12)
            for m in data.get("query", {}).get("categorymembers", []):
                title = m.get("title", "")
                if title.lower().endswith((".jpg", ".jpeg", ".png", ".webp")) and not BAD_IMAGE_RE.search(title):
                    img_url = normalize_commons_file(title)
                    if img_url:
                        out[cat] = img_url
                        break
        except Exception:
            pass
        time.sleep(0.08)
    return out


def main():
    with open(GEOJSON_PATH, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson["features"]
    qids = [feat["properties"]["qid"] for feat in features if feat["properties"].get("qid")]
    print(f"Loaded {len(features)} monuments ({len(qids)} QIDs).")

    # 1. Fetch raw Wikidata entity claims/descriptions/sitelinks for all 4,405 monuments
    entities = fetch_wikidata_entities(qids)

    # Collect all referenced target QIDs for P31, P276, P126, P149, P186, P2348, P361
    target_qids = set()
    for ent in entities.values():
        claims = ent.get("claims", {})
        for prop in ("P31", "P276", "P126", "P149", "P186", "P2348", "P361"):
            target_qids.update(claim_qids(claims, prop))
    labels, parent_imgs = fetch_target_labels_and_images(sorted(target_qids))

    # 2. Fetch Commons category images for monuments without an image that have P373
    cats_needed = []
    for feat in features:
        p = feat["properties"]
        ent = entities.get(p.get("qid"), {})
        claims = ent.get("claims", {})
        if not p.get("image") and not claim_strings(claims, "P18"):
            cats = claim_strings(claims, "P373")
            if cats:
                cats_needed.append(cats[0])
    print(f"Checking {len(set(cats_needed))} missing-image Commons categories...")
    cat_images = fetch_commons_cat_images(cats_needed)

    # 3. Wikipedia list entries
    wp_lists = fetch_wp_list_entries()

    stats = {
        "image": 0,
        "desc": 0,
        "siteType": 0,
        "place": 0,
        "circleName": 0,
        "style": 0,
        "material": 0,
        "period": 0,
        "year": 0,
        "wikipedia": 0,
    }

    for feat in features:
        p = feat["properties"]
        qid = p.get("qid")
        ent = entities.get(qid, {})
        claims = ent.get("claims", {})
        asi_id = (p.get("asiId") or "").upper()

        # Classification & typology (P31)
        if not p.get("siteType"):
            t_labels = [labels.get(q, "") for q in claim_qids(claims, "P31")]
            best = pick_best_type(t_labels)
            if best:
                p["siteType"] = best
                stats["siteType"] += 1

        # Village / town (P276)
        if not p.get("place"):
            loc_lower = (p.get("location") or "").lower()
            p_labels = [labels.get(q, "") for q in claim_qids(claims, "P276")]
            p_labels = [pl for pl in p_labels if pl and pl.lower() != loc_lower]
            if p_labels:
                p["place"] = p_labels[0]
                stats["place"] += 1

        # Custodian / ASI Circle (P126, falling back to official circle map for N-* central ASI sites)
        if not p.get("circleName"):
            for cq in claim_qids(claims, "P126"):
                cleaned = clean_circle_label(labels.get(cq, ""))
                if cleaned:
                    p["circleName"] = cleaned
                    stats["circleName"] += 1
                    break
        if not p.get("circleName") and asi_id.startswith("N-"):
            parts = asi_id.split("-")
            if len(parts) >= 2 and parts[1] in OFFICIAL_ASI_CIRCLES:
                p["circleName"] = OFFICIAL_ASI_CIRCLES[parts[1]]
                stats["circleName"] += 1

        # Architectural style (P149)
        if not p.get("style"):
            s_labels = [labels.get(q, "") for q in claim_qids(claims, "P149") if labels.get(q)]
            if s_labels:
                p["style"] = ", ".join(s_labels[:2])
                stats["style"] += 1

        # Material (P186)
        if not p.get("material"):
            m_labels = [labels.get(q, "") for q in claim_qids(claims, "P186") if labels.get(q)]
            if m_labels:
                p["material"] = ", ".join(m_labels[:2])
                stats["material"] += 1

        # Period / dynasty (P2348)
        if not p.get("period"):
            per_labels = [labels.get(q, "") for q in claim_qids(claims, "P2348") if labels.get(q)]
            if per_labels:
                p["period"] = per_labels[0]
                stats["period"] += 1

        # Inception year (P571)
        if p.get("year") is None:
            yr = claim_year(claims)
            if yr is not None:
                p["year"] = yr
                stats["year"] += 1

        # Wikipedia sitelink
        if not p.get("wikipedia"):
            enwiki = ent.get("sitelinks", {}).get("enwiki", {}).get("title")
            if enwiki:
                p["wikipedia"] = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(enwiki.replace(' ', '_'))}"
                stats["wikipedia"] += 1

        # Wikidata description
        if not p.get("desc"):
            wd_desc = ent.get("descriptions", {}).get("en", {}).get("value", "").strip()
            if wd_desc:
                p["desc"] = wd_desc
                stats["desc"] += 1

        # Image from Wikidata P18 / Commons Category / Parent complex P18
        if not p.get("image"):
            p18_files = claim_strings(claims, "P18")
            candidate = normalize_commons_file(p18_files[0]) if p18_files else ""
            if not candidate:
                cats = claim_strings(claims, "P373")
                if cats:
                    candidate = cat_images.get(cats[0], "")
            if not candidate:
                for pq in claim_qids(claims, "P361"):
                    if parent_imgs.get(pq):
                        candidate = parent_imgs[pq]
                        break
            if candidate:
                p["image"] = candidate
                stats["image"] += 1

        # Wikipedia list row fallback (strict state + place verification)
        if asi_id in wp_lists:
            state_toks = set(re.findall(r"[a-z]{3,}", (p.get("state") or "").lower()))
            loc_toks = set(re.findall(r"[a-z]{3,}", f"{p.get('location','')} {p.get('place','')} {p.get('name','')}".lower()))
            for row in wp_lists[asi_id]:
                row_text = f"{row['pageTitle']} {row['district']} {row['location']} {row['description']}".lower()
                row_toks = set(re.findall(r"[a-z]{3,}", row_text))
                if not (state_toks & row_toks and loc_toks & row_toks):
                    continue
                if row["location"] and not p.get("place") and row["location"].lower() != (p.get("location") or "").lower():
                    p["place"] = row["location"]
                    stats["place"] += 1
                if row["description"] and (not p.get("desc") or len(p["desc"]) < 24):
                    if row["description"].lower() != (p.get("name") or "").lower():
                        p["desc"] = row["description"]
                        stats["desc"] += 1
                if row["image"] and not p.get("image"):
                    p["image"] = row["image"]
                    stats["image"] += 1
                break

    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, separators=(",", ":"), ensure_ascii=False)

    print("\nEnrichment complete! Newly filled fields:")
    for k, v in stats.items():
        print(f"  +{v} {k}")

    total = len(features)
    print("\nFinal coverage:")
    for field in ["image", "desc", "siteType", "place", "circleName", "style", "material", "period", "year", "wikipedia"]:
        cnt = sum(1 for feat in features if feat["properties"].get(field) not in (None, "", False))
        print(f"  {field}: {cnt}/{total}")


if __name__ == "__main__":
    main()
