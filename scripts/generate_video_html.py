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

    /* Fixed Direction Running SUV Badge */
    .running-car-marker {
      width: 78px;
      height: 52px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    .car-speed-lines {
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 3px;
      opacity: 0.9;
    }

    .speed-line {
      height: 2.5px;
      background: linear-gradient(90deg, rgba(255,255,255,0) 0%, var(--car-color, #38bdf8) 100%);
      border-radius: 2px;
    }
    .speed-line:nth-child(1) { width: 16px; }
    .speed-line:nth-child(2) { width: 22px; }
    .speed-line:nth-child(3) { width: 14px; }

    .car-body-badge {
      position: relative;
      width: 60px;
      height: 40px;
      border-radius: 9px;
      background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
      border: 2px solid #ffffff;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.85), 0 0 14px var(--car-color, #38bdf8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2;
    }

    .suv-label-tag {
      position: absolute;
      top: 2px;
      right: 3px;
      background: #0284c7;
      color: #ffffff;
      font-size: 8px;
      font-weight: 900;
      padding: 0 4px;
      border-radius: 3px;
      line-height: 11px;
      letter-spacing: 0.5px;
    }

    .car-img-svg {
      width: 48px;
      height: 28px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));
    }

    .car-location-anchor {
      position: absolute;
      bottom: -7px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 0 10px var(--car-color, #38bdf8), 0 0 0 3px var(--car-color, #38bdf8);
      z-index: 3;
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
    <div class="main-title">新疆伊犁 8天7晚自驾大环线</div>
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
let carMarker = null;
let displayedScenicMarkers = {};
let displayedRoadMarkers = {};

// Total timeline steps setup
const stepsContainer = document.getElementById('timeline-steps');
const dayShortNames = [
  { day: 'D1', name: '伊宁' },
  { day: 'D2', name: '玉湖' },
  { day: 'D3', name: '阔克苏' },
  { day: 'D4', name: '东西喀拉峻' },
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
    if (currentSeg.day === 'D1' || currentSeg.day === 'D2' || currentSeg.day === 'D3' || currentSeg.day === 'D4') stayText += ' (已订)';
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

  // 4. Update Polyline paths up to current dayIdx and progress with smooth continuous interpolation
  let currentHeadLatLng = null;

  allPolylines.forEach((pl, idx) => {
    if (idx < dayIdx) {
      const pts = pl.coords.map(c => [c[1], c[0]]);
      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
    } else if (idx === dayIdx) {
      const totalPts = pl.coords.length;
      if (totalPts === 0) return;

      // Continuous floating-point progress across points
      const exactIndex = progress * (totalPts - 1);
      const baseIndex = Math.min(Math.floor(exactIndex), totalPts - 1);
      const fraction = exactIndex - baseIndex;

      // Draw line through baseIndex
      const drawnCount = Math.min(totalPts, baseIndex + 1);
      const pts = pl.coords.slice(0, drawnCount).map(c => [c[1], c[0]]);

      // Interpolate the exact head position between baseIndex and next point
      if (fraction > 0.0001 && baseIndex < totalPts - 1) {
        const p1 = pl.coords[baseIndex];
        const p2 = pl.coords[baseIndex + 1];
        const interpLng = p1[0] + (p2[0] - p1[0]) * fraction;
        const interpLat = p1[1] + (p2[1] - p1[1]) * fraction;
        currentHeadLatLng = [interpLat, interpLng];
        pts.push(currentHeadLatLng);
      } else {
        const p = pl.coords[baseIndex];
        currentHeadLatLng = [p[1], p[0]];
      }

      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
    } else {
      pl.casing.setLatLngs([]);
      pl.line.setLatLngs([]);
    }
  });

  // 5. Update Running SUV Marker (Fixed direction SUV illustration with roof rack, chrome rims, no rotation)
  if (currentHeadLatLng && !isFinal) {
    const carHtml = `
      <div class="running-car-marker" style="--car-color: ${currentSeg.color};">
        <div class="car-speed-lines">
          <div class="speed-line"></div>
          <div class="speed-line"></div>
          <div class="speed-line"></div>
        </div>
        <div class="car-body-badge">
          <span class="suv-label-tag">SUV</span>
          <!-- Realistic High-Chassis Self-Drive SUV Vector -->
          <svg class="car-img-svg" viewBox="0 0 68 36" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="suvBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="55%" stop-color="#f1f5f9"/>
                <stop offset="100%" stop-color="${currentSeg.color}"/>
              </linearGradient>
              <linearGradient id="suvWindowGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#38bdf8"/>
                <stop offset="100%" stop-color="#0284c7"/>
              </linearGradient>
              <linearGradient id="suvChassisGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#475569"/>
                <stop offset="100%" stop-color="#0f172a"/>
              </linearGradient>
            </defs>
            <!-- Heavy-Duty Off-Road Luggage Rack on Top -->
            <rect x="18" y="2" width="28" height="2.2" rx="1" fill="#94a3b8"/>
            <rect x="22" y="0.2" width="20" height="2" rx="0.8" fill="#cbd5e1"/>
            <line x1="20" y1="4" x2="20" y2="6.5" stroke="#64748b" stroke-width="1.8"/>
            <line x1="32" y1="4" x2="32" y2="6.5" stroke="#64748b" stroke-width="1.8"/>
            <line x1="44" y1="4" x2="44" y2="6.5" stroke="#64748b" stroke-width="1.8"/>

            <!-- High-Clearance SUV Body Contour -->
            <path d="M 5,23 
                     L 9,23 
                     Q 10,18 16,18 Q 22,18 23,23 
                     L 43,23 
                     Q 44,18 50,18 Q 56,18 57,23 
                     L 63,23 
                     Q 65,23 65,20 
                     L 63,16 
                     Q 60,14 54,13 
                     L 46,12.5 
                     L 36,6 
                     Q 33,5 19,5 
                     L 10,11 
                     L 4,14.5 
                     Q 2,16.5 2,19.5 
                     L 2,21 
                     Q 2,23 5,23 Z" 
                  fill="url(#suvBodyGrad)" stroke="#0f172a" stroke-width="1.3"/>

            <!-- Rugged Lower Body Cladding -->
            <path d="M 5,23 L 9,23 Q 10,19 16,19 Q 22,19 23,23 L 43,23 Q 44,19 50,19 Q 56,19 57,23 L 63,23 L 64,21 L 2,21 L 5,23 Z" 
                  fill="url(#suvChassisGrad)" opacity="0.95"/>

            <!-- SUV Tinted Windows with Pillar Details -->
            <path d="M 21,7 L 34,7 L 43,12.5 L 21,12.5 Z" fill="url(#suvWindowGrad)" opacity="0.92"/>
            <path d="M 11,11.5 L 19,7.5 L 19,12.5 L 6,12.5 Z" fill="url(#suvWindowGrad)" opacity="0.92"/>
            <line x1="20" y1="7" x2="20" y2="12.5" stroke="#1e293b" stroke-width="1.4"/>
            <line x1="33" y1="7" x2="33" y2="12.5" stroke="#1e293b" stroke-width="1.4"/>

            <!-- High-Beam Headlights & Rear Taillights -->
            <polygon points="63,15 65.5,16.5 64.5,18.5 62,17" fill="#fef08a"/>
            <polygon points="3,15.5 1.5,16.5 1.8,18.5 3.5,17.5" fill="#ef4444"/>

            <!-- Large Off-Road Wheels with All-Terrain Chrome Rims -->
            <circle cx="16" cy="23" r="6" fill="#0f172a" stroke="#64748b" stroke-width="1.6"/>
            <circle cx="16" cy="23" r="3.2" fill="#e2e8f0" stroke="#475569" stroke-width="0.8"/>
            <circle cx="16" cy="23" r="1.2" fill="#0f172a"/>

            <circle cx="50" cy="23" r="6" fill="#0f172a" stroke="#64748b" stroke-width="1.6"/>
            <circle cx="50" cy="23" r="3.2" fill="#e2e8f0" stroke="#475569" stroke-width="0.8"/>
            <circle cx="50" cy="23" r="1.2" fill="#0f172a"/>
          </svg>
        </div>
        <div class="car-location-anchor"></div>
      </div>
    `;

    if (!carMarker) {
      const carIcon = L.divIcon({
        className: 'custom-car-div',
        html: carHtml,
        iconSize: [78, 52],
        iconAnchor: [39, 47]
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

print("Updated /workspace/reports/maps/itinerary_video_stage.html successfully with fixed direction running SUV car!")
