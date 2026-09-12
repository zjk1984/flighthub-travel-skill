import json
import time
import urllib.request
import sys

def fetch_osrm_route(coords):
    coords_str = ';'.join(f'{c[0]},{c[1]}' for c in coords)
    url = f'https://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson'
    req = urllib.request.Request(url, headers={'User-Agent': 'TravelSkillBot/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data['code'] == 'Ok':
                r = data['routes'][0]
                return {
                    'distance_km': round(r['distance'] / 1000.0, 1),
                    'duration_hours': round(r['duration'] / 3600.0, 1),
                    'coordinates': r['geometry']['coordinates']
                }
    except Exception as e:
        print(f"OSRM error: {e}", file=sys.stderr)
    return None

segments_def = [
    {
        "day": "D1",
        "date": "10/1 周四",
        "title": "广州飞抵伊宁 · 入住机场全季",
        "theme": "航班落地 · 提车备妥",
        "color": "#747D8C",
        "glow": "rgba(116, 125, 140, 0.4)",
        "highlight": "CZ6888 23:10落地，宿机场全季，免深夜赶路",
        "lunch": "机上简餐（23:10落地无正餐）",
        "road": "机场快速路",
        "waypoints": [
            {"id": "w1_1", "name": "伊宁国际机场", "coord": [81.330, 43.956], "type": "airport", "tag": "落地 23:10", "stay": False},
            {"id": "w1_2", "name": "全季伊宁机场酒店", "coord": [81.325, 43.935], "type": "hotel", "tag": "D1宿 (已订)", "stay": True, "hotel": "全季酒店(机场店)"}
        ],
        "route_pts": [(81.330, 43.956), (81.325, 43.935)]
    },
    {
        "day": "D2",
        "date": "10/2 周五",
        "title": "S237伊昭公路 ➔ 昭苏 ➔ 望湖庄园",
        "theme": "伊昭盘山 · 梦幻玉湖",
        "color": "#FF4757",
        "glow": "rgba(255, 71, 87, 0.4)",
        "highlight": "10:00出发(当地8点节奏)，13:30昭苏午餐，下午玉湖，日落约20:15，宿望湖庄园",
        "lunch": "昭苏县城（13:30–14:30）",
        "road": "S237 伊昭公路 · 昭玉公路",
        "waypoints": [
            {"id": "w2_1", "name": "伊宁市区", "coord": [81.325, 43.935], "type": "city", "tag": "10:00+出发", "stay": False},
            {"id": "w2_2", "name": "白石峰观景台", "coord": [81.080, 43.380], "type": "scenic", "tag": "伊昭公路打卡", "stay": False},
            {"id": "w2_3", "name": "昭苏县城", "coord": [81.130, 43.155], "type": "lunch", "tag": "13:30午餐 · 天马故乡", "stay": False},
            {"id": "w2_4", "name": "昭苏玉湖", "coord": [80.887, 42.943], "type": "scenic", "tag": "冰川峡谷蓝湖", "stay": False},
            {"id": "w2_5", "name": "望湖庄园", "coord": [80.890, 42.945], "type": "hotel", "tag": "D2宿 (已订)", "stay": True, "hotel": "望湖庄园"}
        ],
        "route_pts": [(81.325, 43.935), (81.080, 43.380), (81.130, 43.155), (80.887, 42.943)]
    },
    {
        "day": "D3",
        "date": "10/3 周六",
        "title": "昭苏玉湖 ➔ 特昭路 ➔ 喀拉峻 · 下午西喀拉峻",
        "theme": "直赴草原 · 下午西线",
        "color": "#2ED573",
        "glow": "rgba(46, 213, 115, 0.4)",
        "highlight": "10:00出发，13:30特克斯午餐，下午西喀拉峻人体草原，宿山涧云海民宿 (已订 · 连住2晚)",
        "lunch": "特克斯县城（13:30–14:30）",
        "road": "S237 特昭公路 · 喀拉峻西线",
        "waypoints": [
            {"id": "w3_1", "name": "昭苏玉湖", "coord": [80.887, 42.943], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w3_2", "name": "特克斯县城", "coord": [81.838, 43.212], "type": "lunch", "tag": "13:30午餐 · 八卦城", "stay": False},
            {"id": "w3_3", "name": "西喀拉峻人体草原", "coord": [82.080, 42.980], "type": "scenic", "tag": "下午九曲十八弯", "stay": False},
            {"id": "w3_4", "name": "山涧云海民宿", "coord": [82.023, 43.003], "type": "hotel", "tag": "D3宿 (已订 · 连住第1晚)", "stay": True, "hotel": "山涧云海民宿"}
        ],
        "route_pts": [(80.887, 42.943), (81.130, 43.155), (81.838, 43.212), (82.080, 42.980), (82.023, 43.003)]
    },
    {
        "day": "D4",
        "date": "10/4 周日",
        "title": "东喀拉峻 · 全天深度",
        "theme": "东线专场 · 鲜花台猎鹰台",
        "color": "#1E90FF",
        "glow": "rgba(30, 144, 255, 0.4)",
        "highlight": "10:00东喀拉峻全天，13:00景区午餐，下午继续东线，宿山涧云海民宿 (已订续住第2晚)",
        "lunch": "喀拉峻游客中心（13:00–14:00）",
        "road": "喀拉峻东线观光道",
        "waypoints": [
            {"id": "w4_0", "name": "喀拉峻游客中心", "coord": [82.050, 43.010], "type": "lunch", "tag": "13:00午餐 · 景区内", "stay": False},
            {"id": "w4_1", "name": "东喀拉峻猎鹰台", "coord": [82.240, 43.040], "type": "scenic", "tag": "鲜花台/立体草原", "stay": False},
            {"id": "w4_2", "name": "东喀拉峻鲜花台", "coord": [82.220, 43.030], "type": "scenic", "tag": "下午补点", "stay": False},
            {"id": "w4_3", "name": "山涧云海民宿", "coord": [82.023, 43.003], "type": "hotel", "tag": "D4续住 (已订 · 连住第2晚)", "stay": True, "hotel": "山涧云海民宿"}
        ],
        "route_pts": [(82.023, 43.003), (82.240, 43.040), (82.220, 43.030), (82.023, 43.003)]
    },
    {
        "day": "D5",
        "date": "10/5 周一",
        "title": "喀拉峻 ➔ 巩留 ➔ 唐布拉",
        "theme": "百里画廊 · 直抵唐布拉",
        "color": "#FFA502",
        "glow": "rgba(255, 165, 2, 0.4)",
        "highlight": "13:30巩留午餐后沿S315赴种蜂场，18:30前抵达，宿小满民宿(已订)",
        "lunch": "巩留县城（13:30–14:30）",
        "road": "S242 · S315 唐布拉百里画廊",
        "waypoints": [
            {"id": "w5_1", "name": "喀拉峻", "coord": [82.023, 43.003], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w5_2", "name": "巩留县城", "coord": [82.235, 43.484], "type": "lunch", "tag": "13:30午餐", "stay": False},
            {"id": "w5_3", "name": "尼勒克县", "coord": [82.503, 43.818], "type": "pass", "tag": "S315转场", "stay": False},
            {"id": "w5_4", "name": "伊犁尼勒克小满民宿", "coord": [82.850, 43.760], "type": "hotel", "tag": "D5宿 (小满·已订)", "stay": True, "hotel": "小满民宿"}
        ],
        "route_pts": [(82.023, 43.003), (82.235, 43.484), (82.503, 43.818), (82.850, 43.760)]
    },
    {
        "day": "D6",
        "date": "10/6 周二",
        "title": "唐布拉 ➔ G217独库北段 ➔ 赛湖",
        "theme": "G217独库 · 果子沟金顶",
        "color": "#9B59B6",
        "glow": "rgba(155, 89, 182, 0.4)",
        "highlight": "13:00乔尔玛午餐，G217独库北段，19:30前到湖边，赛湖日落约20:05",
        "lunch": "乔尔玛（13:00–14:00）",
        "road": "S315 · G217 独库北段 · G30 连霍",
        "waypoints": [
            {"id": "w6_1", "name": "唐布拉百里画廊", "coord": [83.275, 43.682], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w6_2", "name": "G217独库北段", "coord": [83.780, 43.670], "type": "road", "tag": "唐布拉→赛湖", "stay": False},
            {"id": "w6_3", "name": "乔尔玛", "coord": [83.697, 43.667], "type": "lunch", "tag": "13:00午餐 · 独库起点", "stay": False},
            {"id": "w6_4", "name": "哈希勒根达坂", "coord": [83.950, 44.050], "type": "pass", "tag": "3400m 防雪长廊", "stay": False},
            {"id": "w6_5", "name": "果子沟金顶大桥", "coord": [81.162, 44.482], "type": "scenic", "tag": "天山奇观大桥", "stay": False},
            {"id": "w6_6", "name": "赛湖东门新游客中心", "coord": [81.348, 44.622], "type": "scenic", "tag": "东门入园（南门只出不进）", "stay": False},
            {"id": "w6_7", "name": "赛湖东门", "coord": [81.348, 44.622], "type": "hotel", "tag": "D6-D7连宿 · 日落~20:05", "stay": True, "hotel": "赛湖东门客栈"}
        ],
        "route_pts": [(83.275, 43.682), (83.697, 43.667), (84.882, 44.327), (81.162, 44.482), (81.348, 44.622)]
    },
    {
        "day": "D7",
        "date": "10/7 周三",
        "title": "赛里木湖深度环湖",
        "theme": "大西洋眼泪 · 环湖87km",
        "color": "#00CEC9",
        "glow": "rgba(0, 206, 201, 0.4)",
        "highlight": "10:00环湖点将台/松树头，13:30东门高白鲑午餐，下午克勒涌珠，17:00前回东门连住第2晚",
        "lunch": "赛湖东门高白鲑（13:30–14:30）",
        "road": "赛湖环湖路",
        "waypoints": [
            {"id": "w7_0", "name": "赛湖高白鲑鱼坊", "coord": [81.340, 44.615], "type": "lunch", "tag": "13:30午餐 · 高白鲑", "stay": False},
            {"id": "w7_1", "name": "赛湖东门", "coord": [81.348, 44.622], "type": "hotel", "tag": "10:00+环湖 · 连住第2晚", "stay": True, "hotel": "赛湖东门客栈"},
            {"id": "w7_2", "name": "点将台/西海", "coord": [81.140, 44.610], "type": "scenic", "tag": "蓝冰天鹅", "stay": False},
            {"id": "w7_3", "name": "克勒涌珠", "coord": [81.250, 44.670], "type": "scenic", "tag": "雪山清泉", "stay": False}
        ],
        "route_pts": [(81.348, 44.622), (81.183, 44.542), (81.140, 44.610), (81.250, 44.670), (81.348, 44.622)]
    },
    {
        "day": "D8",
        "date": "10/8 周四",
        "title": "赛湖东门 ➔ 机场还车 ✈️ 广州",
        "theme": "东门短停 · 飞返羊城",
        "color": "#FD79A8",
        "glow": "rgba(253, 121, 168, 0.4)",
        "highlight": "08:00–09:30东门短停，09:30出发(约1.5–2h)，12:00前机场还车，MU6170 13:30起飞",
        "lunch": "东门/路上简餐（08:00–09:00）",
        "road": "G30 · G219 机场路",
        "waypoints": [
            {"id": "w8_1", "name": "赛湖东门", "coord": [81.348, 44.622], "type": "scenic", "tag": "08:00–09:30短停", "stay": False},
            {"id": "w8_2", "name": "博乐阿拉山口机场", "coord": [82.298, 44.895], "type": "airport", "tag": "还车飞返 (13:30)", "stay": False}
        ],
        "route_pts": [(81.348, 44.622), (82.298, 44.895)]
    }
]

results = []
total_km = 0

for seg in segments_def:
    print(f"Fetching route for {seg['day']}...")
    if "multi_legs" in seg:
        all_coords = []
        seg_dist = 0
        seg_dur = 0
        for leg_pts in seg["multi_legs"]:
            r = fetch_osrm_route(leg_pts)
            if r:
                all_coords.extend(r['coordinates'])
                seg_dist += r['distance_km']
                seg_dur += r['duration_hours']
            time.sleep(0.3)
        seg['distance_km'] = round(seg_dist, 1)
        seg['duration_hours'] = round(seg_dur, 1)
        seg['coordinates'] = all_coords
        total_km += seg['distance_km']
        print(f"  -> {seg['day']} (multi-leg): {seg['distance_km']} km, {len(all_coords)} points")
    else:
        pts = seg["route_pts"]
        r = fetch_osrm_route(pts)
        if r:
            seg['distance_km'] = r['distance_km']
            seg['duration_hours'] = r['duration_hours']
            seg['coordinates'] = r['coordinates']
            total_km += r['distance_km']
            print(f"  -> {seg['day']}: {r['distance_km']} km, {len(r['coordinates'])} points")
        else:
            seg['distance_km'] = 50.0
            seg['duration_hours'] = 1.0
            seg['coordinates'] = pts
            print(f"  -> {seg['day']}: Fallback")
        time.sleep(0.3)
    results.append(seg)

# Highway badges coordinates
highway_badges = [
    {"road": "S237", "name": "伊昭公路", "coord": [81.08, 43.40], "color": "#FF4757"},
    {"road": "S237", "name": "特昭公路", "coord": [81.45, 43.18], "color": "#2ED573"},
    {"road": "S315", "name": "唐布拉百里画廊", "coord": [83.05, 43.62], "color": "#FFA502"},
    {"road": "G217", "name": "唐布拉→赛湖·独库北段", "coord": [83.78, 43.67], "color": "#9B59B6"},
    {"road": "G217", "name": "哈希勒根达坂3400m", "coord": [84.15, 43.90], "color": "#9B59B6"},
    {"road": "G30", "name": "连霍高速", "coord": [82.50, 44.58], "color": "#3498DB"},
    {"road": "果子沟大桥", "name": "特大悬索桥观景台", "coord": [81.16, 44.48], "color": "#E67E22"},
    {"road": "赛湖环湖路", "name": "环湖87km观光线", "coord": [81.24, 44.60], "color": "#00CEC9"}
]

out_data = {
    "title": "2026国庆新疆伊犁8天7晚自驾大环线",
    "subtitle": "伊宁 ➔ 昭苏玉湖 ➔ 喀拉峻(西线+东线) ➔ 唐布拉 ➔ 独库公路 ➔ 赛里木湖 ➔ 博乐",
    "date_range": "2026.10.01 - 2026.10.08",
    "total_distance_km": round(total_km, 1),
    "segments": results,
    "highway_badges": highway_badges,
    "flights": [
        {
            "type": "outbound",
            "flight_no": "CZ6888 / CZ6827",
            "airline": "中国南方航空",
            "desc": "广州 ✈️ 伊宁 (23:10 落地)",
            "from_city": "广州白云 (CAN)",
            "to_city": "伊宁国际 (YIN)",
            "to_coord": [81.330, 43.956]
        },
        {
            "type": "inbound",
            "flight_no": "MU6170 / MU2311",
            "airline": "中国东方航空",
            "desc": "博乐 ✈️ 广州 (13:30 起飞)",
            "from_city": "博乐阿拉山口 (BPL)",
            "to_city": "广州白云 (CAN)",
            "from_coord": [82.298, 44.895]
        }
    ]
}

with open('/workspace/data/route_data.json', 'w', encoding='utf-8') as f:
    json.dump(out_data, f, ensure_ascii=False, indent=2)

print(f"Data updated successfully! Total distance: {total_km:.1f} km")
