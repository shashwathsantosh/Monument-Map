// Archaeological Site Map of India — Public Heritage & Conservation Atlas

const REPORTS_KEY = "monument_map_reports_v1";

const SITE_COLORS = {
  unesco: "#ff9500",
  footfall: "#007aff",
  adopt: "#34c759",
  prashad: "#af52de",
  restoration: "#f59e0b",
  underfunded: "#ff3b30",
  uncovered: "#64748b",
  asi: "#5a6572",
  flagged: "#dc2626",
};

const state = {
  border: null,
  mask: null,
  geozones: null,
  states: null,
  rivers: null,
  lakes: null,
  contested: null,
  monuments: null,
  prashad: null,
  circles: [],
  filteredMonuments: { type: "FeatureCollection", features: [] },
  filteredPrashad: { type: "FeatureCollection", features: [] },
  activeFilter: "all",
  nearbyNav: null,
  onlyPhotos: false,
  selectedState: "",
  searchQuery: "",
  showContested: true,
  reports: loadReports(),
  activePhotoPins: new Map(),
  galleryCache: {},
  pinRaf: 0,
  carouselHandler: null,
  currency: "INR",
  lastDrawer: null,
};

const INR_PER_USD = 84;

function formatMoneyCr(crVal, compact = false) {
  const n = Number(crVal);
  if (!Number.isFinite(n)) return "";
  if (state.currency === "USD") {
    const usd = (n * 1e7) / INR_PER_USD;
    if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
    if (usd >= 1e3) return `$${Math.round(usd / 1e3).toLocaleString()}K`;
    return `$${Math.round(usd).toLocaleString()}`;
  }
  return compact ? `₹${n} Cr` : `₹${n} Crore`;
}

function formatMoneyLakh(lakhVal, perSite = false) {
  const n = Number(lakhVal);
  if (!Number.isFinite(n)) return "";
  if (state.currency === "USD") {
    const usd = (n * 1e5) / INR_PER_USD;
    const base = usd >= 1000 ? `$${(usd / 1000).toFixed(1)}K` : `$${Math.round(usd).toLocaleString()}`;
    return perSite ? `${base} / yr` : base;
  }
  return perSite ? `₹${n}L / yr` : `₹${n}L`;
}

function formatTicketPair(indInr, forInr) {
  if (state.currency === "USD") {
    const indUsd = (indInr / INR_PER_USD).toFixed(2);
    const forUsd = (forInr / INR_PER_USD).toFixed(2);
    return `$${indUsd} Indian · $${forUsd} Foreign`;
  }
  return `₹${indInr.toLocaleString()} Indian · ₹${forInr.toLocaleString()} Foreign`;
}

// Start local data downloads immediately in parallel with base style/tile init
const preloadDataPromise = Promise.all([
  fetch("data/india-border.geojson").then((r) => r.json()),
  fetch("data/india-mask.geojson").then((r) => r.json()),
  fetch("data/india-states.geojson").then((r) => r.json()),
  fetch("data/india-rivers.geojson").then((r) => r.json()),
  fetch("data/india-lakes.geojson").then((r) => r.json()),
  fetch("data/contested-regions.geojson").then((r) => r.json()),
  fetch("data/monuments.geojson").then((r) => r.json()),
  fetch("data/prashad-projects.geojson").then((r) => r.json()),
  fetch("data/asi-circles.json").then((r) => r.json()),
]);

const INDIA_BOUNDS = [
  [68.1, 6.7],
  [97.4, 37.1],
];

// Apple Maps Inspired High-Contrast Light Mode (Sky-blue waters, sage parks, crisp white streets, sculpted grey borders)
const plateStyle = {
  version: 8,
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    openmaptiles: {
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    },
  },
  layers: [
    {
      id: "plate-paper",
      type: "background",
      paint: { "background-color": "#eeede8" },
    },
  ],
};

function createPatternImage(size, drawFn) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  drawFn(ctx, size);
  return ctx.getImageData(0, 0, size, size);
}

function registerLightPatterns() {
  if (!map.hasImage("contested-hatch")) {
    const img = createPatternImage(12, (ctx, s) => {
      ctx.fillStyle = "rgba(88, 92, 98, 0.06)";
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = "rgba(88, 92, 98, 0.34)";
      ctx.lineWidth = 1.0;
      for (let o = -s; o <= s; o += 6) {
        ctx.beginPath();
        ctx.moveTo(o, s);
        ctx.lineTo(o + s, 0);
        ctx.stroke();
      }
    });
    map.addImage("contested-hatch", img, { pixelRatio: 2 });
  }
}

function buildOceanAndCountryLabels() {
  const waters = [
    { name: "INDIAN OCEAN", coords: [78.8, 3.8], rank: 1 },
    { name: "ARABIAN SEA", coords: [66.8, 16.2], rank: 1 },
    { name: "BAY OF BENGAL", coords: [88.8, 15.0], rank: 1 },
    { name: "LACCADIVE SEA", coords: [74.4, 8.6], rank: 2 },
    { name: "ANDAMAN SEA", coords: [95.3, 11.8], rank: 2 },
  ];
  const countries = [
    { name: "PAKISTAN", coords: [68.8, 29.8] },
    { name: "AFGHANISTAN", coords: [66.2, 34.0] },
    { name: "CHINA", coords: [87.2, 34.4] },
    { name: "NEPAL", coords: [84.1, 28.3] },
    { name: "BHUTAN", coords: [90.4, 27.4] },
    { name: "BANGLADESH", coords: [90.2, 24.0] },
    { name: "MYANMAR", coords: [96.2, 21.8] },
    { name: "SRI LANKA", coords: [80.7, 7.9] },
    { name: "MALDIVES", coords: [73.2, 4.2] },
  ];
  return {
    waters: {
      type: "FeatureCollection",
      features: waters.map((w) => ({
        type: "Feature",
        properties: { name: w.name, rank: w.rank },
        geometry: { type: "Point", coordinates: w.coords },
      })),
    },
    countries: {
      type: "FeatureCollection",
      features: countries.map((c) => ({
        type: "Feature",
        properties: { name: c.name },
        geometry: { type: "Point", coordinates: c.coords },
      })),
    },
  };
}

function fitIndiaCentered(animate = false) {
  const isMobile = window.innerWidth <= 768;
  map.fitBounds(INDIA_BOUNDS, {
    padding: {
      top: isMobile ? 24 : 26,
      bottom: isMobile ? 64 : 58,
      left: isMobile ? 16 : 32,
      right: isMobile ? 16 : 32,
    },
    duration: animate ? 500 : 0,
  });
}

const map = new maplibregl.Map({
  container: "map",
  style: plateStyle,
  center: [82.75, 22.1],
  zoom: 3.7,
  minZoom: 2.5,
  maxZoom: 18,
  fadeDuration: 0,
  maxBounds: [
    [40.0, -8.0],
    [122.0, 48.0],
  ],
  attributionControl: false,
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

const elCount = document.getElementById("visible-count");
const elSearch = document.getElementById("search-input");
const elStateSelect = document.getElementById("state-select");
const elDrawer = document.getElementById("detail-drawer");
const elDetailContent = document.getElementById("detail-content");
const elCloseDrawer = document.getElementById("close-drawer");
const elTooltip = document.getElementById("tooltip");
const elBudgetPanel = document.getElementById("budget-panel");
const elBudgetList = document.getElementById("budget-list");
const elToggleContested = document.getElementById("toggle-contested");

function loadReports() {
  try {
    return JSON.parse(localStorage.getItem(REPORTS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveReports() {
  localStorage.setItem(REPORTS_KEY, JSON.stringify(state.reports));
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatYear(y) {
  if (y === null || y === undefined || y === "") return "";
  const n = Number(y);
  if (Number.isNaN(n)) return String(y);
  return n < 0 ? `${Math.abs(n)} BCE` : `${n} CE`;
}

function thumbUrl(url) {
  if (!url) return "";
  return url
    .replace("width=640", "width=220")
    .replace("/640px-", "/220px-");
}

function hiResUrl(url) {
  if (!url) return "";
  return url
    .replace("width=640", "width=960")
    .replace("/640px-", "/960px-");
}

function pinThumbUrl(url) {
  if (!url) return "";
  return url
    .replace("width=640", "width=320")
    .replace("/640px-", "/320px-");
}

function prepareMonumentCache() {
  if (state.monuments) {
    for (const f of state.monuments.features) {
      const p = f.properties;
      p.flagged = Boolean(p.qid && state.reports[p.qid] && state.reports[p.qid].length > 0);
      f._nameLower = (p.name || "").toLowerCase();
      f._hay = `${p.name} ${p.asiId} ${p.state} ${p.location} ${p.place || ""} ${p.siteType || ""} ${p.style} ${p.desc} ${p.adoptPartner} ${p.circleName}`.toLowerCase();
    }
  }
  if (state.prashad) {
    for (const f of state.prashad.features) {
      const p = f.properties;
      f._nameLower = (p.name || "").toLowerCase();
      f._hay = `${p.name} ${p.state} prashad`.toLowerCase();
    }
  }
}

function matchesTokens(hay, terms) {
  for (let i = 0; i < terms.length; i++) {
    if (!hay.includes(terms[i])) return false;
  }
  return true;
}

function isInRestoration(p) {
  if (!p) return false;
  if (p.adoptPartner) return true;
  if (p.flagged) return true;
  if (/(restor|conserv|renovat|repair|rehabilitat)/i.test(String(p.desc || ""))) return true;
  return Boolean(findLinkedPrashad(p));
}

function getFilteredMonuments() {
  if (!state.monuments) return { type: "FeatureCollection", features: [] };
  if (state.activeFilter === "prashad") {
    return { type: "FeatureCollection", features: [] };
  }
  const terms = state.searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const st = state.selectedState;
  const af = state.activeFilter;

  const features = state.monuments.features.filter((f) => {
    const p = f.properties;
    if (state.onlyPhotos && !p.image) return false;
    if (af === "photos" && !p.image) return false;
    if (af === "uncovered" && Boolean(p.image)) return false;
    if (af === "unesco" && !p.unesco) return false;
    if (af === "footfall" && !p.revenueCr && !p.footfallLakhs) return false;
    if (af === "mostvisited" && !TOP_20_MOST_VISITED_QIDS.includes(p.qid)) return false;
    if (af === "restoration" && !isInRestoration(p)) return false;
    if (af === "underfunded" && !p.underfundedCircle) return false;
    if (af === "adopt" && !p.adoptPartner) return false;
    if (af === "asi" && (p.unesco || p.revenueCr || p.footfallLakhs || p.adoptPartner || p.underfundedCircle)) return false;
    if (af === "epigraphy" && !p.epigraphy) return false;
    if (af === "flagged" && !p.flagged) return false;
    if (st && p.state !== st) return false;
    if (terms.length && !matchesTokens(f._hay || "", terms)) return false;
    return true;
  });

  return { type: "FeatureCollection", features };
}

function getFilteredPrashad() {
  if (!state.prashad) return { type: "FeatureCollection", features: [] };
  if (state.activeFilter !== "all" && state.activeFilter !== "prashad" && state.activeFilter !== "restoration") {
    return { type: "FeatureCollection", features: [] };
  }
  const terms = state.searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const st = state.selectedState;
  const af = state.activeFilter;

  const features = state.prashad.features.filter((f) => {
    const p = f.properties;
    if (af === "restoration" && String(p.progress || "").trim() === "100%") return false;
    if (state.onlyPhotos && !p.image) return false;
    if (st && p.state !== st) return false;
    if (terms.length && !matchesTokens(f._hay || "", terms)) return false;
    return true;
  });

  return { type: "FeatureCollection", features };
}

function clearPhotoMarkers() {
  for (const { marker } of state.activePhotoPins.values()) marker.remove();
  state.activePhotoPins.clear();
}

function priorityScore(p) {
  let s = 0;
  if (p.flagged) s += 1000;
  if (p.revenueCr) s += 500 + Number(p.revenueCr);
  if (p.unesco) s += 250;
  if (p.adoptPartner) s += 120;
  if (p.wikipedia) s += 30;
  if (p.epigraphy) s += 15;
  return s;
}

function schedulePhotoPins() {
  if (state.pinRaf) cancelAnimationFrame(state.pinRaf);
  state.pinRaf = requestAnimationFrame(() => {
    state.pinRaf = 0;
    syncPhotoPins();
  });
}

function syncPhotoPins() {
  if (!map.loaded() || !state.monuments) return;

  const zoom = map.getZoom();
  if (zoom < 4.5) {
    if (state.activePhotoPins.size) clearPhotoMarkers();
    return;
  }

  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const isPrashad = state.activeFilter === "prashad";
  const rawFeatures = isPrashad ? state.filteredPrashad.features : state.filteredMonuments.features;

  const candidates = [];
  for (let i = 0; i < rawFeatures.length; i++) {
    const f = rawFeatures[i];
    if (!f.properties.image) continue;
    const [lng, lat] = f.geometry.coordinates;
    if (lng < west || lng > east || lat < south || lat > north) continue;
    candidates.push(f);
  }

  candidates.sort((a, b) => priorityScore(b.properties) - priorityScore(a.properties));

  const tier =
    zoom >= 11.5
      ? { w: 176, h: 124, labelW: 190, maxPins: 14, dx: 196, dy: 158 }
      : zoom >= 9.0
      ? { w: 142, h: 100, labelW: 158, maxPins: 11, dx: 162, dy: 132 }
      : zoom >= 6.4
      ? { w: 108, h: 76, labelW: 132, maxPins: 8, dx: 130, dy: 104 }
      : { w: 82, h: 58, labelW: 108, maxPins: 6, dx: 112, dy: 92 };

  const leftPanel = document.getElementById("left-panel");
  const panelOpenDesktop = leftPanel && !leftPanel.classList.contains("collapsed") && window.innerWidth > 768;
  const panelBottom = leftPanel ? leftPanel.getBoundingClientRect().bottom + 14 : 240;
  const legendBar = document.getElementById("legend-bar-wrap") || document.getElementById("legend-bar");
  const legendRect = legendBar && !document.body.classList.contains("drawer-open") ? legendBar.getBoundingClientRect() : null;
  const searchWrap = document.getElementById("search-wrap");
  const searchRect = searchWrap && !searchWrap.classList.contains("hidden") ? searchWrap.getBoundingClientRect() : null;
  const drawerRect = !elDrawer.classList.contains("hidden") ? elDrawer.getBoundingClientRect() : null;
  const placedPoints = [];
  const nextKeys = new Map();

  for (const feat of candidates) {
    if (nextKeys.size >= tier.maxPins) break;
    const coords = feat.geometry.coordinates;
    const pt = map.project(coords);

    if (panelOpenDesktop && pt.x < 342 && pt.y < panelBottom) continue;
    if (legendRect && pt.x < legendRect.right + 16 && pt.y > legendRect.top - 16) continue;
    if (
      searchRect &&
      pt.x > searchRect.left - 18 &&
      pt.x < searchRect.right + 18 &&
      pt.y > searchRect.top - 18 &&
      pt.y < searchRect.bottom + 18
    ) {
      continue;
    }
    if (
      drawerRect &&
      pt.x > drawerRect.left - 24 &&
      pt.x < drawerRect.right + 24 &&
      pt.y > drawerRect.top - 24 &&
      pt.y < drawerRect.bottom + 24
    ) {
      continue;
    }
    if (pt.x < 56 || pt.x > window.innerWidth - 56 || pt.y < 52 || pt.y > window.innerHeight - 48) continue;

    let collides = false;
    for (const prev of placedPoints) {
      if (Math.abs(pt.x - prev.x) < tier.dx && Math.abs(pt.y - prev.y) < tier.dy) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    placedPoints.push(pt);
    const key = `${isPrashad ? "p" : "m"}_${feat.properties.qid || feat.properties.name}`;
    nextKeys.set(key, feat);
  }

  // Remove only pins that exited viewport or lost priority
  for (const [key, entry] of state.activePhotoPins.entries()) {
    if (!nextKeys.has(key)) {
      entry.marker.remove();
      state.activePhotoPins.delete(key);
    }
  }

  // Reuse existing DOM nodes cleanly; only create newly entering pins
  for (const [key, feat] of nextKeys.entries()) {
    const existing = state.activePhotoPins.get(key);
    if (existing) {
      existing.el.style.setProperty("--pin-w", `${tier.w}px`);
      existing.el.style.setProperty("--pin-h", `${tier.h}px`);
      existing.el.style.setProperty("--pin-label-w", `${tier.labelW}px`);
      continue;
    }

    const coords = feat.geometry.coordinates;
    const p = feat.properties;
    const el = document.createElement("div");
    el.className = "photo-pin";
    el.style.setProperty("--pin-w", `${tier.w}px`);
    el.style.setProperty("--pin-h", `${tier.h}px`);
    el.style.setProperty("--pin-label-w", `${tier.labelW}px`);

    const frameClass = p.unesco ? "is-unesco" : p.revenueCr ? "is-ticketed" : "";
    const imgSrc = pinThumbUrl(p.image);
    el.innerHTML = `
      <div class="photo-pin-frame ${frameClass}">
        <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" />
      </div>
      <div class="photo-pin-label">${escapeHtml(p.name)}</div>
      <div class="photo-pin-stem"></div>
    `;

    const img = el.querySelector("img");
    if (img.complete) {
      img.classList.add("loaded");
    } else {
      img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
    }
    img.addEventListener("error", () => {
      el.style.display = "none";
    }, { once: true });

    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (isPrashad) openPrashadDrawer(p, coords);
      else openMonumentDrawer(p, coords);
    });

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat(coords)
      .addTo(map);
    state.activePhotoPins.set(key, { marker, el });
  }
}

function applyFilters() {
  state.filteredMonuments = getFilteredMonuments();
  state.filteredPrashad = getFilteredPrashad();

  const mSrc = map.getSource("monuments");
  if (mSrc) mSrc.setData(state.filteredMonuments);

  const pSrc = map.getSource("prashad");
  if (pSrc) pSrc.setData(state.filteredPrashad);

  const total =
    state.activeFilter === "prashad"
      ? state.filteredPrashad.features.length
      : state.filteredMonuments.features.length;

  elCount.textContent =
    state.activeFilter === "prashad"
      ? `${total} PRASHAD projects`
      : `${total.toLocaleString()} government-recognized sites`;

  if (map.getLayer("monuments-uncovered-excl") && map.setLayerZoomRange) {
    map.setLayerZoomRange("monuments-uncovered-excl", state.activeFilter === "uncovered" ? 2.5 : 5.5, 22);
  }

  schedulePhotoPins();
}

function renderBudgetPanel() {
  if (!state.circles.length) return;
  const maxVal = Math.max(...state.circles.map((c) => c.per_site_lakh));
  elBudgetList.innerHTML = state.circles
    .map((c) => {
      const pct = Math.max(4, Math.min(100, (c.per_site_lakh / Math.min(maxVal, 45)) * 100));
      const isLow = c.per_site_lakh < 8.5;
      const stateFilter = c.state.includes("Uttar Pradesh")
        ? "Uttar Pradesh"
        : c.state.includes("Karnataka")
        ? "Karnataka"
        : c.state.includes("Tamil Nadu")
        ? "Tamil Nadu"
        : c.state.includes("Delhi")
        ? "Delhi"
        : c.state.includes("NE")
        ? "Assam"
        : c.state;
      return `
        <div class="budget-row" data-state="${escapeHtml(stateFilter)}" title="${escapeHtml(c.circle)}: ${escapeHtml(formatMoneyCr(c.exp_cr, true))} across ${c.monuments} monuments">
          <span class="budget-circle">${escapeHtml(c.circle)}</span>
          <div class="budget-bar-track"><div class="budget-bar-fill ${isLow ? "low" : ""}" style="width:${pct.toFixed(1)}%"></div></div>
          <span class="budget-val">${escapeHtml(formatMoneyLakh(c.per_site_lakh))}/site</span>
        </div>
      `;
    })
    .join("");

  elBudgetList.querySelectorAll(".budget-row").forEach((row) => {
    row.addEventListener("click", () => {
      const st = row.dataset.state;
      if (st) {
        elStateSelect.value = st;
        state.selectedState = st;
        applyFilters();
      }
    });
  });
}

function showTooltip(point, html) {
  elTooltip.innerHTML = html;
  const pad = 14;
  const maxLeft = window.innerWidth - 230;
  const left = Math.min(point.x + pad, maxLeft);
  const top = Math.max(12, point.y - 24);
  elTooltip.style.left = `${left}px`;
  elTooltip.style.top = `${top}px`;
  elTooltip.classList.remove("hidden");
}

function setSelectedSite(coords) {
  const src = map.getSource("selected-site");
  if (!src) return;
  if (!Array.isArray(coords) || coords.length < 2) {
    src.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  src.setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "Point", coordinates: coords }, properties: {} }],
  });
}

function flyToSite(coords) {
  const isMobile = window.innerWidth <= 768;
  const drawerOpen = elDrawer && !elDrawer.classList.contains("hidden");
  let padding = { top: 24, bottom: 24, left: 24, right: 24 };
  if (drawerOpen) {
    const rect = elDrawer.getBoundingClientRect();
    if (isMobile) {
      padding = {
        top: 52,
        bottom: Math.min(window.innerHeight * 0.68, Math.round(rect.height + 20)),
        left: 16,
        right: 16,
      };
    } else {
      padding = {
        top: 24,
        bottom: 56,
        left: 32,
        right: Math.min(window.innerWidth * 0.52, Math.round(rect.width + 28)),
      };
    }
  }
  map.easeTo({
    center: coords,
    padding,
    duration: 340,
    essential: true,
  });
}

function showDetailDrawer(coords) {
  elDrawer.classList.remove("hidden");
  document.body.classList.add("drawer-open");
  if (window.innerWidth <= 768) {
    const lp = document.getElementById("left-panel");
    const rb = document.getElementById("reopen-sidebar-btn");
    if (lp && rb) {
      lp.classList.add("collapsed");
      rb.classList.remove("hidden");
    }
  }
  setSelectedSite(coords);
  requestAnimationFrame(() => {
    if (coords) flyToSite(coords);
    schedulePhotoPins();
  });
}

function closeDetailDrawer() {
  elDrawer.classList.add("hidden");
  document.body.classList.remove("drawer-open");
  state.carouselHandler = null;
  state.nearbyNav = null;
  renderNearbyNavSlot(null);
  setSelectedSite(null);
  schedulePhotoPins();
}

function stripHtmlText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatImageCredit(ext) {
  if (!ext || typeof ext !== "object") return "Wikimedia Commons";
  const artistRaw = stripHtmlText(ext.Artist?.value || "");
  const artist = artistRaw && !/^unknown/i.test(artistRaw) && artistRaw.length <= 58 ? artistRaw : "";
  const license = stripHtmlText(ext.LicenseShortName?.value || "");
  if (artist && license) return `Photo: ${artist} · ${license}`;
  if (artist) return `Photo: ${artist} · Wikimedia Commons`;
  if (license) return `Wikimedia Commons · ${license}`;
  return "Wikimedia Commons";
}

function extractCommonsFilename(url) {
  if (!url) return "";
  try {
    const clean = String(url).split("?")[0];
    const parts = clean.split("/").filter(Boolean);
    const last = decodeURIComponent(parts[parts.length - 1] || "");
    const stripped = last.replace(/^\d+px-/, "");
    return stripped ? `File:${stripped}` : "";
  } catch {
    return "";
  }
}

function renderCarouselHtml(slides) {
  if (!slides.length) return "";
  const multi = slides.length > 1;
  const firstCredit = slides[0].credit || "";
  return `
    <div class="carousel-wrap" id="drawer-carousel">
      <div class="carousel-stage">
        <img id="carousel-main-img" src="${escapeHtml(slides[0].url)}" alt="${escapeHtml(slides[0].caption)}" />
        ${multi ? `<button type="button" class="carousel-btn carousel-prev" aria-label="Previous photo">‹</button>` : ""}
        ${multi ? `<button type="button" class="carousel-btn carousel-next" aria-label="Next photo">›</button>` : ""}
        ${multi ? `<span class="carousel-counter" id="carousel-counter">1 / ${slides.length}</span>` : ""}
      </div>
      ${
        multi
          ? `<div class="carousel-thumbs">${slides
              .map(
                (s, i) =>
                  `<button type="button" class="carousel-thumb ${i === 0 ? "active" : ""}" data-idx="${i}"><img src="${escapeHtml(thumbUrl(s.url))}" alt="" loading="lazy" /></button>`
              )
              .join("")}</div>`
          : ""
      }
      <div class="carousel-caption" id="carousel-caption">${escapeHtml(slides[0].caption)}</div>
      <div class="carousel-credit" id="carousel-credit">${escapeHtml(firstCredit)}</div>
    </div>
  `;
}

function applyBestImageFit(img) {
  if (!img) return;
  const check = () => {
    if (!img.naturalWidth || !img.naturalHeight) return;
    const ratio = img.naturalWidth / img.naturalHeight;
    // Show tall/square monuments completely uncropped instead of slicing spires or facades
    img.classList.toggle("is-contain", ratio < 1.18);
  };
  if (img.complete) check();
  else img.addEventListener("load", check, { once: true });
}

function bindCarousel(slides) {
  const wrap = document.getElementById("drawer-carousel");
  const mainImg = document.getElementById("carousel-main-img");
  if (mainImg) applyBestImageFit(mainImg);
  if (!wrap || slides.length <= 1) {
    state.carouselHandler = null;
    return;
  }
  let idx = 0;
  const counter = document.getElementById("carousel-counter");
  const caption = document.getElementById("carousel-caption");
  const credit = document.getElementById("carousel-credit");
  const thumbs = Array.from(wrap.querySelectorAll(".carousel-thumb"));

  function go(next) {
    idx = (next + slides.length) % slides.length;
    mainImg.classList.remove("is-contain");
    mainImg.src = slides[idx].url;
    mainImg.alt = slides[idx].caption;
    applyBestImageFit(mainImg);
    if (counter) counter.textContent = `${idx + 1} / ${slides.length}`;
    if (caption) caption.textContent = slides[idx].caption;
    if (credit) credit.textContent = slides[idx].credit || "";
    thumbs.forEach((t, i) => t.classList.toggle("active", i === idx));
  }

  wrap.querySelector(".carousel-prev")?.addEventListener("click", () => go(idx - 1));
  wrap.querySelector(".carousel-next")?.addEventListener("click", () => go(idx + 1));
  thumbs.forEach((t) =>
    t.addEventListener("click", () => go(Number(t.dataset.idx)))
  );
  state.carouselHandler = (dir) => go(idx + dir);
}

function normalizeCleanName(name) {
  return String(name || "")
    .replace(/\(\s*[ivxlcdm]+\s*\)/gi, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FOREIGN_SITE_RE = /\b(mexico|mexican|maya|mayan|aztec|teotihuacan|palenque|oaxaca|yucatan|guatemala|peru|inca|egypt|cambodia|angkor|indonesia|china|turkey|greece|italy|france|spain|united states)\b/i;

function distinguishingTokens(text) {
  const stop = new Set([
    "temple", "temples", "fort", "tomb", "tombs", "mosque", "masjid", "shrine", "mound", "stupa", "cave", "caves",
    "palace", "gate", "gateway", "bridge", "pillar", "column", "tank", "well", "stepwell", "group",
    "ancient", "old", "ruins", "remains", "site", "sites", "monument", "monuments", "memorial",
    "archaeological", "historical", "historic", "heritage", "excavated", "complex", "structure", "structures",
    "building", "buildings", "water", "hill", "hills", "rock", "rocks", "circle", "protected", "inscription",
    "shiva", "siva", "vishnu", "devi", "jain", "buddhist", "india", "indian", "district", "tehsil",
    "village", "near", "located", "north", "south", "east", "west", "adam",
  ]);
  return normalizeCleanName(text)
    .toLowerCase()
    .split(/[\s,()]+/)
    .filter((w) => w.length >= 4 && !stop.has(w));
}

function renderSatelliteFallbackHtml(props, coords, searching) {
  if (!Array.isArray(coords) || coords.length < 2) return "";
  const z = 17;
  const [lng, lat] = coords;
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  const offX = Math.round((fx - cx) * 256);
  const offY = Math.round((fy - cy) * 256);

  const tiles = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = ((cx + dx) % n + n) % n;
      const ty = Math.max(0, Math.min(n - 1, cy + dy));
      tiles.push(
        `<img src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}" alt="" loading="lazy" />`
      );
    }
  }

  const uploadDesc = [props.name, props.asiId, props.place || props.location, props.state]
    .filter(Boolean)
    .join(" - ");
  const uploadUrl = `https://commons.wikimedia.org/wiki/Special:UploadWizard?categories=${encodeURIComponent(
    "Wiki Loves Monuments in India"
  )}&description=${encodeURIComponent(uploadDesc)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;

  const capText = searching
    ? "Aerial view · Searching Wikimedia Commons archives…"
    : "No established Wikimedia photo record yet — Aerial satellite view";

  return `
    <div class="carousel-wrap" id="drawer-carousel">
      <div class="carousel-stage sat-stage">
        <div class="sat-grid" style="transform: translate(-${256 + offX}px, -${256 + offY}px);">
          ${tiles.join("")}
        </div>
        <span class="sat-pin" aria-hidden="true"></span>
        <span class="sat-badge"><span class="legend-excl" aria-hidden="true">!</span>Satellite View · Poorly Covered</span>
      </div>
      <div class="carousel-cap-row">
        <div class="carousel-caption" id="carousel-caption">${escapeHtml(capText)}</div>
        <a class="carousel-upload-link" href="${escapeHtml(uploadUrl)}" target="_blank" rel="noopener">Upload photo ↗</a>
      </div>
    </div>
  `;
}

async function fetchGalleryImages(props, coords) {
  const key = props.qid || props.name;
  if (state.galleryCache[key]) return state.galleryCache[key];

  const seen = new Set();
  const slides = [];
  const artifactOrArchivalRe = /\b(painting|lithograph|engraving|watercolou?r|sketch|aquatint|etching|drawing|pottery|sherd|coin|numismatic|terracotta|figurine|artifact|artefact|excavated|museum|relic|manuscript|copper_?plate|copper\s+plate|colonial)\b/i;
  const pushSlide = (url, caption, credit = "", rawHint = "") => {
    if (!url || seen.has(url)) return;
    if (artifactOrArchivalRe.test(`${rawHint} ${caption || ""}`)) return;
    seen.add(url);
    slides.push({ url: hiResUrl(url), caption: caption || props.name, credit });
  };
  if (props.image) pushSlide(props.image, `${props.name} · Primary Archive Photo`, "Wikimedia Commons");

  const skipRe = /\.(svg|ogg|ogv|webm|pdf|tif|tiff)$/i;
  const badTitleRe = /(flag|emblem|coat_of_arms|map|locator|icon|logo|commons-logo|wikidata|question_book|ambox|edit-clear|symbol|stamp|postage|plaque|board|ticket|plan|seal|station_board|railway_station|college|hospital|school|autonagar|bus_stand|airport)/i;

  try {
    // 0) Lookup photographer & license credit for primary Wikimedia photo
    if (props.image) {
      const fileTitle = extractCommonsFilename(props.image);
      if (fileTitle) {
        const crRes = await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=extmetadata&format=json&origin=*`
        );
        if (crRes.ok) {
          const crData = await crRes.json();
          const pg = Object.values((crData.query && crData.query.pages) || {})[0];
          const ii = pg?.imageinfo?.[0];
          if (ii?.extmetadata && slides[0]) {
            slides[0].credit = formatImageCredit(ii.extmetadata);
          }
        }
      }
    }

    // 0b) Live Wikidata check (P18 image, P373 Commons Category, enwiki link) when local fields are missing
    let discoveredWikiTitle =
      props.wikipedia && props.wikipedia.includes("/wiki/")
        ? decodeURIComponent(props.wikipedia.split("/wiki/")[1])
        : "";

    if ((!props.image || !discoveredWikiTitle) && props.qid && /^Q\d+$/i.test(props.qid)) {
      const wdRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          props.qid
        )}&props=claims|sitelinks&format=json&origin=*`
      );
      if (wdRes.ok) {
        const wdData = await wdRes.json();
        const ent = wdData?.entities?.[props.qid];
        if (!discoveredWikiTitle && ent?.sitelinks?.enwiki?.title) {
          discoveredWikiTitle = ent.sitelinks.enwiki.title;
        }
        const p18 = ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        const p373 = ent?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
        if (p18 && !badTitleRe.test(p18)) {
          const infoRes = await fetch(
            `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
              `File:${p18}`
            )}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=960&format=json&origin=*`
          );
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            for (const pg of Object.values(infoData?.query?.pages || {})) {
              const ii = pg.imageinfo?.[0];
              if (ii && (ii.thumburl || ii.url)) {
                pushSlide(ii.thumburl || ii.url, `${props.name} · Wikidata P18`, formatImageCredit(ii.extmetadata));
              }
            }
          }
        }
        if (p373 && slides.length < 5) {
          const catRes = await fetch(
            `https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtitle=${encodeURIComponent(
              `Category:${p373}`
            )}&gcmtype=file&gcmlimit=8&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=960&format=json&origin=*`
          );
          if (catRes.ok) {
            const catData = await catRes.json();
            for (const pg of Object.values(catData?.query?.pages || {})) {
              const ii = pg.imageinfo?.[0];
              const t = pg.title || "";
              if (!ii || !(ii.mime || "").startsWith("image/") || skipRe.test(t) || badTitleRe.test(t)) continue;
              const desc = t.replace(/^File:/, "").replace(/\.[^.]+$/, "").replace(/_/g, " ");
              pushSlide(ii.thumburl || ii.url, desc, formatImageCredit(ii.extmetadata));
              if (slides.length >= 7) break;
            }
          }
        }
      }
    }

    // 1) Fetch lead image + clean site photographs ONLY from this monument's own verified Wikipedia page
    if (discoveredWikiTitle) {
      const wpRes = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(discoveredWikiTitle)}&prop=pageimages|images&pithumbsize=960&imlimit=20&format=json&origin=*`
      );
      if (wpRes.ok) {
        const wpData = await wpRes.json();
        const pages = Object.values((wpData.query && wpData.query.pages) || {});
        if (pages[0]?.thumbnail?.source) {
          pushSlide(pages[0].thumbnail.source, `${props.name} · Overview`, "Wikipedia / Wikimedia Commons", pages[0].pageimage || "");
        }
        const files = (pages[0]?.images || [])
          .map((im) => im.title)
          .filter((t) => t && !skipRe.test(t) && !badTitleRe.test(t))
          .slice(0, 8);
        if (files.length) {
          const infoRes = await fetch(
            `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(files.join("|"))}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=960&format=json&origin=*`
          );
          if (infoRes.ok) {
            const infoData = await infoRes.json();
            for (const pg of Object.values((infoData.query && infoData.query.pages) || {})) {
              const ii = pg.imageinfo && pg.imageinfo[0];
              if (!ii || !(ii.mime || "").startsWith("image/") || !(ii.thumburl || ii.url)) continue;
              const t = pg.title || "";
              const desc = t.replace(/^File:/, "").replace(/\.[^.]+$/, "").replace(/_/g, " ");
              pushSlide(ii.thumburl || ii.url, desc, formatImageCredit(ii.extmetadata), t);
              if (slides.length >= 6) break;
            }
          }
        }
      }
    }
  } catch {
    // Offline or blocked; preserve verified/satellite view cleanly
  }

  state.galleryCache[key] = slides;
  return slides;
}

function hydrateDrawerCarousel(mountId, props, coords) {
  const initialSlides = props.image
    ? [{ url: hiResUrl(props.image), caption: `${props.name} · Primary Archive Photo`, credit: "Wikimedia Commons" }]
    : [];
  const mount = document.getElementById(mountId);
  if (!mount) return;
  if (initialSlides.length) {
    mount.innerHTML = renderCarouselHtml(initialSlides);
    bindCarousel(initialSlides);
  } else {
    mount.innerHTML = renderSatelliteFallbackHtml(props, coords, true);
  }
  const activeKey = props.qid || props.name;
  elDrawer.dataset.activeKey = activeKey;
  fetchGalleryImages(props, coords).then((fullSlides) => {
    if (elDrawer.dataset.activeKey !== activeKey) return;
    const latestMount = document.getElementById(mountId);
    if (!latestMount) return;
    if (fullSlides.length > initialSlides.length || (fullSlides.length && fullSlides[0].credit !== initialSlides[0]?.credit)) {
      latestMount.innerHTML = renderCarouselHtml(fullSlides);
      bindCarousel(fullSlides);
      if (!props.image && fullSlides.length) {
        const covBadge = document.getElementById("coverage-badge");
        if (covBadge) covBadge.remove();
        const photoGap = document.querySelector('[data-gap="photo"]');
        if (photoGap) photoGap.remove();
      }
    } else if (!initialSlides.length) {
      const capEl = document.getElementById("carousel-caption");
      if (capEl) capEl.textContent = "Satellite aerial view · Poorly covered (no Wikimedia Commons photo yet)";
    }
  });
}

function buildFallbackTwoSentenceSummary(props) {
  const loc = [props.place, props.location, props.state].filter(Boolean).join(", ");
  const isStateProtected = String(props.asiId || "").toUpperCase().startsWith("S-");
  const rawDesc = (props.desc || "").trim();
  const typeLabel = props.siteType ? props.siteType.toLowerCase() : "";
  const styleLabel = props.style || "";

  let s1 = "";
  if (rawDesc && rawDesc.length > 36 && !/^state protected monument/i.test(rawDesc)) {
    s1 = rawDesc.replace(/\.+$/, "") + ".";
  } else {
    let noun = "historic monument";
    if (typeLabel && styleLabel && !styleLabel.toLowerCase().includes(typeLabel)) {
      noun = `${styleLabel} ${typeLabel}`;
    } else if (typeLabel) {
      noun = typeLabel;
    } else if (styleLabel) {
      noun = `${styleLabel} monument`;
    } else if (rawDesc && !/protected/i.test(rawDesc) && rawDesc.toLowerCase() !== (props.name || "").toLowerCase()) {
      noun = rawDesc.replace(/\.+$/, "");
    }
    const article = /^[aeiou]/i.test(noun) ? "an" : "a";
    const builtPhrase = props.period
      ? ` from the ${props.period} period`
      : props.year
      ? ` dating to ${formatYear(props.year)}`
      : "";
    s1 = `${props.name} is ${article} ${noun}${builtPhrase}${loc ? ` located in ${loc}` : ""}.`;
  }

  const highlights = [];
  if (props.unesco) highlights.push(`UNESCO World Heritage designation${props.unescoYear ? ` (${props.unescoYear})` : ""}`);
  if (props.material) highlights.push(`built of ${props.material.toLowerCase()}`);
  if (props.epigraphy) highlights.push("recorded inscriptions and epigraphy");
  if (props.adoptPartner) highlights.push(`conservation support via ${props.adoptPartner}`);

  let s2 = "";
  if (highlights.length) {
    s2 = `Notable features include ${highlights.join(", ")}.`;
  } else if (isStateProtected) {
    s2 = `Protected as a State Heritage Monument${props.asiId ? ` (${props.asiId})` : ""}${props.state ? ` under the ${props.state} Directorate of Archaeology` : ""}.`;
  } else {
    s2 = `Maintained by the Archaeological Survey of India${props.circleName ? ` (${props.circleName})` : ""} as a Monument of National Importance${props.asiId ? ` (${props.asiId})` : ""}.`;
  }
  return `${s1} ${s2}`;
}

// Verified official FY 2019-20 to FY 2023-24 figures (Ministry of Culture / Rajya Sabha & MoT Data Compendium)
const TICKET_YEARS = ["19–20", "20–21", "21–22", "22–23", "23–24"];
const TICKET_HISTORY_5Y = {
  "taj mahal": {
    revenueCr: [97.11, 9.53, 25.62, 66.57, 98.55],
    visitorsLakhs: [63.17, 17.31, 27.21, 62.35, 76.24],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
  "agra fort": {
    revenueCr: [28.94, 1.31, 4.0, 15.32, 15.27],
    visitorsLakhs: [20.14, null, null, 15.49, 16.29],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
  "qutub minar": {
    revenueCr: [20.17, 1.56, 5.07, 19.2, 23.8],
    visitorsLakhs: [23.03, null, 18.83, 32.39, 33.44],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
  "qutb minar": {
    revenueCr: [20.17, 1.56, 5.07, 19.2, 23.8],
    visitorsLakhs: [23.03, null, 18.83, 32.39, 33.44],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
  "red fort": {
    revenueCr: [16.24, 0.9, 6.01, 13.11, 18.09],
    visitorsLakhs: [null, null, null, 22.64, 28.78],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
  "lal qila": {
    revenueCr: [16.24, 0.9, 6.01, 13.11, 18.09],
    visitorsLakhs: [null, null, null, 22.64, 28.78],
    source: "Ministry of Culture (Rajya Sabha) & MoT Compendium",
  },
};

function getFiveYearSeries(props) {
  const key = String(props.name || "").trim().toLowerCase();
  if (props.qid === "Q7676724" || key.includes("palace")) return null;
  for (const [k, data] of Object.entries(TICKET_HISTORY_5Y)) {
    if (key.includes(k)) return data;
  }
  return null;
}

function renderBarChartHtml(title, unit, values, isVisitors) {
  if (!values) return "";
  const numericVals = values.filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v))).map(Number);
  if (numericVals.length < 3) return "";
  const maxVal = Math.max(...numericVals, 0.01);
  return `
    <div class="chart-section">
      <div class="chart-head">
        <span class="chart-title">${escapeHtml(title)}</span>
        <span class="chart-unit">${escapeHtml(unit)}</span>
      </div>
      <div class="bar-grid">
        ${values
          .map((val, i) => {
            const hasVal = val !== null && val !== undefined && Number.isFinite(Number(val));
            const num = hasVal ? Number(val) : 0;
            const pct = hasVal ? Math.max(8, Math.round((num / maxVal) * 100)) : 0;
            const valText = hasVal ? (isVisitors ? num.toFixed(1) : num.toFixed(num >= 10 ? 1 : 2)) : "N/A";
            return `
              <div class="bar-col">
                <span class="bar-val ${hasVal ? "" : "is-na"}">${escapeHtml(valText)}</span>
                <div class="bar-track">
                  <div class="bar-fill ${isVisitors ? "is-visitors" : ""} ${hasVal ? "" : "is-na"}" style="height:${pct}%"></div>
                </div>
                <span class="bar-fy">${TICKET_YEARS[i]}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function citeHtml(sourceText, url, label = "Citation") {
  if (!sourceText) return "";
  const linkPart = url
    ? ` — <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open source ↗</a>`
    : "";
  return `
    <details class="cite-drop">
      <summary>${escapeHtml(label)} ▾</summary>
      <div class="cite-body">${escapeHtml(sourceText)}${linkPart}</div>
    </details>
  `;
}

function findLinkedPrashad(props) {
  if (!state.prashad || !props) return null;
  const st = String(props.state || "").toLowerCase();
  const toks = distinguishingTokens(props.name || "");
  const nameLow = String(props.name || "").toLowerCase();
  for (const f of state.prashad.features) {
    const pp = f.properties || {};
    if (st && String(pp.state || "").toLowerCase() !== st) continue;
    const pName = String(pp.name || "").toLowerCase();
    if (nameLow.length > 5 && pName.includes(nameLow)) return pp;
    if (toks.length && toks.some((t) => pName.includes(t))) return pp;
  }
  return null;
}

function parseCenturyToYear(text) {
  const m = String(text || "").match(/(\d{1,2})(?:st|nd|rd|th)(?:\s*[–-]\s*(\d{1,2})(?:st|nd|rd|th))?\s+century(?:\s*(BCE|BC|CE|AD))?/i);
  if (!m) return null;
  const c1 = Number(m[1]);
  const c2 = m[2] ? Number(m[2]) : c1;
  const avgC = (c1 + c2) / 2;
  const isBce = /bc/i.test(m[3] || "");
  const approx = Math.round((avgC - 0.5) * 100);
  const yearNum = isBce ? -approx : approx;
  const label = `${m[1]}${m[1] === "1" ? "st" : m[1] === "2" ? "nd" : m[1] === "3" ? "rd" : "th"}${m[2] ? `–${m[2]}th` : ""} century ${isBce ? "BCE" : "CE"}`;
  return { yearNum, label, approx: true };
}

function extractConstructionInfo(props, extraText = "") {
  const currentYear = new Date().getFullYear();
  if (props.year !== null && props.year !== undefined && props.year !== "") {
    const numY = Number(props.year);
    if (!Number.isNaN(numY)) {
      const age = Math.max(1, currentYear - numY);
      return {
        yearNum: numY,
        builtLabel: formatYear(numY),
        ageLabel: `${age.toLocaleString()} yrs`,
        approx: false,
        source: "Wikidata / ASI Architectural Record",
      };
    }
  }
  const combined = `${props.period || ""} ${props.desc || ""} ${extraText || ""}`.trim();
  const yearMatch = combined.match(/\b(?:built|constructed|erected|founded|commissioned|dated|dating to|circa|c\.)\s*(?:in\s*|to\s*|around\s*)?(\d{3,4})\s*(BCE|BC|CE|AD)?\b/i);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    if (yr >= 100 && yr <= currentYear) {
      const yearNum = /bc/i.test(yearMatch[2] || "") ? -yr : yr;
      const age = Math.max(1, currentYear - yearNum);
      return {
        yearNum,
        builtLabel: `c. ${formatYear(yearNum)}`,
        ageLabel: `~${age.toLocaleString()} yrs`,
        approx: true,
        source: extraText ? "Wikipedia Article Extract" : "ASI Monument Record",
      };
    }
  }
  const cent = parseCenturyToYear(combined);
  if (cent) {
    const age = Math.max(1, currentYear - cent.yearNum);
    return {
      yearNum: cent.yearNum,
      builtLabel: cent.label,
      ageLabel: `~${age.toLocaleString()} yrs`,
      approx: true,
      source: extraText ? "Wikipedia Article Extract" : "ASI Monument Record",
    };
  }
  return {
    yearNum: null,
    builtLabel: props.period || "Period unrecorded",
    ageLabel: "Date not listed",
    approx: true,
    source: "ASI Protected List",
  };
}

function getTicketPricingInfo(props) {
  const isTicketed = Boolean(props.revenueCr || props.footfallLakhs);
  if (!isTicketed) return null;
  const key = String(props.name || "").toLowerCase();
  if (key.includes("taj mahal") && !key.includes("palace")) {
    return {
      entryStr: formatTicketPair(50, 1100),
      extraStr: state.currency === "USD" ? "+$2.38 Mausoleum" : "+₹200 Mausoleum access",
      tier: "Taj Mahal Special Tariff (ASI Gazette)",
    };
  }
  if (props.unesco) {
    return {
      entryStr: formatTicketPair(40, 600),
      extraStr: state.currency === "USD" ? "$0.42 / $6.55 e-ticket" : "₹35 / ₹550 via ASI e-ticket",
      tier: "ASI Category A · World Heritage Tariff",
    };
  }
  return {
    entryStr: formatTicketPair(25, 300),
    extraStr: state.currency === "USD" ? "$0.24 / $2.98 e-ticket" : "₹20 / ₹250 via ASI e-ticket",
    tier: "ASI Category B · Standard Ticketed Monument",
  };
}

function renderCurrencySwitchHtml() {
  return `
    <div class="currency-switch" id="drawer-currency-switch" role="group" aria-label="Display currency">
      <button type="button" class="curr-btn ${state.currency === "INR" ? "active" : ""}" data-currency="INR" aria-pressed="${state.currency === "INR"}">₹ INR</button>
      <button type="button" class="curr-btn ${state.currency === "USD" ? "active" : ""}" data-currency="USD" aria-pressed="${state.currency === "USD"}">$ USD</button>
    </div>
  `;
}

function bindDrawerCurrencySwitch(activeTab = "overview") {
  const sw = document.getElementById("drawer-currency-switch");
  if (!sw) return;
  sw.querySelectorAll(".curr-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.currency;
      if (!next || next === state.currency) return;
      state.currency = next;
      renderBudgetPanel();
      if (state.lastDrawer) {
        const curTab = elDetailContent.querySelector(".drawer-tab.active")?.dataset.tab || activeTab;
        if (state.lastDrawer.kind === "prashad") {
          openPrashadDrawer(state.lastDrawer.props, state.lastDrawer.coords);
        } else {
          openMonumentDrawer(state.lastDrawer.props, state.lastDrawer.coords, curTab);
        }
      }
    });
  });
}

function getFundingHealth(props, linkedPrashad) {
  const perSite = props.circlePerSiteLakh ? Number(props.circlePerSiteLakh) : null;
  const expCr = props.circleExpCr ? Number(props.circleExpCr) : null;
  const mons = props.circleMonuments ? Number(props.circleMonuments) : null;

  let tierKey = "tier-unknown";
  let tierLabel = "Budget Unlisted";

  if (perSite !== null) {
    if (perSite >= 12.5 || (props.adoptPartner && !props.underfundedCircle)) {
      tierKey = "tier-good";
      tierLabel = "Above Median";
    } else if (perSite >= 8.5) {
      tierKey = "tier-avg";
      tierLabel = "Near Median";
    } else {
      tierKey = "tier-poor";
      tierLabel = "Underfunded";
    }
  } else if (linkedPrashad || props.adoptPartner) {
    tierKey = "tier-good";
    tierLabel = "Grant / CSR";
  }

  return {
    perSite,
    expCr,
    mons,
    tierKey,
    tierLabel,
    siteBudgetText: perSite !== null ? formatMoneyLakh(perSite, true) : linkedPrashad ? formatMoneyCr(linkedPrashad.approvedCr, true) : "Unlisted",
    siteBudgetSub: perSite !== null
      ? (props.adoptPartner ? `Circle avg + ${props.adoptPartner}` : "Circle avg / site")
      : linkedPrashad
      ? `PRASHAD (${linkedPrashad.progress})`
      : "No individual site figure",
    circleBudgetText: expCr !== null ? `${formatMoneyCr(expCr, true)} / yr` : props.circleName || "Unmapped",
    circleBudgetSub: expCr !== null && mons
      ? `${props.circleName} (${mons} sites)`
      : "Circle figure unlisted",
  };
}

function getCoverageGaps(props, hasRealPhoto, constructionInfo) {
  const gaps = [];
  if (!hasRealPhoto) {
    gaps.push({ key: "photo", label: "No archive photo (Satellite aerial view only)" });
  }
  if (!props.wikipedia) {
    gaps.push({ key: "wiki", label: "No dedicated Wikipedia article linked" });
  }
  if (!props.year && !props.period && constructionInfo.yearNum === null) {
    gaps.push({ key: "date", label: "No recorded construction year or historical period" });
  }
  if (!props.style && !props.material && (!props.desc || props.desc.length < 40)) {
    gaps.push({ key: "research", label: "Sparse architectural & material documentation" });
  }
  return gaps;
}

function getStateBreakdown(stateName) {
  if (!state.monuments || !stateName) return null;
  const feats = state.monuments.features.filter((f) => f.properties.state === stateName);
  if (!feats.length) return null;
  let photos = 0;
  let unesco = 0;
  let ticketed = 0;
  let adopt = 0;
  let underfunded = 0;
  for (const f of feats) {
    const p = f.properties;
    if (p.image) photos++;
    if (p.unesco) unesco++;
    else if (p.revenueCr || p.footfallLakhs) ticketed++;
    else if (p.adoptPartner) adopt++;
    else if (p.underfundedCircle) underfunded++;
  }
  const total = feats.length;
  const standard = Math.max(0, total - unesco - ticketed - adopt - underfunded);
  return { total, photos, uncovered: total - photos, unesco, ticketed, adopt, underfunded, standard };
}

function extractRestorationEvents(text, sourceLabel) {
  if (!text) return [];
  const re = /(restor|conserv|renovat|repair|reconstruct|excavat|stabiliz|refurbish|rebuilt|preserv)/i;
  const sentences = String(text).replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || [];
  const out = [];
  for (const s of sentences) {
    if (!re.test(s) || s.length > 260) continue;
    const yrM = s.match(/\b(1[6-9]\d{2}|20[0-2]\d)\b/);
    out.push({
      year: yrM ? Number(yrM[1]) : 9999,
      yearLabel: yrM ? yrM[1] : "Documented",
      text: s.trim(),
      source: sourceLabel,
      kind: "active",
    });
    if (out.length >= 6) break;
  }
  return out;
}

function getBaseRestorationInfo(props, linkedPrashad, reports) {
  const events = [];
  for (const ev of extractRestorationEvents(props.desc, "ASI Monument Archive")) {
    events.push(ev);
  }
  if (linkedPrashad) {
    events.push({
      year: parseInt(linkedPrashad.year, 10) || 2020,
      yearLabel: linkedPrashad.year || "PRASHAD",
      text: `Sanctioned under Ministry of Tourism PRASHAD (${formatMoneyCr(linkedPrashad.approvedCr, true)}) — current progress: ${linkedPrashad.progress}.`,
      source: "Ministry of Tourism PRASHAD",
      kind: String(linkedPrashad.progress) === "100%" ? "verified" : "active",
    });
  }
  if (props.adoptPartner) {
    events.push({
      year: 2024,
      yearLabel: "Active CSR",
      text: `Adopted by ${props.adoptPartner} (${props.adoptScope || "Visitor amenities & upkeep; core structural conservation retained by ASI"}).`,
      source: props.adoptProgram || "Adopt a Heritage 2.0",
      kind: "active",
    });
  }
  for (const r of reports) {
    events.push({
      year: parseInt(String(r.date || "").slice(0, 4), 10) || 2026,
      yearLabel: r.date || "Recent",
      text: `${r.category}${r.note ? `: ${r.note}` : ""}`,
      source: "Local Field Observation",
      kind: r.category === "Restoration Verified" ? "verified" : "flag",
    });
  }

  events.sort((a, b) => a.year - b.year);

  const hasDecay = reports.some((r) => /Decay|Encroachment/i.test(r.category));
  const isOngoing = Boolean(
    props.adoptPartner ||
    (linkedPrashad && String(linkedPrashad.progress) !== "100%") ||
    extractRestorationEvents(props.desc, "").length
  );
  const isVerified = reports.some((r) => r.category === "Restoration Verified") || (linkedPrashad && String(linkedPrashad.progress) === "100%");

  let statusClass = "rest-routine";
  let statusText = "Routine ASI Maintenance";
  let statusNote = "Managed under regional ASI Circle upkeep without an active capital grant flagged.";
  if (hasDecay) {
    statusClass = "rest-flagged";
    statusText = "Needs Attention (Flagged)";
    statusNote = "Field observation logged structural decay or buffer encroachment.";
  } else if (isOngoing) {
    statusClass = "rest-active";
    statusText = "In Restoration / Active Work";
    statusNote = props.adoptPartner
      ? `Active Adopt a Heritage works (${props.adoptPartner}).`
      : linkedPrashad
      ? `Active PRASHAD conservation & infrastructure works (${linkedPrashad.progress}).`
      : "Documented restoration / conservation activity recorded.";
  } else if (isVerified) {
    statusClass = "rest-verified";
    statusText = "Restoration Completed / Verified";
    statusNote = "Completed conservation milestone verified in records.";
  }

  return { events, statusClass, statusText, statusNote };
}

function renderTimelineItemsHtml(events) {
  if (!events.length) {
    return `<div class="timeline-text" style="color:var(--ink-muted);">No dated restoration milestones recorded locally yet. Checking Wikipedia conservation archives if available…</div>`;
  }
  return `
    <div class="timeline-list">
      ${events
        .map(
          (e) => `
          <div class="timeline-item ${e.kind === "active" ? "is-active" : e.kind === "verified" ? "is-verified" : e.kind === "flag" ? "is-flag" : ""}">
            <span class="timeline-dot" aria-hidden="true"></span>
            <div class="timeline-year">${escapeHtml(e.yearLabel)}</div>
            <div class="timeline-text">${escapeHtml(e.text)}</div>
            <div class="timeline-source">${escapeHtml(e.source)}</div>
          </div>
        `
        )
        .join("")}
    </div>
  `;
}

async function fetchWikiTwoSentences(props) {
  const cacheKey = `sum2_${props.qid || props.name}`;
  if (state.galleryCache[cacheKey]) return state.galleryCache[cacheKey];
  try {
    let title = "";
    let url = "";
    if (props.wikipedia && props.wikipedia.includes("/wiki/")) {
      title = decodeURIComponent(props.wikipedia.split("/wiki/")[1]);
      url = props.wikipedia;
    } else {
      const cleanName = normalizeCleanName(props.name);
      const nameToks = distinguishingTokens(cleanName);
      if (!cleanName || cleanName.length < 4 || !nameToks.length) return null;
      const srUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        `${cleanName} ${props.state || "India"} India`
      )}&srlimit=4&format=json&origin=*`;
      const srRes = await fetch(srUrl);
      if (!srRes.ok) return null;
      const srData = await srRes.json();
      const hits = ((srData.query && srData.query.search) || []).filter(
        (h) => h.title && !/^List of /i.test(h.title) && !FOREIGN_SITE_RE.test(`${h.title} ${h.snippet || ""}`)
      );
      if (!hits.length) return null;
      const bestHit =
        hits.find((h) => {
          const hay = `${h.title} ${h.snippet || ""}`.toLowerCase();
          return hay.includes(cleanName.toLowerCase()) || nameToks.some((t) => hay.includes(t));
        }) || null;
      if (!bestHit) return null;
      title = bestHit.title;
      url = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    }

    const exUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
      title
    )}&prop=extracts&explaintext=1&exchars=16000&format=json&origin=*`;
    const exRes = await fetch(exUrl);
    if (!exRes.ok) return null;
    const exData = await exRes.json();
    const pg = Object.values((exData.query && exData.query.pages) || {})[0];
    const fullText = ((pg && pg.extract) || "").trim().replace(/\s+/g, " ");
    if (!fullText) return null;

    const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
    const cleanName = normalizeCleanName(props.name);
    const nameToks = distinguishingTokens(cleanName);
    const relevant = !props.wikipedia
      ? sentences.filter((s) => {
          const low = s.toLowerCase();
          return low.includes(cleanName.toLowerCase()) || (nameToks.length && nameToks.some((t) => low.includes(t)));
        })
      : [];
    const summary = (relevant.length ? relevant.slice(0, 2) : sentences.slice(0, 2)).join(" ").trim();
    const out = { text: summary, fullText, url, title };
    state.galleryCache[cacheKey] = out;
    return out;
  } catch {
    return null;
  }
}

async function fetchWikidataHistoryFacts(qid) {
  if (!qid || !/^Q\d+$/i.test(qid)) return null;
  const cacheKey = `wdhist_${qid}`;
  if (cacheKey in state.galleryCache) return state.galleryCache[cacheKey];
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims&format=json&origin=*`
    );
    if (!res.ok) {
      state.galleryCache[cacheKey] = null;
      return null;
    }
    const data = await res.json();
    const claims = data?.entities?.[qid]?.claims || {};
    const propMap = { P88: "patron", P112: "foundedBy", P170: "creator", P84: "architect", P2348: "timePeriod" };
    const qidByRole = {};
    const targetQids = new Set();
    for (const [pid, role] of Object.entries(propMap)) {
      const val = claims[pid]?.[0]?.mainsnak?.datavalue?.value;
      const targetId = val && typeof val === "object" ? val.id : "";
      if (targetId && /^Q\d+$/i.test(targetId)) {
        qidByRole[role] = targetId;
        targetQids.add(targetId);
      }
    }
    const out = { qid };
    if (targetQids.size) {
      const lRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          [...targetQids].join("|")
        )}&props=labels&languages=en&format=json&origin=*`
      );
      if (lRes.ok) {
        const lData = await lRes.json();
        for (const [role, id] of Object.entries(qidByRole)) {
          const label = lData?.entities?.[id]?.labels?.en?.value;
          if (label) out[role] = label;
        }
      }
    }
    state.galleryCache[cacheKey] = out;
    return out;
  } catch {
    return null;
  }
}

const HISTORY_CUE_RE = /\b(commissioned|built by|constructed by|erected by|founded by|established by|patron|emperor|king|queen|sultan|shah|maharaja|raja|nawab|peshwa|dynasty|empire|kingdom|chola|pallava|chalukya|hoysala|gupta|maurya|mughal|vijayanagara|maratha|kalinga|ashoka|akbar|jahangir|shah jahan|aurangzeb|krishnadevaraya|shivaji|capital of|coronation|battle|siege|unesco|tomb of|mausoleum of|shrine|oldest|earliest|significant|heritage)\b/i;

function buildHistoricalSignificance(props, dateInfo, wikiResult = null, wdFacts = null) {
  const lines = [];
  const citations = [];
  const seenLines = new Set();
  const pushLine = (text) => {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seenLines.has(key)) return;
    seenLines.add(key);
    lines.push(clean);
  };

  // Structured patronage / builder facts from Wikidata claims
  const patron = wdFacts?.patron || wdFacts?.foundedBy || wdFacts?.creator || "";
  const architect = wdFacts?.architect || "";
  const periodTag = wdFacts?.timePeriod || props.period || "";
  if (patron || architect) {
    const parts = [];
    if (wdFacts?.patron) parts.push(`Commissioned by ${wdFacts.patron}`);
    else if (wdFacts?.foundedBy) parts.push(`Founded by ${wdFacts.foundedBy}`);
    else if (wdFacts?.creator) parts.push(`Created by ${wdFacts.creator}`);
    if (architect && architect !== patron) parts.push(`architect: ${architect}`);
    pushLine(`${parts.join(" · ")}.`);
    if (wdFacts?.qid) citations.push({ text: `Wikidata ${wdFacts.qid}`, url: `https://www.wikidata.org/wiki/${wdFacts.qid}` });
  } else if (periodTag && dateInfo?.yearNum !== null) {
    pushLine(`${periodTag} monument (${dateInfo.builtLabel}).`);
    if (wdFacts?.qid) citations.push({ text: `Wikidata ${wdFacts.qid}`, url: `https://www.wikidata.org/wiki/${wdFacts.qid}` });
  }

  // Salient historical context extracted strictly from verified Wikipedia article text
  if (wikiResult?.fullText) {
    const leadLow = String(wikiResult.text || "").toLowerCase();
    const sentences = wikiResult.fullText.match(/[^.!?]+[.!?]+/g) || [];
    const nonRepeating = sentences.filter((s) => {
      const clean = s.trim();
      if (clean.length < 28 || clean.length > 260) return false;
      if (!HISTORY_CUE_RE.test(clean)) return false;
      if (leadLow && leadLow.includes(clean.toLowerCase().slice(0, 60)) && lines.length > 0) return false;
      return true;
    });
    const picked = nonRepeating.slice(0, patron ? 1 : 2);
    for (const s of picked) pushLine(s);
    if (picked.length && wikiResult.url) {
      citations.push({ text: `Wikipedia (${wikiResult.title || "Article"})`, url: wikiResult.url });
    }
  }

  // Local curated ASI description / UNESCO milestone if not already covered by Wikipedia extract
  const rawDesc = String(props.desc || "").trim();
  if (!wikiResult?.fullText && rawDesc && rawDesc.length >= 24 && !/^state protected monument/i.test(rawDesc) && HISTORY_CUE_RE.test(rawDesc)) {
    pushLine(rawDesc.replace(/\.+$/, "") + ".");
    citations.push({ text: `ASI Record (${props.asiId || props.qid || "Register"})`, url: props.wikipedia || "" });
  }
  if (props.unesco) {
    pushLine(`Designated a UNESCO World Heritage Site${props.unescoYear ? ` in ${props.unescoYear}` : ""}.`);
    if (!citations.some((c) => /UNESCO/i.test(c.text))) {
      citations.push({ text: "UNESCO World Heritage List", url: props.wikipedia || "" });
    }
  }

  if (!lines.length) return null;
  if (!citations.length) {
    citations.push({ text: `ASI Registry (${props.asiId || props.qid || "National List"})`, url: props.wikipedia || (props.qid ? `https://www.wikidata.org/wiki/${props.qid}` : "") });
  }
  return { lines: lines.slice(0, 3), badge: periodTag || patron || "", citations };
}

function renderHistoricalSignificanceCard(sig) {
  if (!sig || !sig.lines?.length) return "";
  const primary = sig.citations.find((c) => c.url) || sig.citations[0];
  const labelText = sig.citations.map((c) => c.text).join(" · ");
  const extraLinks = sig.citations.filter((c) => c.url && c.url !== primary?.url);
  const extraHtml = extraLinks
    .map((c) => ` · <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.text)} ↗</a>`)
    .join("");
  return `
    <div class="history-sig-card">
      <div class="funding-health-head">
        <span class="funding-health-title">Historical Significance</span>
        ${sig.badge ? `<span class="history-sig-pill">${escapeHtml(sig.badge)}</span>` : ""}
      </div>
      <div class="history-sig-facts">
        ${sig.lines.map((l) => `<p class="history-sig-line">${escapeHtml(l)}</p>`).join("")}
      </div>
      <details class="cite-drop">
        <summary>Citation ▾</summary>
        <div class="cite-body">${escapeHtml(labelText)}${primary?.url ? ` — <a href="${escapeHtml(primary.url)}" target="_blank" rel="noopener">Open source ↗</a>` : ""}${extraHtml}</div>
      </details>
    </div>
  `;
}

function openMonumentDrawer(props, coords, initialTab = "overview") {
  state.lastDrawer = { kind: "monument", props, coords };
  const reports = state.reports[props.qid] || [];
  const isStateProtected = String(props.asiId || "").toUpperCase().startsWith("S-");
  const linkedPrashad = findLinkedPrashad(props);
  const dateInfo = extractConstructionInfo(props);
  const funding = getFundingHealth(props, linkedPrashad);
  const ticketInfo = getTicketPricingInfo(props);
  const gaps = getCoverageGaps(props, Boolean(props.image), dateInfo);
  const restInfo = getBaseRestorationInfo(props, linkedPrashad, reports);

  const badges = [];
  if (props.asiId) badges.push(`<span class="badge">${isStateProtected ? "State" : "ASI"} ${escapeHtml(props.asiId)}</span>`);
  else badges.push(`<span class="badge">National Importance</span>`);
  if (props.unesco) badges.push(`<span class="badge badge-unesco">UNESCO World Heritage · Inscribed ${escapeHtml(props.unescoYear || "Listed")}</span>`);
  if (props.revenueCr || props.footfallLakhs) badges.push(`<span class="badge badge-footfall">Ticketed</span>`);
  if (props.adoptPartner) badges.push(`<span class="badge badge-adopt">${escapeHtml(props.adoptProgram || "Adopt a Heritage")}</span>`);
  if (!props.image) badges.push(`<span class="badge badge-uncovered" id="coverage-badge"><span class="legend-excl" aria-hidden="true">!</span>Poorly Covered · No Photo</span>`);
  if (reports.length) badges.push(`<span class="badge badge-flagged">${reports.length} Flagged</span>`);

  const kickerParts = [];
  for (const part of [props.state, props.place, props.location]) {
    if (part && !kickerParts.some((k) => k.toLowerCase() === part.toLowerCase())) kickerParts.push(part);
  }

  const history5y = getFiveYearSeries(props);
  const annualVisitorsLakhs =
    props.footfallLakhs !== null && props.footfallLakhs !== undefined && props.footfallLakhs !== ""
      ? Number(props.footfallLakhs)
      : history5y?.visitorsLakhs?.slice().reverse().find((v) => v !== null && v !== undefined) ?? null;

  // Primary metrics (Built/Age, Ticket Revenue, Annual Visitors, Budgets)
  const kpis = [];
  kpis.push([
    "Built / Age",
    dateInfo.builtLabel,
    dateInfo.ageLabel,
  ]);
  if (props.revenueCr) {
    kpis.push(["Ticket Revenue", formatMoneyCr(props.revenueCr, true), props.ticketFy || "FY 2023–24"]);
  }
  if (annualVisitorsLakhs) {
    kpis.push([
      "Annual Visitors",
      `${annualVisitorsLakhs} Lakh`,
      `~${Math.round(annualVisitorsLakhs * 100000).toLocaleString()} / yr`,
    ]);
  }
  kpis.push([
    "Site Budget (Est.)",
    funding.siteBudgetText,
    funding.perSite !== null ? `${funding.tierLabel}` : funding.siteBudgetSub,
  ]);
  if (kpis.length < 3 && funding.expCr !== null) {
    kpis.push([
      "Circle Budget",
      funding.circleBudgetText,
      `${props.circleMonuments} sites in circle`,
    ]);
  }

  const displayKpis = kpis.slice(0, 4);
  const kpiHtml = `
    <div class="kpi-strip${displayKpis.length >= 4 ? " is-four" : ""}">
      ${displayKpis
        .map(
          ([label, val, sub]) => `
        <div class="kpi-card">
          <span class="kpi-label">${escapeHtml(label)}</span>
          <span class="kpi-val" ${label === "Built / Age" ? 'id="drawer-age-val"' : ""}>${escapeHtml(val)}</span>
          ${sub ? `<span class="kpi-sub" ${label === "Built / Age" ? 'id="drawer-age-sub"' : ""}>${escapeHtml(sub)}</span>` : ""}
        </div>
      `
        )
        .join("")}
    </div>
  `;

  const ticketHtml = ticketInfo
    ? `
      <div class="funding-health-card">
        <div class="funding-health-head">
          <span class="funding-health-title">Entry Ticket Prices</span>
          <span class="viz-sub">${escapeHtml(ticketInfo.tier)}</span>
        </div>
        <div class="budget-split-val" style="font-size:14px;">${escapeHtml(ticketInfo.entryStr)}</div>
        <div class="budget-split-sub">${escapeHtml(ticketInfo.extraStr)}${annualVisitorsLakhs ? ` · ${escapeHtml(annualVisitorsLakhs)}L (~${Math.round(annualVisitorsLakhs * 100000).toLocaleString()}) visitors/yr` : ""}</div>
        ${citeHtml("ASI official standard e-ticketing tariff schedule (asi.payumoney.com) & Ministry of Culture FY 2023–24 footfall compendium.")}
      </div>
    `
    : "";

  const coverageGapHtml = gaps.length
    ? `
      <div class="coverage-gaps-card" id="coverage-gaps-card">
        <div class="coverage-gaps-title">Why coverage is marked incomplete (${gaps.length} gap${gaps.length > 1 ? "s" : ""})</div>
        <div class="coverage-checklist">
          ${gaps
            .map(
              (g) => `
            <div class="coverage-check-item" data-gap="${escapeHtml(g.key)}">
              <span class="coverage-check-icon" aria-hidden="true">!</span>
              <span>${escapeHtml(g.label)}</span>
            </div>
          `
            )
            .join("")}
        </div>
        ${citeHtml("Audited live against Wikimedia Commons media, linked Wikipedia pages, and Wikidata/ASI date & architectural fields.")}
      </div>
    `
    : "";

  const metaRows = [];
  metaRows.push(["Protection", isStateProtected ? "State Protected Monument" : "ASI National Importance"]);
  if (props.unesco) metaRows.push(["UNESCO World Heritage", props.unescoYear ? `Inscribed ${props.unescoYear}` : "Listed Site"]);
  if (annualVisitorsLakhs) metaRows.push(["Annual Visitors", `${annualVisitorsLakhs} Lakh (~${Math.round(annualVisitorsLakhs * 100000).toLocaleString()} / yr)`]);
  metaRows.push(["Built / Historical Date", dateInfo.builtLabel]);
  metaRows.push(["Monument Age", dateInfo.ageLabel]);
  if (props.siteType) metaRows.push(["Category", props.siteType]);
  if (props.style) metaRows.push(["Architecture", props.style]);
  if (props.material) metaRows.push(["Material", props.material]);
  if (props.epigraphy) metaRows.push(["Epigraphy", "Recorded inscriptions"]);
  if (props.place) metaRows.push(["Town / Village", props.place]);
  if (props.location) metaRows.push(["District / Locality", props.location]);
  if (props.state) metaRows.push(["State / Territory", props.state]);
  if (props.circleName) metaRows.push(["ASI Circle", props.circleName]);

  const metaHtml = `
    <div class="meta-block">
      ${metaRows
        .map(
          ([k, v]) =>
            `<div class="meta-row"><span class="meta-label">${escapeHtml(k)}</span><span class="meta-val" ${k === "Built / Historical Date" ? 'id="meta-built-val"' : k === "Monument Age" ? 'id="meta-age-val"' : ""}>${escapeHtml(v)}</span></div>`
        )
        .join("")}
    </div>
    ${citeHtml(`ASI Monument List (${props.asiId || "National Register"})${props.qid ? ` · Wikidata ${props.qid}` : ""}.`, props.qid ? `https://www.wikidata.org/wiki/${props.qid}` : "")}
  `;

  // Benchmark marker position (0 to 30L+ scale, with national median ~10.6L)
  const benchDotPct = funding.perSite !== null ? Math.max(3, Math.min(97, (Math.min(funding.perSite, 30) / 30) * 100)) : null;
  const medianPct = ((10.6 / 30) * 100).toFixed(1);
  const benchColor = funding.tierKey === "tier-poor" ? "var(--c-underfunded)" : funding.tierKey === "tier-good" ? "var(--c-adopt)" : "#f59e0b";

  const restorationAndFundingHtml = `
    <div class="funding-health-card">
      <div class="funding-health-head">
        <span class="funding-health-title">Funding Health</span>
        <span class="funding-tier-badge ${funding.tierKey}">${escapeHtml(funding.tierLabel)}</span>
      </div>
      <div class="budget-split-grid">
        <div class="budget-split-box">
          <span class="budget-split-label">Site Estimate</span>
          <span class="budget-split-val">${escapeHtml(funding.siteBudgetText)}</span>
          <span class="budget-split-sub">${escapeHtml(funding.siteBudgetSub)}</span>
        </div>
        <div class="budget-split-box">
          <span class="budget-split-label">ASI Circle</span>
          <span class="budget-split-val">${escapeHtml(funding.circleBudgetText)}</span>
          <span class="budget-split-sub">${escapeHtml(funding.circleBudgetSub)}</span>
        </div>
      </div>
      ${
        benchDotPct !== null
          ? `
        <div class="bench-scale">
          <div class="bench-track" title="Circle spend: ${escapeHtml(formatMoneyLakh(funding.perSite, true))} vs ~${escapeHtml(formatMoneyLakh(10.6))} median">
            <span class="bench-median-tick" style="left:${medianPct}%" title="National Median (~₹10.6L / site)"></span>
            <span class="bench-site-dot" style="left:${benchDotPct.toFixed(1)}%; background:${benchColor}"></span>
          </div>
          <div class="bench-labels">
            <span>&lt;${escapeHtml(formatMoneyLakh(8.5))}</span>
            <span>~${escapeHtml(formatMoneyLakh(10.6))} median</span>
            <span>${escapeHtml(formatMoneyLakh(20))}+</span>
          </div>
        </div>
      `
          : ""
      }
      ${citeHtml("FY 2023–24 PIB circle budgets, Adopt a Heritage 2.0 & PRASHAD.")}
    </div>

    <div class="restoration-status-row">
      <div class="funding-health-head" style="margin-bottom:2px;">
        <span class="funding-health-title">Restoration Status</span>
        <span class="restoration-status-pill ${restInfo.statusClass}">${escapeHtml(restInfo.statusText)}</span>
      </div>
      <div class="budget-split-sub">${escapeHtml(restInfo.statusNote)}</div>
    </div>

    <div id="restoration-timeline-section">
      ${
        restInfo.events.length
          ? `
        <div class="viz-card">
          <div class="viz-head">
            <span class="viz-title">Restoration &amp; Conservation Timeline</span>
            <span class="viz-sub" id="restoration-count-sub">${restInfo.events.length} record${restInfo.events.length === 1 ? "" : "s"}</span>
          </div>
          <div id="restoration-timeline-mount">${renderTimelineItemsHtml(restInfo.events)}</div>
          ${citeHtml("Combined from ASI archive notes, Ministry of Tourism PRASHAD tracker, Adopt a Heritage records, Wikipedia conservation history, and local field logs.", props.wikipedia || "")}
        </div>`
          : ""
      }
    </div>
  `;

  const links = [];
  if (props.wikipedia) {
    links.push(`<a class="detail-link" href="${escapeHtml(props.wikipedia)}" target="_blank" rel="noopener">Wikipedia ↗</a>`);
  }
  if (props.qid) {
    links.push(`<a class="detail-link" href="https://www.wikidata.org/wiki/${escapeHtml(props.qid)}" target="_blank" rel="noopener">Wikidata ↗</a>`);
  }
  links.push(
    `<a class="detail-link" href="https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(
      `${props.name} ${props.state || ""}`.trim()
    )}" target="_blank" rel="noopener">Commons ↗</a>`
  );

  const issueOptions = [
    "Structural Decay / Cracks",
    "Encroachment / Buffer Risk",
    "Missing Signage / Lighting",
    "Sanitation / Visitor Amenities",
    "Restoration Verified",
  ];

  const existingReportsHtml = reports
    .map(
      (r) =>
        `<div class="report-item"><b>${escapeHtml(r.category)}</b> · ${escapeHtml(r.date)}${r.note ? `<br/>${escapeHtml(r.note)}` : ""}</div>`
    )
    .join("");

  const fallbackSummary = buildFallbackTwoSentenceSummary(props);

  elDetailContent.innerHTML = `
    <div id="carousel-mount"></div>
    <div class="v-head-grid">
      <div>
        <h2 class="detail-title">${escapeHtml(props.name)}</h2>
        ${kickerParts.length ? `<div class="detail-kicker">${escapeHtml(kickerParts.slice(0, 3).join(" · "))}</div>` : ""}
      </div>
    </div>

    <div class="drawer-subbar">
      <div class="detail-badges" style="margin:0;">${badges.slice(0, 5).join("")}</div>
      ${renderCurrencySwitchHtml()}
    </div>

    <p class="detail-desc" id="drawer-summary">${escapeHtml(fallbackSummary)}</p>
    ${citeHtml("Synthesized from ASI monument registry and linked Wikipedia lead summary.", props.wikipedia || "")}
    <div style="margin-bottom:14px;"></div>

    ${kpiHtml}
    ${ticketHtml}
    <div id="historical-significance-section">${renderHistoricalSignificanceCard(buildHistoricalSignificance(props, dateInfo))}</div>
    ${restorationAndFundingHtml}
    ${metaHtml}
    ${coverageGapHtml}
    ${links.length ? `<div class="detail-links" id="detail-links">${links.join("")}</div>` : ""}
    <details class="report-box" ${reports.length ? "open" : ""}>
      <summary>
        <span>Flag maintenance or conservation issue${reports.length ? ` (${reports.length})` : ""}</span>
        <span class="report-chevron">▾</span>
      </summary>
      <form id="report-form">
        <input type="hidden" id="report-category" value="${escapeHtml(issueOptions[0])}" />
        <div class="issue-chips" id="issue-chips" role="radiogroup" aria-label="Issue category">
          ${issueOptions
            .map(
              (opt, i) =>
                `<button type="button" class="issue-chip ${i === 0 ? "active" : ""}" data-cat="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`
            )
            .join("")}
        </div>
        <textarea id="report-note" rows="2" placeholder="Describe the issue or verify conservation work (saved locally)…"></textarea>
        <div class="report-actions">
          <button type="submit" class="btn-primary">Submit Flag</button>
          <button type="button" class="btn-secondary" id="export-reports-btn">Export JSON</button>
        </div>
      </form>
      <div id="existing-reports">${existingReportsHtml}</div>
    </details>
  `;

  bindDrawerCurrencySwitch();

  const hiddenCat = document.getElementById("report-category");
  elDetailContent.querySelectorAll(".issue-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      elDetailContent.querySelectorAll(".issue-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      if (hiddenCat) hiddenCat.value = chip.dataset.cat;
    });
  });

  hydrateDrawerCarousel("carousel-mount", props, coords);

  const activeKey = props.qid || props.name;
  Promise.all([fetchWikiTwoSentences(props), fetchWikidataHistoryFacts(props.qid)]).then(([wikiResult, wdFacts]) => {
    if (elDrawer.dataset.activeKey !== activeKey) return;

    const sigEl = document.getElementById("historical-significance-section");
    if (sigEl) {
      const sig = buildHistoricalSignificance(props, dateInfo, wikiResult, wdFacts);
      sigEl.innerHTML = renderHistoricalSignificanceCard(sig);
    }

    if (!wikiResult) return;
    const sumEl = document.getElementById("drawer-summary");
    if (sumEl && wikiResult.text) sumEl.textContent = wikiResult.text;
    if (!props.wikipedia && wikiResult.url) {
      const linksEl = document.getElementById("detail-links");
      if (linksEl && !linksEl.querySelector('a[href*="en.wikipedia.org"]')) {
        const a = document.createElement("a");
        a.className = "detail-link";
        a.href = wikiResult.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = `Wikipedia (${wikiResult.title}) ↗`;
        linksEl.prepend(a);
      }
      const wikiGap = document.querySelector('[data-gap="wiki"] span:last-child');
      if (wikiGap) wikiGap.textContent = "Mentioned on related Wikipedia article (no standalone page)";
    }

    // Backfill age/date from Wikipedia text if monument lacked props.year
    if (dateInfo.yearNum === null && wikiResult.fullText) {
      const wikiDate = extractConstructionInfo(props, wikiResult.fullText);
      if (wikiDate.yearNum !== null) {
        const ageVal = document.getElementById("drawer-age-val");
        const ageSub = document.getElementById("drawer-age-sub");
        const metaBuilt = document.getElementById("meta-built-val");
        const metaAge = document.getElementById("meta-age-val");
        if (ageVal) ageVal.textContent = wikiDate.builtLabel;
        if (ageSub) ageSub.textContent = wikiDate.ageLabel;
        if (metaBuilt) metaBuilt.textContent = wikiDate.builtLabel;
        if (metaAge) metaAge.textContent = wikiDate.ageLabel;
      }
    }

    // Extract dated restoration / conservation history from Wikipedia article (shown only if dates exist)
    if (wikiResult.fullText) {
      const wikiRest = extractRestorationEvents(wikiResult.fullText, `Wikipedia · ${wikiResult.title}`);
      if (wikiRest.length) {
        const merged = [...restInfo.events];
        for (const wr of wikiRest) {
          if (!merged.some((m) => m.text === wr.text)) merged.push(wr);
        }
        merged.sort((a, b) => a.year - b.year);
        const secEl = document.getElementById("restoration-timeline-section");
        if (secEl) {
          secEl.innerHTML = `
            <div class="viz-card">
              <div class="viz-head">
                <span class="viz-title">Restoration &amp; Conservation Timeline</span>
                <span class="viz-sub" id="restoration-count-sub">${merged.length} record${merged.length === 1 ? "" : "s"}</span>
              </div>
              <div id="restoration-timeline-mount">${renderTimelineItemsHtml(merged)}</div>
              ${citeHtml("Combined from ASI archive notes, Ministry of Tourism PRASHAD tracker, Adopt a Heritage records, Wikipedia conservation history, and local field logs.", wikiResult.url || props.wikipedia || "")}
            </div>`;
        }
      }
    }
  });

  document.getElementById("report-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const category = document.getElementById("report-category").value;
    const note = document.getElementById("report-note").value.trim();
    const list = state.reports[props.qid] || [];
    list.unshift({
      qid: props.qid,
      name: props.name,
      category,
      note,
      date: new Date().toISOString().slice(0, 10),
    });
    state.reports[props.qid] = list;
    saveReports();
    prepareMonumentCache();
    applyFilters();
    openMonumentDrawer(props, coords);
  });

  document.getElementById("export-reports-btn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state.reports, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "monument-map-site-reports.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  mountDrawerNearbyNav(props, coords);
  showDetailDrawer(coords);
}

function buildNearbyNav(coords, currentQid) {
  if (!coords || !state.monuments) return null;
  const visible = (getFilteredMonuments() && getFilteredMonuments().features) || [];
  const [lng0, lat0] = coords;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);
  const scored = [];
  for (const f of visible) {
    const [lng, lat] = f.geometry.coordinates;
    const dx = (lng - lng0) * cosLat * 111.32;
    const dy = (lat - lat0) * 110.57;
    const distKm = Math.hypot(dx, dy);
    if (distKm <= 35) scored.push({ feat: f, distKm });
  }
  scored.sort((a, b) => {
    if (a.feat.properties.qid === currentQid) return -1;
    if (b.feat.properties.qid === currentQid) return 1;
    return a.distKm - b.distKm;
  });
  const list = scored.slice(0, 12).map((x) => x.feat);
  return list.length > 1 ? { list, index: 0 } : null;
}

function renderNearbyNavSlot() {
  const slot = document.getElementById("drawer-nearby-slot");
  if (slot) slot.innerHTML = "";
}

function mountDrawerNearbyNav(props, coords) {
  const nav = state.nearbyNav;
  const curIdx = nav && nav.list ? nav.list.findIndex((f) => f.properties.qid === props.qid) : -1;
  if (curIdx >= 0) {
    nav.index = curIdx;
  } else {
    state.nearbyNav = buildNearbyNav(coords, props.qid);
  }
  renderNearbyNavSlot();
}

function navigateNearby(delta) {
  const nav = state.nearbyNav;
  if (!nav || !nav.list.length) return;
  nav.index = (nav.index + delta + nav.list.length) % nav.list.length;
  const target = nav.list[nav.index];
  if (!target) return;
  const tc = target.geometry.coordinates;
  if (elDetailContent) elDetailContent.scrollTop = 0;
  openMonumentDrawer(target.properties, tc);
}

function openPrashadDrawer(props, coords) {
  state.nearbyNav = null;
  renderNearbyNavSlot(null);
  state.lastDrawer = { kind: "prashad", props, coords };
  const released =
    props.releasedCr !== null && props.releasedCr !== undefined && props.releasedCr !== ""
      ? formatMoneyCr(props.releasedCr, true)
      : "Ongoing";

  const pct =
    props.releasedCr && props.approvedCr
      ? Math.min(100, Math.round((Number(props.releasedCr) / Number(props.approvedCr)) * 100))
      : 45;

  elDetailContent.innerHTML = `
    <div id="carousel-mount"></div>
    <div class="v-head-grid">
      <div>
        <h2 class="detail-title">${escapeHtml(props.name)}</h2>
        <div class="detail-kicker">${escapeHtml(props.state)} · Sanctioned ${escapeHtml(props.year)}</div>
      </div>
    </div>
    <div class="drawer-subbar">
      <div class="detail-badges" style="margin:0;">
        <span class="badge badge-prashad">PRASHAD · Ministry of Tourism</span>
        <span class="badge">${escapeHtml(props.progress)}</span>
      </div>
      ${renderCurrencySwitchHtml()}
    </div>
    <p class="detail-desc" id="drawer-summary">${escapeHtml(props.name)} is a central heritage &amp; pilgrimage conservation infrastructure project in ${escapeHtml(props.state)} sanctioned under PRASHAD (${escapeHtml(props.year)}). Work status is reported as ${escapeHtml(props.progress)}.</p>
    <div class="kpi-strip">
      <div class="kpi-card">
        <span class="kpi-label">Approved Grant</span>
        <span class="kpi-val">${escapeHtml(formatMoneyCr(props.approvedCr, true))}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Funds Released</span>
        <span class="kpi-val">${escapeHtml(released)}</span>
        <div class="budget-meter-bar"><div class="budget-meter-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Restoration Status</span>
        <span class="kpi-val">${escapeHtml(props.progress)}</span>
      </div>
    </div>
    ${citeHtml("Ministry of Tourism PRASHAD Scheme (Pilgrimage Rejuvenation and Spiritual, Heritage Augmentation Drive) project status data.", props.wikipedia || "")}
    ${props.wikipedia ? `<div class="detail-links"><a class="detail-link" href="${escapeHtml(props.wikipedia)}" target="_blank" rel="noopener">Wikipedia ↗</a></div>` : ""}
  `;
  bindDrawerCurrencySwitch();
  hydrateDrawerCarousel("carousel-mount", props, coords);
  const activeKey = props.qid || props.name;
  fetchWikiTwoSentences(props).then((wikiResult) => {
    if (!wikiResult || elDrawer.dataset.activeKey !== activeKey) return;
    const sumEl = document.getElementById("drawer-summary");
    if (sumEl && wikiResult.text) sumEl.textContent = wikiResult.text;
  });
  showDetailDrawer(coords);
}

function simplifyMultiPolygon(feature, maxPtsPerRing = 90) {
  if (!feature || !feature.geometry) return feature;
  const resampleRing = (ring) => {
    if (ring.length <= maxPtsPerRing) return ring;
    const step = Math.ceil(ring.length / maxPtsPerRing);
    const out = [];
    for (let i = 0; i < ring.length - 1; i += step) out.push(ring[i]);
    out.push(ring[0]);
    return out;
  };
  const g = feature.geometry;
  if (g.type === "Polygon") {
    return { ...feature, geometry: { type: "Polygon", coordinates: g.coordinates.map(resampleRing) } };
  }
  if (g.type === "MultiPolygon") {
    // Keep only main landmasses (> 8 vertices) to make MapLibre point-in-poly super fast
    const polys = g.coordinates
      .filter((p) => p[0] && p[0].length > 8)
      .map((p) => [resampleRing(p[0])]);
    return { ...feature, geometry: { type: "MultiPolygon", coordinates: polys } };
  }
  return feature;
}

function attachOverlayLayers() {
  registerLightPatterns();

  // Apple Maps crisp world ocean water & international boundaries underneath outer veil
  map.addLayer({
    id: "plate-world-water",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "water",
    paint: {
      "fill-color": "#9ad0f5",
      "fill-opacity": 0.96,
    },
  });

  map.addLayer({
    id: "plate-world-waterway",
    type: "line",
    source: "openmaptiles",
    "source-layer": "waterway",
    minzoom: 7.5,
    paint: {
      "line-color": "#7bc0f2",
      "line-width": ["interpolate", ["linear"], ["zoom"], 7.5, 0.8, 12, 2.2],
    },
  });

  map.addLayer({
    id: "plate-world-borders",
    type: "line",
    source: "openmaptiles",
    "source-layer": "boundary",
    filter: ["<=", ["get", "admin_level"], 2],
    paint: {
      "line-color": "#7d848a",
      "line-width": 0.85,
      "line-opacity": 0.78,
    },
  });

  // High-contrast Apple Maps alabaster landmass inside India
  map.addSource("india-border", { type: "geojson", data: state.border });
  map.addLayer({
    id: "india-land-fill",
    type: "fill",
    source: "india-border",
    paint: {
      "fill-color": "#f2f1ec",
      "fill-opacity": 1,
    },
  });

  // Crisp Apple Maps sage parks & green reserves on zoom-in
  map.addLayer({
    id: "plate-osm-parks",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "park",
    minzoom: 8.5,
    paint: {
      "fill-color": "#c7e4c0",
      "fill-opacity": 0.92,
    },
  });

  map.addLayer({
    id: "plate-osm-landcover",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "landcover",
    filter: ["in", ["get", "class"], ["literal", ["wood", "forest", "grass", "wetland"]]],
    minzoom: 9.0,
    paint: {
      "fill-color": "#d5ebd0",
      "fill-opacity": 0.75,
    },
  });

  map.addLayer({
    id: "plate-osm-buildings",
    type: "fill",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 12.6,
    paint: {
      "fill-color": "#e0ded6",
      "fill-outline-color": "#c2c0b7",
      "fill-opacity": 0.92,
    },
  });

  // Apple Maps crisp street casings + white road ribbons
  map.addLayer({
    id: "plate-osm-streets-casing",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 8.8,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#c8c6be",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8.8, 1.3,
        12, 2.8,
        15, 5.8,
      ],
    },
  });

  map.addLayer({
    id: "plate-osm-streets",
    type: "line",
    source: "openmaptiles",
    "source-layer": "transportation",
    minzoom: 8.8,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        8.8, 0.75,
        12, 1.7,
        15, 4.0,
      ],
    },
  });

  // High-contrast internal state lines
  if (state.states) {
    map.addSource("india-states", { type: "geojson", data: state.states });
    map.addLayer({
      id: "india-states-line",
      type: "line",
      source: "india-states",
      paint: {
        "line-color": "#9ca3aa",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 0.85, 9, 1.35],
        "line-opacity": 0.82,
      },
    });
  }

  // Vivid Apple Maps blue hydrography & lakes
  if (state.lakes) {
    map.addSource("india-lakes", { type: "geojson", data: state.lakes });
    map.addLayer({
      id: "india-lakes-fill",
      type: "fill",
      source: "india-lakes",
      paint: { "fill-color": "#8cc8f5", "fill-opacity": 0.96 },
    });
    map.addLayer({
      id: "india-lakes-outline",
      type: "line",
      source: "india-lakes",
      paint: { "line-color": "#4490d6", "line-width": 0.9, "line-opacity": 0.85 },
    });
  }

  if (state.rivers) {
    map.addSource("india-rivers", { type: "geojson", data: state.rivers });
    map.addLayer({
      id: "india-rivers-minor",
      type: "line",
      source: "india-rivers",
      filter: [">", ["get", "scalerank"], 4],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#60a8eb",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 0.9, 8, 1.6, 12, 2.3],
        "line-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "india-rivers-major",
      type: "line",
      source: "india-rivers",
      filter: ["<=", ["get", "scalerank"], 4],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#3080cf",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 1.5, 8, 2.5, 12, 3.3],
        "line-opacity": 0.95,
      },
    });

    map.addLayer({
      id: "india-rivers-labels",
      type: "symbol",
      source: "india-rivers",
      filter: ["<=", ["get", "scalerank"], 5],
      minzoom: 5.2,
      layout: {
        "symbol-placement": "line",
        "text-field": ["concat", "RIVER ", ["upcase", ["get", "name"]]],
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 5.2, 8.8, 9, 10.8],
        "text-letter-spacing": 0.14,
        "symbol-spacing": 380,
      },
      paint: {
        "text-color": "#1a5ba0",
        "text-halo-color": "rgba(255, 255, 255, 0.94)",
        "text-halo-width": 1.6,
      },
    });
  }

  // Contested regions (subtle hatch + dashed hairline boundary)
  map.addSource("contested-regions", { type: "geojson", data: state.contested });
  map.addLayer({
    id: "contested-fill",
    type: "fill",
    source: "contested-regions",
    layout: { visibility: state.showContested ? "visible" : "none" },
    paint: {
      "fill-pattern": "contested-hatch",
      "fill-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "contested-line",
    type: "line",
    source: "contested-regions",
    layout: { visibility: state.showContested ? "visible" : "none" },
    paint: {
      "line-color": "#4a5056",
      "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 1.0, 8, 1.5],
      "line-dasharray": [4, 2.5],
      "line-opacity": 0.85,
    },
  });

  // Gentle Apple-toned veil outside India borders so neighboring countries & world stay clearly visible but softly faded
  if (state.mask) {
    map.addSource("india-mask", { type: "geojson", data: state.mask });
    map.addLayer({
      id: "india-outer-veil",
      type: "fill",
      source: "india-mask",
      paint: {
        "fill-color": "#f2f1ec",
        "fill-opacity": 0.44,
      },
    });
  }

  // Crisp Survey of India outer hairline
  map.addLayer({
    id: "india-outline",
    type: "line",
    source: "india-border",
    paint: {
      "line-color": "#52585e",
      "line-width": ["interpolate", ["linear"], ["zoom"], 3.5, 1.15, 8, 1.7],
      "line-opacity": 0.95,
    },
  });

  // High-contrast Ocean, Sea & Country Context Labels
  const geoLabels = buildOceanAndCountryLabels();
  map.addSource("geo-water-labels", { type: "geojson", data: geoLabels.waters });
  map.addLayer({
    id: "water-labels-layer",
    type: "symbol",
    source: "geo-water-labels",
    filter: ["any", ["==", ["get", "rank"], 1], [">=", ["zoom"], 4.4]],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Italic"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3.2, 9.8, 6, 12.2],
      "text-letter-spacing": 0.24,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#1c5a91",
      "text-halo-color": "rgba(255, 255, 255, 0.78)",
      "text-halo-width": 1.4,
    },
  });

  map.addSource("geo-country-labels", { type: "geojson", data: geoLabels.countries });
  map.addLayer({
    id: "country-labels-layer",
    type: "symbol",
    source: "geo-country-labels",
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3.2, 9.2, 6, 11.4],
      "text-letter-spacing": 0.16,
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#4f555c",
      "text-halo-color": "rgba(255, 255, 255, 0.88)",
      "text-halo-width": 1.4,
    },
  });

  // Indian City, Town & Locality Labels ABOVE outer veil using simplified ["within", coarseIndia] so coastal names never clip & zoom stays fast
  const indiaPoly = state.border.features && state.border.features[0];
  const coarseIndiaPoly = indiaPoly ? simplifyMultiPolygon(indiaPoly, 90) : null;
  const insideIndiaFilter = coarseIndiaPoly ? ["within", coarseIndiaPoly] : true;

  // Adaptive zoom-gated Indian City, Town & Locality Labels (uncrowded national view -> progressive detail on zoom)
  map.addLayer({
    id: "city-dots-tier1",
    type: "circle",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["all", ["==", ["get", "class"], "city"], ["<=", ["coalesce", ["get", "rank"], 99], 4], insideIndiaFilter],
    minzoom: 3.6,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3.6, 1.8, 9, 2.8],
      "circle-color": "#18191a",
      "circle-stroke-width": 0,
    },
  });

  map.addLayer({
    id: "city-labels-tier1",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["all", ["==", ["get", "class"], "city"], ["<=", ["coalesce", ["get", "rank"], 99], 4], insideIndiaFilter],
    minzoom: 3.6,
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3.6, 10.2, 8, 13.0, 12, 14.5],
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.5,
      "text-padding": 22,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    paint: {
      "text-color": "#111315",
      "text-halo-color": "rgba(255, 255, 255, 0.96)",
      "text-halo-width": 1.8,
    },
  });

  map.addLayer({
    id: "city-dots-major",
    type: "circle",
    source: "openmaptiles",
    "source-layer": "place",
    filter: [
      "all",
      ["==", ["get", "class"], "city"],
      [">", ["coalesce", ["get", "rank"], 99], 4],
      ["<=", ["coalesce", ["get", "rank"], 99], 8],
      insideIndiaFilter,
    ],
    minzoom: 5.8,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5.8, 1.6, 10, 2.5],
      "circle-color": "#18191a",
      "circle-stroke-width": 0,
    },
  });

  map.addLayer({
    id: "city-labels-major",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: [
      "all",
      ["==", ["get", "class"], "city"],
      [">", ["coalesce", ["get", "rank"], 99], 4],
      ["<=", ["coalesce", ["get", "rank"], 99], 8],
      insideIndiaFilter,
    ],
    minzoom: 5.8,
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 5.8, 10.0, 9, 12.2, 12, 13.5],
      "text-variable-anchor": ["left", "right", "top", "bottom"],
      "text-radial-offset": 0.45,
      "text-padding": 16,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 10],
    },
    paint: {
      "text-color": "#111315",
      "text-halo-color": "rgba(255, 255, 255, 0.96)",
      "text-halo-width": 1.8,
    },
  });

  map.addLayer({
    id: "city-labels-regional",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["all", ["==", ["get", "class"], "city"], [">", ["coalesce", ["get", "rank"], 99], 8], insideIndiaFilter],
    minzoom: 7.5,
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 7.5, 9.8, 11, 12.0],
      "text-padding": 14,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 15],
    },
    paint: {
      "text-color": "#26292d",
      "text-halo-color": "rgba(255, 255, 255, 0.95)",
      "text-halo-width": 1.6,
    },
  });

  map.addLayer({
    id: "city-labels-towns",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["all", ["==", ["get", "class"], "town"], insideIndiaFilter],
    minzoom: 8.8,
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 8.8, 9.2, 13, 12.0],
      "text-padding": 12,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 20],
    },
    paint: {
      "text-color": "#2f3337",
      "text-halo-color": "rgba(255, 255, 255, 0.94)",
      "text-halo-width": 1.6,
    },
  });

  map.addLayer({
    id: "city-labels-localities",
    type: "symbol",
    source: "openmaptiles",
    "source-layer": "place",
    filter: ["all", ["in", ["get", "class"], ["literal", ["village", "suburb", "quarter", "neighbourhood", "hamlet"]]], insideIndiaFilter],
    minzoom: 11.4,
    layout: {
      "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
      "text-font": ["Noto Sans Italic"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11.4, 9.2, 14, 11.2],
      "text-padding": 10,
    },
    paint: {
      "text-color": "#636669",
      "text-halo-color": "rgba(244, 243, 239, 0.9)",
      "text-halo-width": 1.3,
    },
  });

  // Color-coded Semantic Monument Dots (UNESCO Amber, Ticketed Teal, Adopt Emerald, Underfunded Terracotta, ASI Slate)
  map.addSource("monuments", { type: "geojson", data: state.filteredMonuments });
  map.addLayer({
    id: "monuments-dots",
    type: "circle",
    source: "monuments",
    layout: {
      "circle-sort-key": [
        "case",
        ["boolean", ["get", "flagged"], false], 6,
        ["!=", ["get", "unesco"], ""], 5,
        [">", ["coalesce", ["get", "revenueCr"], 0], 0], 4,
        ["!=", ["get", "adoptPartner"], ""], 3,
        ["boolean", ["get", "underfundedCircle"], false], 2,
        1,
      ],
    },
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3.5,
        [
          "case",
          ["boolean", ["get", "flagged"], false], 4.6,
          ["!=", ["get", "unesco"], ""], 4.8,
          [">", ["coalesce", ["get", "revenueCr"], 0], 0], 4.0,
          ["!=", ["get", "adoptPartner"], ""], 3.6,
          ["boolean", ["get", "underfundedCircle"], false], 2.7,
          2.4,
        ],
        9,
        [
          "case",
          ["boolean", ["get", "flagged"], false], 6.6,
          ["!=", ["get", "unesco"], ""], 7.0,
          [">", ["coalesce", ["get", "revenueCr"], 0], 0], 6.0,
          ["!=", ["get", "adoptPartner"], ""], 5.4,
          ["boolean", ["get", "underfundedCircle"], false], 4.4,
          4.0,
        ],
        15,
        [
          "case",
          ["!=", ["get", "unesco"], ""], 8.8,
          [">", ["coalesce", ["get", "revenueCr"], 0], 0], 7.6,
          6.4,
        ],
      ],
      "circle-color": [
        "case",
        ["boolean", ["get", "flagged"], false], SITE_COLORS.flagged,
        ["!=", ["get", "unesco"], ""], SITE_COLORS.unesco,
        [">", ["coalesce", ["get", "revenueCr"], 0], 0], SITE_COLORS.footfall,
        ["!=", ["get", "adoptPartner"], ""], SITE_COLORS.adopt,
        ["boolean", ["get", "underfundedCircle"], false], SITE_COLORS.underfunded,
        SITE_COLORS.asi,
      ],
      "circle-opacity": [
        "case",
        ["boolean", ["get", "flagged"], false], 0.96,
        ["!=", ["get", "unesco"], ""], 0.95,
        [">", ["coalesce", ["get", "revenueCr"], 0], 0], 0.92,
        ["!=", ["get", "adoptPartner"], ""], 0.9,
        ["boolean", ["get", "underfundedCircle"], false], 0.88,
        0.78,
      ],
      "circle-stroke-width": 0,
    },
  });

  // Exclamation indicator icon for poorly covered sites without photographs
  if (typeof document !== "undefined" && map.addImage && !map.hasImage?.("uncovered-excl")) {
    try {
      const sz = 28;
      const cv = document.createElement("canvas");
      cv.width = sz;
      cv.height = sz;
      const g = cv.getContext?.("2d");
      if (g) {
        g.beginPath();
        g.arc(sz / 2, sz / 2, 10, 0, Math.PI * 2);
        g.fillStyle = "#ffffff";
        g.fill();
        g.lineWidth = 2.4;
        g.strokeStyle = "#64748b";
        g.stroke();
        g.fillStyle = "#475569";
        g.font = "800 15px -apple-system, BlinkMacSystemFont, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText("!", sz / 2, sz / 2 + 0.6);
        map.addImage("uncovered-excl", g.getImageData(0, 0, sz, sz), { pixelRatio: 2 });
      }
    } catch {}
  }

  map.addLayer({
    id: "monuments-uncovered-excl",
    type: "symbol",
    source: "monuments",
    minzoom: 5.5,
    filter: ["==", ["coalesce", ["get", "image"], ""], ""],
    layout: {
      "icon-image": "uncovered-excl",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 3.5, 0.72, 9, 0.92, 14, 1.08],
      "icon-allow-overlap": false,
      "icon-ignore-placement": false,
    },
  });

  // PRASHAD sanctuary dots
  map.addSource("prashad", { type: "geojson", data: state.filteredPrashad });
  map.addLayer({
    id: "prashad-dots",
    type: "circle",
    source: "prashad",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3.5, 3.6, 10, 6.0],
      "circle-color": SITE_COLORS.prashad,
      "circle-opacity": 0.94,
      "circle-stroke-width": 0,
    },
  });

  // Subtle magnetic hover-snap ring
  map.addSource("hovered-site", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "hovered-site-halo",
    type: "circle",
    source: "hovered-site",
    paint: {
      "circle-radius": 11,
      "circle-color": "rgba(15, 23, 42, 0.08)",
      "circle-stroke-width": 1.75,
      "circle-stroke-color": "#007aff",
    },
  });

  // Active selected site halo & focal dot so selected monuments remain distinct on mobile & desktop
  map.addSource("selected-site", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "selected-site-halo",
    type: "circle",
    source: "selected-site",
    paint: {
      "circle-radius": 13,
      "circle-color": "rgba(0, 122, 255, 0.22)",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  map.addLayer({
    id: "selected-site-core",
    type: "circle",
    source: "selected-site",
    paint: {
      "circle-radius": 5.5,
      "circle-color": SITE_COLORS.footfall,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  applyFilters();
}

function bindMapInteractions() {
  let snappedHit = null;

  const findSnapFeature = (point) => {
    const pad = window.innerWidth <= 768 ? 18 : 14;
    const bbox = [
      [point.x - pad, point.y - pad],
      [point.x + pad, point.y + pad],
    ];
    const candidates = map.queryRenderedFeatures(bbox, {
      layers: ["prashad-dots", "monuments-uncovered-excl", "monuments-dots"],
    });
    if (!candidates.length) return null;

    let best = null;
    let bestDist = Infinity;
    for (const feat of candidates) {
      const coords = feat.geometry?.coordinates;
      if (!coords) continue;
      const proj = map.project(coords);
      const dx = proj.x - point.x;
      const dy = proj.y - point.y;
      // Prefer slightly higher importance when pins nearly overlap, otherwise pick closest pixel center
      const d = Math.hypot(dx, dy) - (feat.layer?.id === "prashad-dots" ? 1 : 0);
      if (d < bestDist) {
        bestDist = d;
        best = { feat, coords, proj };
      }
    }
    return best;
  };

  const setHoveredCoords = (coords) => {
    const src = map.getSource("hovered-site");
    if (!src) return;
    src.setData(
      coords
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: coords }, properties: {} }] }
        : { type: "FeatureCollection", features: [] }
    );
  };

  const renderSnappedTooltip = (hit) => {
    const { feat, proj } = hit;
    const p = feat.properties;
    const imgHtml = p.image
      ? `<img class="tooltip-img" src="${escapeHtml(pinThumbUrl(p.image))}" alt="" onerror="this.style.display='none'" />`
      : "";
    if (feat.layer?.id === "prashad-dots") {
      showTooltip(
        proj,
        `${imgHtml}<div class="tooltip-title">${escapeHtml(p.name)}</div><div class="tooltip-meta">PRASHAD · ₹${escapeHtml(p.approvedCr)} Cr (${escapeHtml(p.progress)})</div>`
      );
      return;
    }
    const parts = [p.state];
    if (p.asiId) parts.push(p.asiId);
    if (p.revenueCr) parts.push(`₹${p.revenueCr} Cr`);
    else if (p.unesco) parts.push("UNESCO");
    else if (p.adoptPartner) parts.push("Adopt a Heritage");

    showTooltip(
      proj,
      `${imgHtml}<div class="tooltip-title">${escapeHtml(p.name)}</div><div class="tooltip-meta">${escapeHtml(parts.filter(Boolean).join(" · "))}</div>`
    );
  };

  const hideTooltip = () => {
    snappedHit = null;
    map.getCanvas().style.cursor = "";
    setHoveredCoords(null);
    elTooltip.classList.add("hidden");
  };

  map.on("mousemove", (e) => {
    const hit = findSnapFeature(e.point);
    if (hit) {
      snappedHit = hit;
      map.getCanvas().style.cursor = "pointer";
      setHoveredCoords(hit.coords);
      renderSnappedTooltip(hit);
      return;
    }
    if (snappedHit) {
      snappedHit = null;
      setHoveredCoords(null);
    }
    const contested = map.queryRenderedFeatures(e.point, { layers: ["contested-fill"] });
    if (contested.length && contested[0].properties.name) {
      map.getCanvas().style.cursor = "help";
      showTooltip(
        e.point,
        `<div class="tooltip-title">${escapeHtml(contested[0].properties.name)}</div><div class="tooltip-meta">${escapeHtml(contested[0].properties.status || "")}</div>`
      );
      return;
    }
    hideTooltip();
  });

  map.getCanvas().addEventListener("mouseleave", hideTooltip);

  map.on("click", (e) => {
    const hit = findSnapFeature(e.point);
    if (!hit) return;
    if (hit.feat.layer?.id === "prashad-dots") {
      openPrashadDrawer(hit.feat.properties, hit.coords);
    } else {
      openMonumentDrawer(hit.feat.properties, hit.coords);
    }
  });

  map.on("moveend", schedulePhotoPins);
  map.on("zoomend", schedulePhotoPins);
}

map.on("load", async () => {
  const [border, mask, states, rivers, lakes, contested, monuments, prashad, circles] =
    await preloadDataPromise;

  state.border = border;
  state.mask = mask;
  state.states = states;
  state.rivers = rivers;
  state.lakes = lakes;
  state.contested = contested;
  state.monuments = monuments;
  state.prashad = prashad;
  state.circles = circles;

  prepareMonumentCache();
  renderBudgetPanel();

  const statesSet = new Set();
  for (const f of state.monuments.features) {
    if (f.properties.state) statesSet.add(f.properties.state);
  }
  for (const st of Array.from(statesSet).sort((a, b) => a.localeCompare(b))) {
    const opt = document.createElement("option");
    opt.value = st;
    opt.textContent = st;
    elStateSelect.appendChild(opt);
  }

  const leftPanel = document.getElementById("left-panel");
  const reopenBtn = document.getElementById("reopen-sidebar-btn");
  const collapseBtn = document.getElementById("collapse-sidebar-btn");
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    leftPanel.classList.add("collapsed");
    reopenBtn.classList.remove("hidden");
  }

  collapseBtn.addEventListener("click", () => {
    leftPanel.classList.add("collapsed");
    reopenBtn.classList.remove("hidden");
    schedulePhotoPins();
  });

  reopenBtn.addEventListener("click", () => {
    if (window.innerWidth <= 768 && !elDrawer.classList.contains("hidden")) {
      closeDetailDrawer();
    }
    leftPanel.classList.remove("collapsed");
    reopenBtn.classList.add("hidden");
    schedulePhotoPins();
  });

  attachOverlayLayers();
  bindMapInteractions();
  fitIndiaCentered(false);
});

function setActiveFilter(filterKey) {
  state.activeFilter = filterKey;
  document.querySelectorAll(".legend-btn").forEach((b) => {
    const isActive = b.dataset.legendFilter === filterKey;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-pressed", String(isActive));
  });
  applyFilters();
}

// Interactive Legend Filtering (toggle active pill on/off)
document.querySelectorAll(".legend-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.legendFilter;
    setActiveFilter(state.activeFilter === target && target !== "all" ? "all" : target);
  });
});

// Horizontal left/right scroll cues integrated cleanly at both ends of the legend bar
const elLegendBar = document.getElementById("legend-bar");
const elLegendWrap = document.getElementById("legend-bar-wrap");
const elLegendScrollLeft = document.getElementById("legend-scroll-left");
const elLegendScrollHint = document.getElementById("legend-scroll-hint");
if (elLegendBar) {
  const updateLegendHint = () => {
    const atStart = elLegendBar.scrollLeft <= 6;
    const atEnd = elLegendBar.scrollLeft + elLegendBar.clientWidth >= elLegendBar.scrollWidth - 6;
    if (elLegendWrap) {
      elLegendWrap.classList.toggle("scrolled-start", atStart);
      elLegendWrap.classList.toggle("scrolled-end", atEnd);
    }
  };
  elLegendScrollLeft?.addEventListener("click", () => {
    elLegendBar.scrollBy({ left: -160, behavior: "smooth" });
  });
  elLegendScrollHint?.addEventListener("click", () => {
    elLegendBar.scrollBy({ left: 160, behavior: "smooth" });
  });
  elLegendBar.addEventListener("scroll", updateLegendHint, { passive: true });
  window.addEventListener("resize", updateLegendHint);
  updateLegendHint();
}

const elTogglePhotos = document.getElementById("toggle-photos");
if (elTogglePhotos) {
  elTogglePhotos.addEventListener("change", () => {
    state.onlyPhotos = elTogglePhotos.checked;
    applyFilters();
  });
}

document.getElementById("reset-view-btn").addEventListener("click", () => {
  fitIndiaCentered(true);
});

const elSearchDropdown = document.getElementById("search-dropdown");
const elSearchWrap = document.getElementById("search-wrap");
let searchMatches = [];
let searchActiveIdx = -1;

function closeSearchDropdown() {
  if (!elSearchDropdown) return;
  elSearchDropdown.classList.add("hidden");
  elSearch.setAttribute("aria-expanded", "false");
  searchActiveIdx = -1;
}

function dotColorForFeature(p, kind) {
  if (kind === "prashad") return SITE_COLORS.prashad;
  if (p.flagged) return SITE_COLORS.flagged;
  if (p.unesco) return SITE_COLORS.unesco;
  if (p.revenueCr) return SITE_COLORS.footfall;
  if (p.adoptPartner) return SITE_COLORS.adopt;
  if (p.underfundedCircle) return SITE_COLORS.underfunded;
  return SITE_COLORS.asi;
}

function selectSearchMatch(idx) {
  const item = searchMatches[idx];
  if (!item) return;
  const { feat, kind } = item;
  const p = feat.properties;
  const coords = feat.geometry.coordinates;

  elSearch.value = p.name;
  state.searchQuery = p.name;
  if (state.activeFilter !== "all") {
    setActiveFilter("all");
  } else {
    applyFilters();
  }
  closeSearchDropdown();
  if (kind === "prashad") openPrashadDrawer(p, coords);
  else openMonumentDrawer(p, coords);
}

// Official ASI / Ministry of Tourism India Tourism Data Compendium Top 20 most-visited sites
const TOP_20_MOST_VISITED_QIDS = [
  "Q9141",     // Taj Mahal
  "Q752091",   // Sun Temple, Konark
  "Q187635",   // Qutb Minar
  "Q45957",    // Red Fort
  "Q856259",   // Bibi Ka Maqbara
  "Q171857",   // Agra Fort
  "Q189616",   // Ellora Caves
  "Q17986822", // Golconda Fort
  "Q56458685", // Upper Aguada Fort
  "Q1771696",  // Charminar
  "Q189648",   // Humayun's Tomb
  "Q1351060",  // Shaniwar Wada
  "Q179046",   // Fatehpur Sikri
  "Q184427",   // Ajanta Caves
  "Q1151529",  // Purana Qila
  "Q2045115",  // Jantar Mantar, Delhi
  "Q375624",   // Tomb of Safdarjung
  "Q1144279",  // Group of Monuments at Mamallapuram
  "Q26732",    // Hampi Group of Monuments
  "Q3695769",  // Chittorgarh Fort
];

// Regionally balanced top 6 displayed in default empty search dropdown
const MOST_VISITED_QIDS = ["Q9141", "Q752091", "Q171857", "Q189616", "Q1144279", "Q26732"];

function renderSearchDropdown(openIfEmpty = false) {
  if (!elSearchDropdown || !state.monuments) return;
  const rawQ = elSearch.value.trim().toLowerCase();
  const terms = rawQ.split(/\s+/).filter(Boolean);

  if (!rawQ && !openIfEmpty) {
    closeSearchDropdown();
    return;
  }

  let isDefaultTop = false;
  if (!rawQ) {
    isDefaultTop = true;
    const byQid = new Map();
    for (const f of state.monuments.features) {
      if (MOST_VISITED_QIDS.includes(f.properties.qid)) {
        byQid.set(f.properties.qid, f);
      }
    }
    searchMatches = MOST_VISITED_QIDS
      .map((qid) => byQid.get(qid))
      .filter(Boolean)
      .map((feat) => ({ feat, kind: "monument" }));
    searchActiveIdx = -1;
  } else {
    const scored = [];
    for (const f of state.monuments.features) {
      if (!matchesTokens(f._hay || "", terms)) continue;
      const p = f.properties;
      let score = priorityScore(p);
      if (f._nameLower.startsWith(rawQ)) score += 3000;
      else if (f._nameLower.includes(rawQ)) score += 1600;
      else if (terms.every((t) => f._nameLower.includes(t))) score += 1100;
      scored.push({ feat: f, kind: "monument", score });
    }
    if (state.prashad) {
      for (const f of state.prashad.features) {
        if (!matchesTokens(f._hay || "", terms)) continue;
        let score = 200;
        if (f._nameLower.includes(rawQ)) score += 1500;
        scored.push({ feat: f, kind: "prashad", score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    searchMatches = scored.slice(0, 8);
    searchActiveIdx = -1;
  }

  if (!searchMatches.length) {
    elSearchDropdown.innerHTML = `<div class="search-empty">No matching monuments found</div>`;
  } else {
    const headerHtml = isDefaultTop ? `<div class="search-section-head">Most visited across India (Top 6)</div>` : "";
    elSearchDropdown.innerHTML = headerHtml + searchMatches
      .map(({ feat, kind }, i) => {
        const p = feat.properties;
        const metaParts = [p.location, p.state].filter(Boolean);
        if (kind === "prashad") metaParts.push("PRASHAD");
        else if (p.unesco) metaParts.push("UNESCO");
        else if (p.revenueCr) metaParts.push(`₹${p.revenueCr} Cr`);
        return `
          <button type="button" class="search-option" role="option" data-idx="${i}">
            <span class="search-option-dot" style="background:${dotColorForFeature(p, kind)}"></span>
            <span class="search-option-text">
              <div class="search-option-name">${escapeHtml(p.name)}</div>
              <div class="search-option-meta">${escapeHtml(metaParts.join(" · "))}</div>
            </span>
          </button>
        `;
      })
      .join("");

    elSearchDropdown.querySelectorAll(".search-option").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        selectSearchMatch(Number(btn.dataset.idx));
      });
    });
  }

  elSearchDropdown.classList.remove("hidden");
  elSearch.setAttribute("aria-expanded", "true");
}

const elSearchDock = document.getElementById("search-dock");
const elSearchToggleBtn = document.getElementById("search-toggle-btn");
const elSearchCloseBtn = document.getElementById("search-close-btn");

function openSearchDock() {
  if (!elSearchWrap || !elSearchToggleBtn) return;
  elSearchWrap.classList.remove("hidden");
  elSearchToggleBtn.classList.add("hidden");
  elSearchToggleBtn.setAttribute("aria-expanded", "true");
  elSearch.focus();
  renderSearchDropdown(true);
  schedulePhotoPins();
}

function closeSearchDock(clearQuery = false) {
  closeSearchDropdown();
  if (clearQuery && elSearch.value) {
    elSearch.value = "";
    state.searchQuery = "";
    applyFilters();
  }
  if (elSearchWrap) elSearchWrap.classList.add("hidden");
  if (elSearchToggleBtn) {
    elSearchToggleBtn.classList.remove("hidden");
    elSearchToggleBtn.setAttribute("aria-expanded", "false");
  }
  schedulePhotoPins();
}

if (elSearchToggleBtn) {
  elSearchToggleBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    openSearchDock();
  });
}

if (elSearchCloseBtn) {
  elSearchCloseBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closeSearchDock(true);
  });
}

elSearch.addEventListener("focus", () => {
  renderSearchDropdown(true);
});

elSearch.addEventListener("input", () => {
  state.searchQuery = elSearch.value;
  renderSearchDropdown(true);
  applyFilters();
});

elSearch.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeSearchDock(false);
    return;
  }
  if (!elSearchDropdown || elSearchDropdown.classList.contains("hidden")) return;
  const opts = elSearchDropdown.querySelectorAll(".search-option");
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    searchActiveIdx = Math.min(opts.length - 1, searchActiveIdx + 1);
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    searchActiveIdx = Math.max(-1, searchActiveIdx - 1);
  } else if (ev.key === "Enter") {
    if (searchMatches.length) {
      ev.preventDefault();
      selectSearchMatch(searchActiveIdx >= 0 ? searchActiveIdx : 0);
    }
    return;
  } else {
    return;
  }
  opts.forEach((o, i) => o.classList.toggle("active", i === searchActiveIdx));
  if (searchActiveIdx >= 0 && opts[searchActiveIdx]) {
    opts[searchActiveIdx].scrollIntoView({ block: "nearest" });
  }
});

document.addEventListener("click", (ev) => {
  if (elSearchDock && !elSearchDock.contains(ev.target) && elSearchWrap && !elSearchWrap.classList.contains("hidden")) {
    closeSearchDock(false);
  }
});

// Quick toolbar toggles: Filters Drawer
const elToggleFiltersBtn = document.getElementById("toggle-filters-btn");
const elFiltersDrawer = document.getElementById("filters-drawer");
if (elToggleFiltersBtn && elFiltersDrawer) {
  elToggleFiltersBtn.addEventListener("click", () => {
    const willOpen = elFiltersDrawer.classList.contains("hidden");
    elFiltersDrawer.classList.toggle("hidden", !willOpen);
    elToggleFiltersBtn.classList.toggle("active", willOpen);
    elToggleFiltersBtn.setAttribute("aria-expanded", String(willOpen));
    schedulePhotoPins();
  });
}

elStateSelect.addEventListener("change", () => {
  state.selectedState = elStateSelect.value;
  applyFilters();
});

elCloseDrawer.addEventListener("click", closeDetailDrawer);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && elSearchWrap && !elSearchWrap.classList.contains("hidden")) {
    closeSearchDock(false);
  } else if (ev.key === "Escape" && !elDrawer.classList.contains("hidden")) {
    closeDetailDrawer();
  } else if (
    ev.key === "ArrowLeft" &&
    !elDrawer.classList.contains("hidden") &&
    document.activeElement !== elSearch &&
    document.activeElement.tagName !== "TEXTAREA"
  ) {
    if (state.nearbyNav && state.nearbyNav.list.length > 1) navigateNearby(-1);
    else if (state.carouselHandler) state.carouselHandler(-1);
  } else if (
    ev.key === "ArrowRight" &&
    !elDrawer.classList.contains("hidden") &&
    document.activeElement !== elSearch &&
    document.activeElement.tagName !== "TEXTAREA"
  ) {
    if (state.nearbyNav && state.nearbyNav.list.length > 1) navigateNearby(1);
    else if (state.carouselHandler) state.carouselHandler(1);
  } else if (ev.key === "/" && document.activeElement !== elSearch && document.activeElement.tagName !== "TEXTAREA") {
    ev.preventDefault();
    openSearchDock();
  }
});

document.getElementById("toggle-sources-btn").addEventListener("click", () => {
  document.getElementById("sources-panel").classList.toggle("hidden");
  elBudgetPanel.classList.add("hidden");
});

document.getElementById("close-sources-btn").addEventListener("click", () => {
  document.getElementById("sources-panel").classList.add("hidden");
});

document.getElementById("toggle-budgets-btn").addEventListener("click", () => {
  document.getElementById("sources-panel").classList.add("hidden");
  elBudgetPanel.classList.toggle("hidden");
});

document.getElementById("close-budgets-btn").addEventListener("click", () => {
  elBudgetPanel.classList.add("hidden");
});

elToggleContested.addEventListener("change", () => {
  state.showContested = elToggleContested.checked;
  const vis = state.showContested ? "visible" : "none";
  if (map.getLayer("contested-fill")) map.setLayoutProperty("contested-fill", "visibility", vis);
  if (map.getLayer("contested-line")) map.setLayoutProperty("contested-line", "visibility", vis);
});

// Swipe left/right across the detail card (touch on mobile, horizontal wheel on desktop trackpad) to switch nearby sites
{
  let touchX0 = null;
  let touchY0 = null;
  let swipingCard = false;
  let touchBlocked = false;

  const resetCardDrag = () => {
    elDrawer.style.transition = "";
    elDrawer.style.transform = "";
    elDrawer.style.opacity = "";
    touchX0 = null;
    touchY0 = null;
    swipingCard = false;
    touchBlocked = false;
  };

  elDrawer.addEventListener("touchstart", (ev) => {
    if (!state.nearbyNav || state.nearbyNav.list.length < 2 || ev.touches.length !== 1) return;
    const multiPhoto = Boolean(elDrawer.querySelector(".carousel-thumbs"));
    touchBlocked = Boolean(
      ev.target.closest(".carousel-thumbs, #state-select, input, textarea") ||
      (multiPhoto && ev.target.closest("#carousel-stage"))
    );
    touchX0 = ev.touches[0].clientX;
    touchY0 = ev.touches[0].clientY;
    swipingCard = false;
  }, { passive: true });

  elDrawer.addEventListener("touchmove", (ev) => {
    if (touchBlocked || touchX0 === null || touchY0 === null || ev.touches.length !== 1) return;
    const dx = ev.touches[0].clientX - touchX0;
    const dy = ev.touches[0].clientY - touchY0;
    if (!swipingCard) {
      if (Math.abs(dx) > 16 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        swipingCard = true;
        elDrawer.style.transition = "none";
      } else if (Math.abs(dy) > 16) {
        touchBlocked = true;
        return;
      }
    }
    if (swipingCard) {
      if (ev.cancelable) ev.preventDefault();
      const dragX = Math.max(-140, Math.min(140, dx * 0.65));
      const rot = (dragX / 140) * 2.2;
      elDrawer.style.transform = `translateX(${dragX.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
      elDrawer.style.opacity = String(Math.max(0.72, 1 - Math.abs(dragX) / 420));
    }
  }, { passive: false });

  elDrawer.addEventListener("touchend", (ev) => {
    if (touchBlocked || touchX0 === null || touchY0 === null || !ev.changedTouches.length) {
      resetCardDrag();
      return;
    }
    const dx = ev.changedTouches[0].clientX - touchX0;
    const dy = ev.changedTouches[0].clientY - touchY0;
    if (Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.15) {
      resetCardDrag();
      navigateNearby(dx < 0 ? 1 : -1);
    } else {
      resetCardDrag();
    }
  }, { passive: true });

  elDrawer.addEventListener("touchcancel", resetCardDrag, { passive: true });

  // Trackpad two-finger horizontal swipe on desktop drawer
  let lastWheelNavAt = 0;
  elDrawer.addEventListener("wheel", (ev) => {
    if (!state.nearbyNav || state.nearbyNav.list.length < 2) return;
    if (Math.abs(ev.deltaX) > 40 && Math.abs(ev.deltaX) > Math.abs(ev.deltaY) * 1.8) {
      if (ev.target.closest("#carousel-stage, .carousel-thumbs")) return;
      ev.preventDefault();
      const now = Date.now();
      if (now - lastWheelNavAt < 460) return;
      lastWheelNavAt = now;
      navigateNearby(ev.deltaX > 0 ? 1 : -1);
    }
  }, { passive: false });
}
