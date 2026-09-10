import json

with open('/workspace/data/route_data_sampled.json', 'r', encoding='utf-8') as f:
    route_data = json.load(f)

with open('/workspace/data/subtitles_data.json', 'r', encoding='utf-8') as f:
    subtitles_data = json.load(f)

# Merge subtitles and specific scenic/road data into route_data
for idx, seg in enumerate(route_data['segments']):
    sub = subtitles_data[idx]
    seg['subtitle'] = sub['subtitle']
    seg['subtitle_short'] = sub['subtitle_short']
    seg['roads_list'] = sub['roads']
    seg['scenics_list'] = sub['scenics']
    seg['active_scenics'] = sub['active_scenics']
    seg['active_roads'] = sub['active_roads']

html_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0"/>
  <title>新疆伊犁8天7晚自驾大环线动线视频 (16:9 动态汽车与字幕版)</title>
  <link rel="stylesheet" href="./lib/leaflet.css"/>
  <script src="./lib/leaflet.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      background-color: #0b111e;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #f1f2f6;
      -webkit-font-smoothing: antialiased;
    }

    #video-stage {
      position: relative;
      width: 1920px;
      height: 1080px;
      background: #0b111e;
      overflow: hidden;
    }

    #map {
      position: absolute;
      top: 0;
      left: 0;
      width: 1920px;
      height: 1080px;
      z-index: 1;
      background: #0f172a;
    }

    /* Cinematic Vignette Overlay */
    .vignette-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 1920px;
      height: 1080px;
      pointer-events: none;
      z-index: 50;
      background: radial-gradient(circle at 50% 50%, rgba(11, 17, 30, 0) 65%, rgba(11, 17, 30, 0.65) 100%);
      box-shadow: inset 0 0 120px rgba(0, 0, 0, 0.6);
    }

    /* Top Left Title HUD */
    .hud-title-panel {
      position: absolute;
      top: 32px;
      left: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.9);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 16px;
      padding: 18px 26px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
      display: flex;
      flex-direction: column;
      gap: 7px;
      max-width: 580px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .brand-tag {
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #ffffff;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.5px;
      box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4);
    }

    .flight-tag {
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      color: #94a3b8;
    }
    .flight-tag strong { color: #38bdf8; }

    .main-title {
      font-size: 32px;
      font-weight: 900;
      letter-spacing: 1px;
      background: linear-gradient(135deg, #ffffff 0%, #f1f5f9 60%, #fcd34d 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1.18;
    }

    .sub-chips {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .mini-chip {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      color: #cbd5e1;
    }
    .mini-chip.amber {
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.45);
      background: rgba(245, 158, 11, 0.15);
      font-weight: 700;
    }
    .mini-chip.cyan {
      color: #22d3ee;
      border-color: rgba(6, 182, 212, 0.45);
      background: rgba(6, 182, 212, 0.15);
      font-weight: 700;
    }

    /* Top Right Current Status HUD Card */
    .hud-status-panel {
      position: absolute;
      top: 32px;
      right: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.92);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 16px;
      padding: 18px 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
      width: 440px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: all 0.3s ease;
    }

    .status-badge-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .status-day-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 900;
      color: #ffffff;
      background: var(--active-color, #38bdf8);
      padding: 3px 12px;
      border-radius: 8px;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .status-date {
      font-size: 13px;
      color: #94a3b8;
      font-weight: 700;
    }

    .status-title {
      font-size: 17px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.25;
    }

    .status-roads-tagbar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tag-road-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      color: #38bdf8;
      font-weight: 700;
    }

    .status-scenics-tagbar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tag-scenic-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      border-radius: 4px;
      padding: 2px 7px;
      font-size: 11px;
      color: #34d399;
      font-weight: 700;
    }

    .status-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px dashed rgba(255, 255, 255, 0.12);
      padding-top: 6px;
      font-size: 12px;
    }

    .status-stay {
      color: #fbbf24;
      font-weight: 800;
      max-width: 250px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-dist {
      color: #94a3b8;
      font-weight: 700;
    }

    /* Subtitle Bar at Bottom (Travel Vlog Subtitles) */
    .subtitle-bar-wrapper {
      position: absolute;
      bottom: 96px;
      left: 120px;
      right: 120px;
      z-index: 100;
      display: flex;
      justify-content: center;
      pointer-events: none;
    }

    .subtitle-bar {
      background: linear-gradient(90deg, rgba(11, 17, 30, 0.94) 0%, rgba(15, 23, 42, 0.98) 50%, rgba(11, 17, 30, 0.94) 100%);
      border: 1.5px solid rgba(255, 255, 255, 0.2);
      border-radius: 14px;
      padding: 10px 28px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.15);
      display: flex;
      align-items: center;
      gap: 16px;
      max-width: 1400px;
    }

    .subtitle-day-pill {
      background: var(--active-color, #38bdf8);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      padding: 4px 12px;
      border-radius: 6px;
      letter-spacing: 0.5px;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    }

    .subtitle-text {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.4;
      letter-spacing: 0.5px;
      text-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
    }

    .subtitle-text strong {
      color: #fcd34d;
    }

    /* Bottom Timeline Progress Bar */
    .hud-timeline-panel {
      position: absolute;
      bottom: 24px;
      left: 48px;
      right: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.92);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 14px;
      padding: 10px 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .timeline-steps {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-grow: 1;
      position: relative;
    }

    .timeline-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      position: relative;
      z-index: 2;
      opacity: 0.45;
      transition: all 0.3s;
    }

    .timeline-step.active {
      opacity: 1;
      transform: scale(1.1);
    }

    .timeline-step.completed {
      opacity: 0.9;
    }

    .step-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--step-color, #64748b);
      border: 2px solid #ffffff;
      box-shadow: 0 0 8px var(--step-color, #64748b);
    }

    .step-label {
      font-size: 11px;
      font-weight: 800;
      color: #f1f5f9;
    }

    .step-name {
      font-size: 10px;
      color: #94a3b8;
    }

    .timeline-total-stats {
      border-left: 1px solid rgba(255, 255, 255, 0.15);
      padding-left: 18px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 1px;
      flex-shrink: 0;
    }

    .total-dist-val {
      font-size: 17px;
      font-weight: 900;
      color: #fcd34d;
      letter-spacing: 0.5px;
    }

    .total-dist-lbl {
      font-size: 10px;
      color: #94a3b8;
    }

    /* Road badge marker on map */
    .road-badge-marker {
      background: #dc2626;
      color: #ffffff;
      border: 1.5px solid #ffffff;
      border-radius: 6px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7);
      white-space: nowrap;
    }
    .road-badge-marker.provincial { background: #d97706; }
    .road-badge-marker.scenic { background: #059669; }
    .road-badge-marker.lake { background: #0284c7; }
    .road-badge-marker.city { background: #475569; }

    /* Custom Scenic Spot Markers */
    .custom-marker {
      display: inline-flex;
      align-items: center;
      position: relative;
    }

    .custom-marker.left-layout {
      flex-direction: row-reverse;
    }

    .marker-pin {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #ffffff;
      color: #0f172a;
      font-size: 14px;
      font-weight: 900;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7), 0 0 0 3px var(--marker-color, #3b82f6);
      z-index: 2;
      flex-shrink: 0;
    }

    .marker-label-pill {
      margin: 0 7px;
      background: rgba(15, 23, 42, 0.95);
      border: 1.5px solid var(--marker-color, #38bdf8);
      border-radius: 7px;
      padding: 3px 9px;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .marker-name {
      font-size: 12px;
      font-weight: 800;
      color: #ffffff;
    }

    .marker-tag {
      font-size: 10px;
      color: var(--marker-color, #38bdf8);
      font-weight: 700;
    }

    .marker-hotel {
      border-color: #f59e0b !important;
    }
    .marker-hotel .marker-tag {
      color: #fbbf24 !important;
    }

    /* Car Marker with Dynamic Rotation */
    .car-marker-container {
      width: 44px;
      height: 44px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .car-halo-glow {
      position: absolute;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--car-color, #38bdf8) 0%, rgba(255,255,255,0) 70%);
      animation: carPulse 1.2s infinite ease-out;
    }

    @keyframes carPulse {
      0% { transform: scale(0.8); opacity: 0.8; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    .car-icon-wrapper {
      position: relative;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: #0f172a;
      border: 2px solid #ffffff;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.8), 0 0 10px var(--car-color, #38bdf8);
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(var(--car-heading, 0deg));
      transition: transform 0.1s ease;
    }

    .car-svg {
      width: 22px;
      height: 22px;
      fill: var(--car-color, #38bdf8);
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
    }
  </style>
</head>
<body>
<div id="video-stage">
  <!-- Map Container -->
  <div id="map"></div>
  <div class="vignette-overlay"></div>

  <!-- HUD: Title -->
  <div class="hud-title-panel">
    <div class="title-row">
      <span class="brand-tag">🚗 2026国庆自驾 · PLAN B</span>
      <span class="flight-tag">✈️ 广州 <strong>CAN</strong> ⇄ <strong>YIN / BPL</strong> 双飞</span>
    </div>
    <div class="main-title">新疆伊犁 8天7晚自驾大环线动线</div>
    <div class="sub-chips">
      <span class="mini-chip amber">⏰ 每日出发 ≥ 10:00 (慢节奏)</span>
      <span class="mini-chip cyan">👥 5人家庭自驾 (老人友好)</span>
      <span class="mini-chip">📅 2026.10.01 – 10.08</span>
      <span class="mini-chip">🏔️ 喀拉峻连住2晚</span>
    </div>
  </div>

  <!-- HUD: Dynamic Day Status Card -->
  <div class="hud-status-panel" id="status-panel">
    <div class="status-badge-row">
      <div class="status-day-badge" id="hud-day-badge">D1 · 启程</div>
      <div class="status-date" id="hud-date">10/1 周四</div>
    </div>
    <div class="status-title" id="hud-title">广州飞抵伊宁 · 提车入住</div>
    <div class="status-roads-tagbar" id="hud-roads-tags">
      <!-- Road tags -->
    </div>
    <div class="status-scenics-tagbar" id="hud-scenics-tags">
      <!-- Scenic tags -->
    </div>
    <div class="status-meta-row">
      <div class="status-stay" id="hud-stay">🏡 宿: 全季伊宁机场店 (已订)</div>
      <div class="status-dist" id="hud-dist">🚗 本日: 3.1 km</div>
    </div>
  </div>

  <!-- Travel Subtitles Bar (Bottom Above Timeline) -->
  <div class="subtitle-bar-wrapper">
    <div class="subtitle-bar">
      <div class="subtitle-day-pill" id="sub-day-badge">D1 抵疆</div>
      <div class="subtitle-text" id="sub-content">
        CZ6888 广州直飞 23:10 落地伊宁机场，提车直接入住机场全季，免深夜赶路。
      </div>
    </div>
  </div>

  <!-- HUD: Bottom Timeline -->
  <div class="hud-timeline-panel">
    <div class="timeline-steps" id="timeline-steps">
      <!-- Steps generated via JS -->
    </div>
    <div class="timeline-total-stats">
      <div class="total-dist-val" id="hud-total-dist">0.0 km</div>
      <div class="total-dist-lbl">自驾累计里程 / 1,684 km</div>
    </div>
  </div>
</div>

<script>
const ROUTE_DATA = """ + json.dumps(route_data, ensure_ascii=False) + """;

let map;
let allPolylines = [];
let roadBadgeMarkers = [];
let carMarker = null;
let currentCarHeading = 0;
let displayedScenicMarkers = {};
let displayedRoadMarkers = {};

// Total timeline steps setup
const stepsContainer = document.getElementById('timeline-steps');
const dayShortNames = [
  { day: 'D1', name: '伊宁' },
  { day: 'D2', name: '玉湖' },
  { day: 'D3', name: '喀拉峻' },
  { day: 'D4', name: '阔克苏' },
  { day: 'D5', name: '唐布拉' },
  { day: 'D6', name: '独库赛湖' },
  { day: 'D7', name: '环湖博乐' },
  { day: 'D8', name: '返程广州' }
];

dayShortNames.forEach((item, idx) => {
  const step = document.createElement('div');
  step.className = 'timeline-step' + (idx === 0 ? ' active' : '');
  step.id = 'step-' + item.day;
  const seg = ROUTE_DATA.segments[idx];
  step.style.setProperty('--step-color', seg.color);

  step.innerHTML = `
    <div class="step-dot" style="background: ${seg.color}"></div>
    <div class="step-label">${item.day}</div>
    <div class="step-name">${item.name}</div>
  `;
  stepsContainer.appendChild(step);
});

// Calculate bearing angle between two lat/lng coordinates in degrees
function calculateHeading(p1, p2) {
  const lat1 = p1[0] * Math.PI / 180;
  const lat2 = p2[0] * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([43.90, 82.80], 8);

  // Google Terrain Tiles
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 18,
    opacity: 0.98
  }).addTo(map);

  // Pre-create polyline pairs (black casing + color) for each day
  ROUTE_DATA.segments.forEach((seg, idx) => {
    const casing = L.polyline([], {
      color: '#000000',
      weight: 8,
      opacity: 0.82,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    const line = L.polyline([], {
      color: seg.color,
      weight: 4.8,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    allPolylines.push({ casing, line, coords: seg.coordinates });
  });

  // Fit view to overall route
  const allBounds = L.latLngBounds([]);
  ROUTE_DATA.segments.forEach(seg => {
    seg.coordinates.forEach(c => allBounds.extend([c[1], c[0]]));
  });
  map.fitBounds(allBounds, {
    paddingTopLeft: [120, 80],
    paddingBottomRight: [120, 110]
  });

  window.mapReady = true;
}

// Global function called by rendering script for each frame
window.setVideoState = function(state) {
  const { dayIdx, progress, cumulativeDistKm, isFinal } = state;
  const currentSeg = ROUTE_DATA.segments[dayIdx];

  // 1. Update HUD status card
  const panel = document.getElementById('status-panel');
  panel.style.setProperty('--active-color', currentSeg.color);

  document.getElementById('hud-day-badge').innerText = `${currentSeg.day} · ${currentSeg.theme}`;
  document.getElementById('hud-date').innerText = currentSeg.date;
  document.getElementById('hud-title').innerText = currentSeg.title;

  // Road tags
  const roadTagsContainer = document.getElementById('hud-roads-tags');
  roadTagsContainer.innerHTML = '';
  if (currentSeg.roads_list) {
    currentSeg.roads_list.forEach(r => {
      const sp = document.createElement('span');
      sp.className = 'tag-road-pill';
      sp.innerHTML = `🛣️ ${r}`;
      roadTagsContainer.appendChild(sp);
    });
  }

  // Scenic tags
  const scenicTagsContainer = document.getElementById('hud-scenics-tags');
  scenicTagsContainer.innerHTML = '';
  if (currentSeg.scenics_list) {
    currentSeg.scenics_list.forEach(s => {
      const sp = document.createElement('span');
      sp.className = 'tag-scenic-pill';
      sp.innerHTML = `📍 ${s}`;
      scenicTagsContainer.appendChild(sp);
    });
  }

  let stayText = '—';
  const hotelWp = currentSeg.waypoints.find(w => w.stay);
  if (hotelWp) {
    stayText = `🏡 宿: ${hotelWp.hotel || hotelWp.name}`;
    if (currentSeg.day === 'D1' || currentSeg.day === 'D2') stayText += ' (已订)';
  } else if (currentSeg.day === 'D8') {
    stayText = '✈️ 广州温馨的家 (MU6170)';
  }
  document.getElementById('hud-stay').innerText = stayText;
  document.getElementById('hud-dist').innerText = `🚗 本日: ${currentSeg.distance_km} km`;
  document.getElementById('hud-total-dist').innerText = cumulativeDistKm.toFixed(1) + ' km';

  // 2. Update Subtitle Bar
  const subDayBadge = document.getElementById('sub-day-badge');
  subDayBadge.style.setProperty('--active-color', currentSeg.color);
  subDayBadge.innerText = `${currentSeg.day} 行程`;
  document.getElementById('sub-content').innerText = currentSeg.subtitle;

  // 3. Update Timeline steps
  dayShortNames.forEach((item, idx) => {
    const el = document.getElementById('step-' + item.day);
    el.classList.remove('active', 'completed');
    if (idx < dayIdx) el.classList.add('completed');
    else if (idx === dayIdx) el.classList.add('active');
  });

  // 4. Update Polyline paths up to current dayIdx and progress
  let currentHeadLatLng = null;
  let prevHeadLatLng = null;

  allPolylines.forEach((pl, idx) => {
    if (idx < dayIdx) {
      const pts = pl.coords.map(c => [c[1], c[0]]);
      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
    } else if (idx === dayIdx) {
      const totalPts = pl.coords.length;
      const count = Math.max(1, Math.min(totalPts, Math.floor(progress * totalPts)));
      const subCoords = pl.coords.slice(0, count);
      const pts = subCoords.map(c => [c[1], c[0]]);
      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
      if (pts.length > 0) {
        currentHeadLatLng = pts[pts.length - 1];
        if (pts.length > 1) {
          prevHeadLatLng = pts[pts.length - 2];
        }
      }
    } else {
      pl.casing.setLatLngs([]);
      pl.line.setLatLngs([]);
    }
  });

  // 5. Update Car Marker (with SVG car & dynamic heading)
  if (currentHeadLatLng && !isFinal) {
    if (prevHeadLatLng) {
      currentCarHeading = calculateHeading(prevHeadLatLng, currentHeadLatLng);
    }

    const carHtml = `
      <div class="car-marker-container" style="--car-color: ${currentSeg.color};">
        <div class="car-halo-glow"></div>
        <div class="car-icon-wrapper" style="--car-heading: ${currentCarHeading}deg;">
          <svg class="car-svg" viewBox="0 0 24 24">
            <!-- Sleek Top-Down Car Silhouette -->
            <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4.66l.12-.34h13.77l.11.34V17z"/>
            <circle cx="7.5" cy="14.5" r="1.5" fill="#fcd34d"/>
            <circle cx="16.5" cy="14.5" r="1.5" fill="#fcd34d"/>
          </svg>
        </div>
      </div>
    `;

    if (!carMarker) {
      const carIcon = L.divIcon({
        className: 'custom-car-div',
        html: carHtml,
        iconSize: [44, 44],
        iconAnchor: [22, 22]
      });
      carMarker = L.marker(currentHeadLatLng, { icon: carIcon, zIndexOffset: 2000 }).addTo(map);
    } else {
      carMarker.setLatLng(currentHeadLatLng);
      const el = carMarker.getElement();
      if (el) {
        el.innerHTML = carHtml;
      }
    }
  } else if (carMarker && isFinal) {
    map.removeLayer(carMarker);
    carMarker = null;
  }

  // 6. Progressively show Scenic Spots for past & current days
  ROUTE_DATA.segments.forEach((seg, sIdx) => {
    if (sIdx <= dayIdx && seg.active_scenics) {
      seg.active_scenics.forEach(sc => {
        const key = sc.name;
        if (!displayedScenicMarkers[key]) {
          const isHotel = !!sc.hotel;
          const tagText = sc.hotel ? `${sc.tag} · ${sc.hotel}` : sc.tag;
          const isLeft = sc.layout === 'left';

          const markerHtml = `
            <div class="custom-marker ${isLeft ? 'left-layout' : ''}" style="--marker-color: ${seg.color};">
              <div class="marker-pin">${sc.icon}</div>
              <div class="marker-label-pill ${isHotel ? 'marker-hotel' : ''}">
                <span class="marker-name">${sc.name}</span>
                <span class="marker-tag">${tagText}</span>
              </div>
            </div>
          `;

          const customIcon = L.divIcon({
            className: 'leaflet-div-icon-custom',
            html: markerHtml,
            iconSize: [180, 32],
            iconAnchor: isLeft ? [166, 16] : [14, 16]
          });

          const m = L.marker([sc.coord[1], sc.coord[0]], { icon: customIcon, zIndexOffset: 500 }).addTo(map);
          displayedScenicMarkers[key] = m;
        }
      });
    }
  });

  // 7. Progressively show Road Badges for past & current days
  ROUTE_DATA.segments.forEach((seg, sIdx) => {
    if (sIdx <= dayIdx && seg.active_roads) {
      seg.active_roads.forEach(rb => {
        const key = rb.road;
        if (!displayedRoadMarkers[key]) {
          let cls = 'road-badge-marker';
          if (rb.type === 'provincial') cls += ' provincial';
          else if (rb.type === 'scenic') cls += ' scenic';
          else if (rb.type === 'lake') cls += ' lake';
          else if (rb.type === 'city') cls += ' city';

          const icon = L.divIcon({
            className: 'custom-road-badge',
            html: `<div class="${cls}">🛣️ ${rb.road}</div>`,
            iconSize: [92, 26],
            iconAnchor: [46, 13]
          });

          const m = L.marker([rb.coord[1], rb.coord[0]], { icon: icon, zIndexOffset: 300 }).addTo(map);
          displayedRoadMarkers[key] = m;
        }
      });
    }
  });
};

window.onload = initMap;
</script>
</body>
</html>
"""

with open('/workspace/reports/maps/itinerary_video_stage.html', 'w', encoding='utf-8') as f:
    f.write(html_content)

print("Updated /workspace/reports/maps/itinerary_video_stage.html successfully!")
