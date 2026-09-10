import json

with open('/workspace/data/route_data_sampled.json', 'r', encoding='utf-8') as f:
    route_data = json.load(f)

html_content = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=1920, height=1080, initial-scale=1.0"/>
  <title>新疆伊犁8天7晚自驾大环线动线视频 (16:9)</title>
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
      background: radial-gradient(circle at 50% 50%, rgba(11, 17, 30, 0) 65%, rgba(11, 17, 30, 0.6) 100%);
      box-shadow: inset 0 0 100px rgba(0, 0, 0, 0.5);
    }

    /* Top Left Title HUD */
    .hud-title-panel {
      position: absolute;
      top: 36px;
      left: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.88);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 20px 28px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 580px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 12px;
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
      line-height: 1.2;
    }

    .sub-chips {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .mini-chip {
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      color: #cbd5e1;
    }
    .mini-chip.amber {
      color: #fbbf24;
      border-color: rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.15);
      font-weight: 700;
    }
    .mini-chip.cyan {
      color: #22d3ee;
      border-color: rgba(6, 182, 212, 0.4);
      background: rgba(6, 182, 212, 0.15);
      font-weight: 700;
    }

    /* Top Right Current Status HUD Card */
    .hud-status-panel {
      position: absolute;
      top: 36px;
      right: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.9);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 20px 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
      width: 420px;
      display: flex;
      flex-direction: column;
      gap: 10px;
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
      font-size: 15px;
      font-weight: 900;
      color: #ffffff;
      background: var(--active-color, #38bdf8);
      padding: 4px 14px;
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
      font-size: 18px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.3;
    }

    .status-road {
      font-size: 13px;
      color: #38bdf8;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-desc {
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.45;
      background: rgba(15, 23, 42, 0.6);
      padding: 8px 12px;
      border-radius: 8px;
      border-left: 3px solid var(--active-color, #38bdf8);
    }

    .status-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px dashed rgba(255, 255, 255, 0.12);
      padding-top: 8px;
      font-size: 12px;
    }

    .status-stay {
      color: #fbbf24;
      font-weight: 800;
    }
    .status-dist {
      color: #94a3b8;
      font-weight: 700;
    }

    /* Bottom Timeline Progress Bar */
    .hud-timeline-panel {
      position: absolute;
      bottom: 36px;
      left: 48px;
      right: 48px;
      z-index: 100;
      background: rgba(11, 17, 30, 0.9);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 14px 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
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
      gap: 4px;
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
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--step-color, #64748b);
      border: 2px solid #ffffff;
      box-shadow: 0 0 10px var(--step-color, #64748b);
    }

    .step-label {
      font-size: 12px;
      font-weight: 800;
      color: #f1f5f9;
    }

    .step-name {
      font-size: 10px;
      color: #94a3b8;
    }

    .timeline-total-stats {
      border-left: 1px solid rgba(255, 255, 255, 0.15);
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
    }

    .total-dist-val {
      font-size: 18px;
      font-weight: 900;
      color: #fcd34d;
      letter-spacing: 0.5px;
    }

    .total-dist-lbl {
      font-size: 11px;
      color: #94a3b8;
    }

    /* Road badge marker on map */
    .road-badge-marker {
      background: #dc2626;
      color: #ffffff;
      border: 1.5px solid #ffffff;
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.7);
      white-space: nowrap;
    }
    .road-badge-marker.provincial { background: #d97706; }
    .road-badge-marker.scenic { background: #059669; }
    .road-badge-marker.lake { background: #0284c7; }

    /* Custom Leaflet Marker Styles */
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
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #ffffff;
      color: #0f172a;
      font-size: 15px;
      font-weight: 900;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.7), 0 0 0 3.5px var(--marker-color, #3b82f6);
      z-index: 2;
      flex-shrink: 0;
    }

    .marker-label-pill {
      margin: 0 8px;
      background: rgba(15, 23, 42, 0.94);
      border: 1.5px solid var(--marker-color, #38bdf8);
      border-radius: 8px;
      padding: 4px 10px;
      white-space: nowrap;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .marker-name {
      font-size: 13px;
      font-weight: 800;
      color: #ffffff;
    }

    .marker-tag {
      font-size: 11px;
      color: var(--marker-color, #38bdf8);
      font-weight: 700;
    }

    .marker-hotel {
      border-color: #f59e0b !important;
    }
    .marker-hotel .marker-tag {
      color: #fbbf24 !important;
    }

    /* Car / Current Position Pulsing Head */
    .current-head-pulse {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 0 0 4px var(--head-color, #38bdf8), 0 0 16px 8px var(--head-color, #38bdf8);
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
    <div class="status-title" id="hud-title">广州飞抵伊宁 · 入住机场全季</div>
    <div class="status-road" id="hud-road">🛣️ 机场快捷通道</div>
    <div class="status-desc" id="hud-desc">CZ6888 23:10 落地伊宁，宿机场全季，免深夜赶路</div>
    <div class="status-meta-row">
      <div class="status-stay" id="hud-stay">🏡 宿: 全季伊宁机场店 (已订)</div>
      <div class="status-dist" id="hud-dist">🚗 车程: 3.1 km</div>
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
let allMarkers = [];
let roadBadgeMarkers = [];
let carHeadMarker = null;

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

// Key waypoints to show progressively
const keyWaypointsDef = [
  { dayIdx: 0, name: "伊宁国际机场", tag: "D1 落地 23:10", coord: [81.330, 43.956], color: "#747D8C", icon: "✈️", layout: "left" },
  { dayIdx: 1, name: "昭苏玉湖", tag: "D2 冰川蓝湖", coord: [80.887, 42.943], color: "#FF4757", icon: "🌊", hotel: "宿 望湖庄园", layout: "left" },
  { dayIdx: 2, name: "喀拉峻大草原", tag: "D3-D4 阔克苏/鲜花台", coord: [82.023, 43.003], color: "#2ED573", icon: "🏔️", hotel: "宿 景区民宿", layout: "right" },
  { dayIdx: 4, name: "库尔德宁东沟", tag: "D5 云杉林 2.5h", coord: [82.855, 43.190], color: "#FFA502", icon: "🌲", layout: "left" },
  { dayIdx: 4, name: "唐布拉百里画廊", tag: "D5 宿放蜂人家", coord: [83.275, 43.682], color: "#FFA502", icon: "🏕️", hotel: "宿 放蜂人家", layout: "left" },
  { dayIdx: 5, name: "乔尔玛烈士陵园", tag: "独库北段起点", coord: [83.697, 43.667], color: "#9B59B6", icon: "🎖️", layout: "right" },
  { dayIdx: 5, name: "哈希勒根达坂", tag: "3400m 防雪长廊", coord: [83.950, 44.050], color: "#9B59B6", icon: "❄️", layout: "right" },
  { dayIdx: 5, name: "果子沟金顶大桥", tag: "天山奇观大桥", coord: [81.162, 44.482], color: "#2563eb", icon: "🌉", layout: "left" },
  { dayIdx: 5, name: "赛里木湖", tag: "D6夕阳 / D7环湖", coord: [81.250, 44.600], color: "#00CEC9", icon: "💎", hotel: "D6宿 东门", layout: "right" },
  { dayIdx: 6, name: "博乐市区", tag: "D7 宿全季酒店", coord: [82.072, 44.903], color: "#00CEC9", icon: "🏙️", hotel: "宿 全季酒店", layout: "left" },
  { dayIdx: 7, name: "博乐阿拉山口机场", tag: "D8 12:00前还车飞广州", coord: [82.298, 44.895], color: "#FD79A8", icon: "✈️", layout: "right" }
];

function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([43.90, 82.80], 8);

  // Google Terrain
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 18,
    opacity: 0.98
  }).addTo(map);

  // Road shields
  if (ROUTE_DATA.highway_badges) {
    ROUTE_DATA.highway_badges.forEach(b => {
      let cls = 'road-badge-marker';
      if (b.road.startsWith('S')) cls += ' provincial';
      if (b.road.includes('桥')) cls += ' scenic';
      if (b.road.includes('环湖')) cls += ' lake';

      const icon = L.divIcon({
        className: 'custom-road-badge',
        html: `<div class="${cls}">🛣️ ${b.road}</div>`,
        iconSize: [88, 26],
        iconAnchor: [44, 13]
      });

      const m = L.marker([b.coord[1], b.coord[0]], { icon: icon }).addTo(map);
      roadBadgeMarkers.push(m);
    });
  }

  // Pre-create polyline pairs (black casing + color) for each day
  ROUTE_DATA.segments.forEach((seg, idx) => {
    const casing = L.polyline([], {
      color: '#000000',
      weight: 8,
      opacity: 0.8,
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
    paddingBottomRight: [120, 80]
  });

  window.mapReady = true;
}

// Global function called by rendering script for each frame
window.setVideoState = function(state) {
  // state = { dayIdx, progress (0..1 in day), cumulativeDistKm, isFinal }
  const { dayIdx, progress, cumulativeDistKm, isFinal } = state;
  const currentSeg = ROUTE_DATA.segments[dayIdx];

  // Update HUD status card
  const panel = document.getElementById('status-panel');
  panel.style.setProperty('--active-color', currentSeg.color);

  document.getElementById('hud-day-badge').innerText = `${currentSeg.day} · ${currentSeg.theme}`;
  document.getElementById('hud-date').innerText = currentSeg.date;
  document.getElementById('hud-title').innerText = currentSeg.title;
  document.getElementById('hud-road').innerText = `🛣️ ${currentSeg.road}`;
  document.getElementById('hud-desc').innerText = currentSeg.highlight;

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

  // Update Timeline steps
  dayShortNames.forEach((item, idx) => {
    const el = document.getElementById('step-' + item.day);
    el.classList.remove('active', 'completed');
    if (idx < dayIdx) el.classList.add('completed');
    else if (idx === dayIdx) el.classList.add('active');
  });

  // Update Polyline paths up to current dayIdx and progress
  let currentHeadLatLng = null;

  allPolylines.forEach((pl, idx) => {
    if (idx < dayIdx) {
      // Completed full day
      const pts = pl.coords.map(c => [c[1], c[0]]);
      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
    } else if (idx === dayIdx) {
      // Partially drawn day
      const totalPts = pl.coords.length;
      const count = Math.max(1, Math.min(totalPts, Math.floor(progress * totalPts)));
      const subCoords = pl.coords.slice(0, count);
      const pts = subCoords.map(c => [c[1], c[0]]);
      pl.casing.setLatLngs(pts);
      pl.line.setLatLngs(pts);
      if (pts.length > 0) {
        currentHeadLatLng = pts[pts.length - 1];
      }
    } else {
      // Future day
      pl.casing.setLatLngs([]);
      pl.line.setLatLngs([]);
    }
  });

  // Update / Move Car Head Marker
  if (currentHeadLatLng && !isFinal) {
    if (!carHeadMarker) {
      const headIcon = L.divIcon({
        className: 'custom-car-head',
        html: `<div class="current-head-pulse" style="--head-color: ${currentSeg.color};"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });
      carHeadMarker = L.marker(currentHeadLatLng, { icon: headIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      carHeadMarker.setLatLng(currentHeadLatLng);
      const el = carHeadMarker.getElement();
      if (el) {
        const pulse = el.querySelector('.current-head-pulse');
        if (pulse) pulse.style.setProperty('--head-color', currentSeg.color);
      }
    }
  } else if (carHeadMarker && isFinal) {
    map.removeLayer(carHeadMarker);
    carHeadMarker = null;
  }

  // Update Waypoint Markers (show if dayIdx >= marker's dayIdx)
  keyWaypointsDef.forEach(wp => {
    if (dayIdx >= wp.dayIdx && !wp.markerInstance) {
      const isHotel = !!wp.hotel;
      const tagText = wp.hotel ? `${wp.tag} · ${wp.hotel}` : wp.tag;
      const isLeft = wp.layout === 'left';

      const markerHtml = `
        <div class="custom-marker ${isLeft ? 'left-layout' : ''}" style="--marker-color: ${wp.color};">
          <div class="marker-pin">${wp.icon}</div>
          <div class="marker-label-pill ${isHotel ? 'marker-hotel' : ''}">
            <span class="marker-name">${wp.name}</span>
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

      wp.markerInstance = L.marker([wp.coord[1], wp.coord[0]], { icon: customIcon }).addTo(map);
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

print("Generated /workspace/reports/maps/itinerary_video_stage.html successfully!")
