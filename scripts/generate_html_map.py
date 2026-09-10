import json

with open('/workspace/data/route_data.json', 'r', encoding='utf-8') as f:
    route_data = json.load(f)

html_template = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=1080, height=1920, initial-scale=1.0"/>
  <title>2026国庆新疆伊犁8天7晚自驾大环线动线图 (9:16)</title>
  <link rel="stylesheet" href="./lib/leaflet.css"/>
  <script src="./lib/leaflet.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body, html {
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background-color: #0b111e;
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      color: #f1f2f6;
      -webkit-font-smoothing: antialiased;
    }

    #poster-root {
      position: relative;
      width: 1080px;
      height: 1920px;
      background: #0b111e;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Top Header Section */
    .header-panel {
      position: relative;
      z-index: 1000;
      width: 1080px;
      height: 230px;
      padding: 24px 36px 14px 36px;
      background: linear-gradient(180deg, #0b111ecc 0%, #0b111ee6 85%, #0b111e00 100%);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .header-top-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .plan-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      color: #ffffff;
      padding: 5px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 1px;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.4);
    }

    .flight-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(30, 41, 59, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 5px 16px;
      border-radius: 20px;
      font-size: 13px;
      color: #cbd5e1;
    }

    .flight-pill strong {
      color: #38bdf8;
    }

    .header-main-title {
      font-size: 40px;
      font-weight: 900;
      letter-spacing: 1.5px;
      background: linear-gradient(135deg, #ffffff 0%, #f1f5f9 60%, #fcd34d 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1.15;
      text-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
    }

    .header-subtitle {
      font-size: 17px;
      font-weight: 700;
      color: #38bdf8;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-subtitle .arrow {
      color: #94a3b8;
      font-size: 13px;
    }

    .header-chips {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .chip {
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.25);
      border-radius: 8px;
      padding: 4px 12px;
      font-size: 13px;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .chip.highlight {
      background: rgba(245, 158, 11, 0.2);
      border-color: rgba(245, 158, 11, 0.5);
      color: #fbbf24;
      font-weight: 700;
    }

    .chip.cyan {
      background: rgba(6, 182, 212, 0.18);
      border-color: rgba(6, 182, 212, 0.45);
      color: #22d3ee;
      font-weight: 700;
    }

    /* Map Canvas */
    #map-wrapper {
      position: relative;
      width: 1080px;
      height: 1210px;
      z-index: 1;
    }

    #map {
      width: 1080px;
      height: 1210px;
      background: #0f172a;
    }

    /* Layer Switcher (Top Right) */
    .map-layer-switcher {
      position: absolute;
      top: 16px;
      right: 24px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 4px;
      display: flex;
      gap: 4px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    }

    .layer-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      font-size: 12px;
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .layer-btn.active {
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4);
    }

    /* Map Overlay Road Legend */
    .map-overlay-road-legend {
      position: absolute;
      top: 16px;
      left: 24px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      gap: 7px;
      width: 255px;
    }

    .legend-title {
      font-size: 12px;
      font-weight: 800;
      color: #94a3b8;
      letter-spacing: 1px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      padding-bottom: 5px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #e2e8f0;
    }

    .road-shield-mini {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
    }

    .shield-g { background: #dc2626; color: #fff; }
    .shield-s { background: #d97706; color: #fff; }
    .shield-blue { background: #2563eb; color: #fff; }
    .shield-cyan { background: #0d9488; color: #fff; }

    /* Map Overlay Key Features */
    .map-overlay-features {
      position: absolute;
      top: 60px;
      right: 24px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 12px 16px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 250px;
    }

    .feature-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #cbd5e1;
    }

    .feature-icon {
      font-size: 15px;
      flex-shrink: 0;
    }

    /* Day Route Mini Legend in Map */
    .day-color-bar {
      position: absolute;
      bottom: 20px;
      left: 24px;
      z-index: 500;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      padding: 9px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    }

    .day-dot-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 800;
      color: #f1f5f9;
    }

    .day-color-line {
      width: 18px;
      height: 5px;
      border-radius: 3px;
    }

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
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #ffffff;
      color: #0f172a;
      font-size: 14px;
      font-weight: 800;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6), 0 0 0 3px var(--marker-color, #3b82f6);
      z-index: 2;
      flex-shrink: 0;
    }

    .marker-label-pill {
      margin: 0 6px;
      background: rgba(15, 23, 42, 0.94);
      border: 1.5px solid var(--marker-color, #38bdf8);
      border-radius: 7px;
      padding: 3px 8px;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      line-height: 1.2;
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
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.7);
      white-space: nowrap;
    }

    .road-badge-marker.provincial {
      background: #d97706;
    }

    .road-badge-marker.scenic {
      background: #059669;
    }

    .road-badge-marker.lake {
      background: #0284c7;
    }

    /* Bottom Timeline Cards Section */
    .timeline-panel {
      position: relative;
      z-index: 1000;
      width: 1080px;
      height: 480px;
      padding: 16px 28px 20px 28px;
      background: linear-gradient(0deg, #0b111e 0%, #0b111ef2 85%, #0b111e00 100%);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .timeline-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .timeline-title {
      font-size: 15px;
      font-weight: 800;
      color: #f8fafc;
      letter-spacing: 1px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .timeline-rule-tag {
      font-size: 12px;
      font-weight: 700;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.18);
      border: 1px solid rgba(245, 158, 11, 0.4);
      padding: 2px 12px;
      border-radius: 12px;
    }

    .cards-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(2, 1fr);
      gap: 10px;
      flex-grow: 1;
    }

    .day-card {
      background: rgba(30, 41, 59, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .day-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: var(--card-color, #38bdf8);
    }

    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 3px;
    }

    .card-day-badge {
      font-size: 11px;
      font-weight: 900;
      color: #ffffff;
      background: var(--card-color, #38bdf8);
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }

    .card-date {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
    }

    .card-title {
      font-size: 13px;
      font-weight: 800;
      color: #f1f5f9;
      line-height: 1.25;
      margin-bottom: 3px;
      display: -webkit-box;
      -webkit-line-clamp: 1;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-highlight {
      font-size: 11px;
      color: #cbd5e1;
      line-height: 1.35;
      margin-bottom: 4px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .card-bottom {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 4px;
      border-top: 1px dashed rgba(255, 255, 255, 0.12);
      font-size: 10px;
      color: #94a3b8;
    }

    .card-stay {
      color: #fbbf24;
      font-weight: 700;
      max-width: 145px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .booked-tag {
      background: #059669;
      color: #ffffff;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      font-weight: 800;
    }

    .card-dist {
      color: #94a3b8;
      font-weight: 600;
    }

    /* Bottom Tips Banner */
    .bottom-tips-bar {
      margin-top: 8px;
      background: rgba(15, 23, 42, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 7px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #94a3b8;
    }

    .bottom-tips-bar strong {
      color: #fcd34d;
    }
  </style>
</head>
<body>
<div id="poster-root">
  <!-- Top Header -->
  <div class="header-panel">
    <div class="header-top-row">
      <div class="plan-badge">🚗 2026 国庆自驾 · PLAN B 臻选动线</div>
      <div class="flight-pill">
        <span>✈️ 广州 <strong>CAN</strong> ⇄ <strong>YIN / BPL</strong> 伊犁博乐双飞 · 不走回头路</span>
      </div>
    </div>
    <div class="header-main-title">新疆伊犁 · 8天7晚自驾大环线动线图</div>
    <div class="header-subtitle">
      <span>伊宁</span> <span class="arrow">➔</span>
      <span>昭苏玉湖</span> <span class="arrow">➔</span>
      <span>喀拉峻大草原</span> <span class="arrow">➔</span>
      <span>库尔德宁</span> <span class="arrow">➔</span>
      <span>唐布拉百里画廊</span> <span class="arrow">➔</span>
      <span>独库公路北段</span> <span class="arrow">➔</span>
      <span>赛里木湖</span> <span class="arrow">➔</span>
      <span>博乐市区</span>
    </div>
    <div class="header-chips">
      <div class="chip highlight">⏰ 每日建议出发 ≥ 10:00 (老人友好慢节奏)</div>
      <div class="chip cyan">👥 5人舒适家庭自驾游</div>
      <div class="chip">📅 2026.10.01 – 10.08</div>
      <div class="chip">🚗 全程自驾约 1,684 km</div>
      <div class="chip">🏔️ 喀拉峻连住2晚免搬箱</div>
    </div>
  </div>

  <!-- Map Canvas -->
  <div id="map-wrapper">
    <div id="map"></div>

    <!-- Map Layer Switcher -->
    <div class="map-layer-switcher">
      <button class="layer-btn active" onclick="switchLayer('terrain', this)">Google 地形图</button>
      <button class="layer-btn" onclick="switchLayer('roadmap', this)">Google 道路图</button>
      <button class="layer-btn" onclick="switchLayer('hybrid', this)">Google 卫星图</button>
    </div>

    <!-- Map Overlay Road Legend -->
    <div class="map-overlay-road-legend">
      <div class="legend-title">
        <span>沿途经典景观大道</span>
        <span style="font-size:10px; color:#38bdf8;">实测导航路网</span>
      </div>
      <div class="legend-item">
        <span class="road-shield-mini shield-g">G217</span>
        <span>独库公路北段 (翻天山·达坂3400m)</span>
      </div>
      <div class="legend-item">
        <span class="road-shield-mini shield-g">G577</span>
        <span>伊昭公路 / 天山新线特长隧道</span>
      </div>
      <div class="legend-item">
        <span class="road-shield-mini shield-s">S315</span>
        <span>唐布拉百里画廊 (十里花海林海)</span>
      </div>
      <div class="legend-item">
        <span class="road-shield-mini shield-blue">G30</span>
        <span>连霍高速 & 果子沟特大悬索桥</span>
      </div>
      <div class="legend-item">
        <span class="road-shield-mini shield-cyan">环湖路</span>
        <span>赛里木湖 87km 环湖全景自驾</span>
      </div>
    </div>

    <!-- Map Overlay Key Features -->
    <div class="map-overlay-features">
      <div class="legend-title">
        <span>行程核心景观地标</span>
        <span style="font-size:10px; color:#fbbf24;">TOP 亮点</span>
      </div>
      <div class="feature-row">
        <span class="feature-icon">🌊</span>
        <span><strong>昭苏玉湖</strong> 冰川峡谷蓝湖秘境</span>
      </div>
      <div class="feature-row">
        <span class="feature-icon">🏔️</span>
        <span><strong>喀拉峻</strong> 人体草原 & 阔克苏大峡谷</span>
      </div>
      <div class="feature-row">
        <span class="feature-icon">🌲</span>
        <span><strong>库尔德宁</strong> 世界自然遗产云杉林</span>
      </div>
      <div class="feature-row">
        <span class="feature-icon">🌉</span>
        <span><strong>果子沟金顶</strong> 俯瞰天山第一桥</span>
      </div>
      <div class="feature-row">
        <span class="feature-icon">💎</span>
        <span><strong>赛里木湖</strong> 环湖漫游 · 日落夕阳</span>
      </div>
    </div>

    <!-- Day color legend bar at bottom of map -->
    <div class="day-color-bar">
      <div class="day-dot-item"><span class="day-color-line" style="background: #747D8C;"></span>D1 抵伊宁</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #FF4757;"></span>D2 玉湖</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #2ED573;"></span>D3 喀拉峻</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #1E90FF;"></span>D4 慢玩</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #FFA502;"></span>D5 库尔德宁</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #9B59B6;"></span>D6 独库赛湖</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #00CEC9;"></span>D7 环湖博乐</div>
      <div class="day-dot-item"><span class="day-color-line" style="background: #FD79A8;"></span>D8 返广州</div>
    </div>
  </div>

  <!-- Bottom Timeline Cards -->
  <div class="timeline-panel">
    <div class="timeline-header-bar">
      <div class="timeline-title">
        <span>📅 8天每日动线与夜宿规划</span>
      </div>
      <div class="timeline-rule-tag">⭐ 全程每日出发建议 ≥ 10:00 · 轻松不赶路</div>
    </div>

    <div class="cards-grid" id="cards-container">
      <!-- Generated via JS -->
    </div>

    <div class="bottom-tips-bar">
      <div>💡 <strong>自驾出行贴士</strong>：独库公路受降雪与路况管制影响，D5晚及D6早查独库通行通告；若遇封路启动备选方案经G30直达赛湖。</div>
      <div><strong>制图数据</strong>：Google Map 地理与道路网络数据 · 真实导航动线</div>
    </div>
  </div>
</div>

<script>
const ROUTE_DATA = """ + json.dumps(route_data, ensure_ascii=False) + """;

let map;
let currentLayer;

const layers = {
  terrain: L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 18,
    opacity: 0.98
  }),
  roadmap: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 18,
    opacity: 0.98
  }),
  hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    subdomains: ['0', '1', '2', '3'],
    maxZoom: 18,
    opacity: 0.98
  })
};

function switchLayer(type, btn) {
  if (currentLayer) map.removeLayer(currentLayer);
  currentLayer = layers[type];
  currentLayer.addTo(map);

  document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

window.onload = function() {
  // Initialize Leaflet Map
  map = L.map('map', {
    zoomControl: false,
    attributionControl: false
  }).setView([43.92, 82.85], 8);

  currentLayer = layers.terrain;
  currentLayer.addTo(map);

  // Prepare bounds
  const bounds = L.latLngBounds([]);

  // Render Polylines for each day
  ROUTE_DATA.segments.forEach(seg => {
    if (!seg.coordinates || seg.coordinates.length === 0) return;

    // Convert [lon, lat] to Leaflet [lat, lon]
    const latlngs = seg.coordinates.map(c => [c[1], c[0]]);
    latlngs.forEach(ll => bounds.extend(ll));

    // Outer dark casing line for high contrast
    L.polyline(latlngs, {
      color: '#000000',
      weight: 8,
      opacity: 0.78,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Inner bright colored line
    L.polyline(latlngs, {
      color: seg.color,
      weight: 4.8,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  });

  // Fit bounds with balanced padding
  map.fitBounds(bounds, {
    paddingTopLeft: [70, 50],
    paddingBottomRight: [70, 50]
  });

  // Highway Shields / Badges
  if (ROUTE_DATA.highway_badges) {
    ROUTE_DATA.highway_badges.forEach(b => {
      let cls = 'road-badge-marker';
      if (b.road.startsWith('S')) cls += ' provincial';
      if (b.road.includes('桥')) cls += ' scenic';
      if (b.road.includes('环湖')) cls += ' lake';

      const icon = L.divIcon({
        className: 'custom-road-badge',
        html: `<div class="${cls}">🛣️ ${b.road}</div>`,
        iconSize: [84, 24],
        iconAnchor: [42, 12]
      });

      L.marker([b.coord[1], b.coord[0]], { icon: icon }).addTo(map);
    });
  }

  // Key POI / Waypoint Markers with smart directional layout
  const keyMarkers = [
    { name: "伊宁机场", tag: "D1 落地 23:10", coord: [81.330, 43.956], color: "#747D8C", icon: "✈️", type: "airport", layout: "left" },
    { name: "昭苏玉湖", tag: "D2 冰川蓝湖", coord: [80.887, 42.943], color: "#FF4757", icon: "🌊", hotel: "宿 望湖庄园(已订)", layout: "left" },
    { name: "喀拉峻大草原", tag: "D3-D4 阔克苏/鲜花台", coord: [82.023, 43.003], color: "#2ED573", icon: "🏔️", hotel: "宿 景区民宿(连住2晚)", layout: "right" },
    { name: "库尔德宁东沟", tag: "D5 云杉林 2.5h", coord: [82.855, 43.190], color: "#FFA502", icon: "🌲", layout: "left" },
    { name: "唐布拉百里画廊", tag: "D5 宿放蜂人家", coord: [83.275, 43.682], color: "#FFA502", icon: "🏕️", hotel: "宿 放蜂人家", layout: "left" },
    { name: "乔尔玛烈士陵园", tag: "独库北段起点", coord: [83.697, 43.667], color: "#9B59B6", icon: "🎖️", layout: "right" },
    { name: "哈希勒根达坂", tag: "3400m 防雪长廊", coord: [83.950, 44.050], color: "#9B59B6", icon: "❄️", layout: "right" },
    { name: "果子沟金顶大桥", tag: "天山奇观大桥", coord: [81.162, 44.482], color: "#2563eb", icon: "🌉", layout: "left" },
    { name: "赛里木湖", tag: "D6夕阳 / D7环湖", coord: [81.250, 44.600], color: "#00CEC9", icon: "💎", hotel: "D6宿 东门", layout: "right" },
    { name: "博乐市区", tag: "D7 宿全季酒店", coord: [82.072, 44.903], color: "#00CEC9", icon: "🏙️", hotel: "宿 全季酒店", layout: "left" },
    { name: "博乐阿拉山口机场", tag: "D8 12:00前还车飞广州", coord: [82.298, 44.895], color: "#FD79A8", icon: "✈️", type: "airport", layout: "right" }
  ];

  keyMarkers.forEach(m => {
    const isHotel = !!m.hotel;
    const tagText = m.hotel ? `${m.tag} · ${m.hotel}` : m.tag;
    const isLeft = m.layout === 'left';

    const markerHtml = `
      <div class="custom-marker ${isLeft ? 'left-layout' : ''}" style="--marker-color: ${m.color};">
        <div class="marker-pin">${m.icon}</div>
        <div class="marker-label-pill ${isHotel ? 'marker-hotel' : ''}">
          <span class="marker-name">${m.name}</span>
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

    L.marker([m.coord[1], m.coord[0]], { icon: customIcon }).addTo(map);
  });

  // Populate Bottom Timeline Cards
  const cardsContainer = document.getElementById('cards-container');
  ROUTE_DATA.segments.forEach(seg => {
    const card = document.createElement('div');
    card.className = 'day-card';
    card.style.setProperty('--card-color', seg.color);

    let stayText = '—';
    let isBooked = false;
    const hotelWp = seg.waypoints.find(w => w.stay);
    if (hotelWp) {
      stayText = hotelWp.hotel || hotelWp.name;
      if (seg.day === 'D1' || seg.day === 'D2') isBooked = true;
    } else if (seg.day === 'D8') {
      stayText = '飞返广州白云';
    }

    const bookedBadge = isBooked ? '<span class="booked-tag">已订</span>' : '';

    card.innerHTML = `
      <div>
        <div class="card-top">
          <span class="card-day-badge">${seg.day}</span>
          <span class="card-date">${seg.date}</span>
        </div>
        <div class="card-title">${seg.title}</div>
        <div class="card-highlight">${seg.highlight}</div>
      </div>
      <div class="card-bottom">
        <span class="card-stay">🏡 ${stayText} ${bookedBadge}</span>
        <span class="card-dist">🚗 ${seg.distance_km}km</span>
      </div>
    `;
    cardsContainer.appendChild(card);
  });

  window.mapReady = true;
};
</script>
</body>
</html>
"""

with open('/workspace/reports/maps/itinerary_map.html', 'w', encoding='utf-8') as f:
    f.write(html_template)

print("Updated /workspace/reports/maps/itinerary_map.html successfully!")
