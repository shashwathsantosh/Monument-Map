# Monument Map Atlas

A minimalist, light-mode interactive map of government-protected monuments across current-day India, combining verified public heritage and funding records.

## Data Sources
- **Official Current-Day India Borders:** Survey of India GeoJSON from [DataMeet Maps](https://github.com/datameet/maps) (`Country/india-soi.geojson`).
- **Protected Monuments (4,405 sites):** [Wikidata SPARQL](https://query.wikidata.org/) (`P1435 = wd:Q3559621` Monument of National Importance, `P5270` & `P1371` ASI Monument IDs, coordinates, architectural styles, inception dates, Wikipedia links, and Wikimedia Commons photography).
- **UNESCO World Heritage Sites:** [UNESCO DataHub API](https://data.unesco.org/) (`whc001` dataset filtered to India).
- **Funding & Upkeep Overlays:**
  - **Adopt a Heritage 2.0:** Verified CSR Monument Mitra partnerships from PIB / Ministry of Culture disclosures.
  - **PRASHAD Scheme:** Ministry of Tourism sanctioned heritage infrastructure projects (`₹ Cr` approved, released, and progress).

## Run Locally
```bash
python3 -m http.server 8765 --directory public
```
Then open `http://localhost:8765` in your browser.

## Refresh Datasets
```bash
python3 scripts/build_data.py
```

## Publish
Because `public/` is 100% static (with bundled MapLibre GL JS and local GeoJSON files), you can deploy the `public/` folder directly to **Netlify Drop**, **GitHub Pages**, **Vercel**, or **Cloudflare Pages** with zero backend setup.
