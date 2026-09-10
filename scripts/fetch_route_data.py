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
        "title": "G577翻越天山 ➔ 昭苏 ➔ 玉湖",
        "theme": "翻越天山 · 梦幻玉湖",
        "color": "#FF4757",
        "glow": "rgba(255, 71, 87, 0.4)",
        "highlight": "10:00+出发，走G577特长隧道穿越天山，宿玉湖旁望湖庄园",
        "road": "G577 · 昭玉公路",
        "waypoints": [
            {"id": "w2_1", "name": "伊宁市区", "coord": [81.325, 43.935], "type": "city", "tag": "10:00+出发", "stay": False},
            {"id": "w2_2", "name": "昭苏县", "coord": [81.130, 43.155], "type": "pass", "tag": "天马故乡", "stay": False},
            {"id": "w2_3", "name": "昭苏玉湖", "coord": [80.887, 42.943], "type": "scenic", "tag": "冰川峡谷蓝湖", "stay": False},
            {"id": "w2_4", "name": "望湖庄园", "coord": [80.890, 42.945], "type": "hotel", "tag": "D2宿 (已订)", "stay": True, "hotel": "望湖庄园"}
        ],
        "route_pts": [(81.325, 43.935), (81.130, 43.155), (80.887, 42.943)]
    },
    {
        "day": "D3",
        "date": "10/3 周六",
        "title": "昭苏玉湖 ➔ 特昭路 ➔ 直赴喀拉峻",
        "theme": "直赴草原 · 连住免搬",
        "color": "#2ED573",
        "glow": "rgba(46, 213, 115, 0.4)",
        "highlight": "10:00+退房直奔喀拉峻，不经县城过夜，宿草原民宿",
        "road": "S237 特昭公路",
        "waypoints": [
            {"id": "w3_1", "name": "昭苏玉湖", "coord": [80.887, 42.943], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w3_2", "name": "特克斯外围", "coord": [81.838, 43.212], "type": "pass", "tag": "不进城过夜", "stay": False},
            {"id": "w3_3", "name": "喀拉峻景区/民宿", "coord": [82.023, 43.003], "type": "hotel", "tag": "D3宿 (连住2晚)", "stay": True, "hotel": "喀拉峻民宿"}
        ],
        "route_pts": [(80.887, 42.943), (81.130, 43.155), (81.838, 43.212), (82.023, 43.003)]
    },
    {
        "day": "D4",
        "date": "10/4 周日",
        "title": "喀拉峻全天慢玩 · 阔克苏大峡谷",
        "theme": "人体草原 · 深度慢游",
        "color": "#1E90FF",
        "glow": "rgba(30, 144, 255, 0.4)",
        "highlight": "10:00+慢起，东喀拉峻鲜花台+阔克苏大峡谷鳄鱼湾，续住第2晚",
        "road": "喀拉峻全景公路",
        "waypoints": [
            {"id": "w4_1", "name": "阔克苏大峡谷", "coord": [82.160, 43.030], "type": "scenic", "tag": "鳄鱼湾/人体草原", "stay": False},
            {"id": "w4_2", "name": "东喀拉峻猎鹰台", "coord": [82.240, 43.040], "type": "scenic", "tag": "立体草原全景", "stay": False},
            {"id": "w4_3", "name": "喀拉峻民宿", "coord": [82.023, 43.003], "type": "hotel", "tag": "D4续住 (第2晚)", "stay": True, "hotel": "喀拉峻民宿"}
        ],
        "route_pts": [(82.023, 43.003), (82.160, 43.030), (82.240, 43.040), (82.023, 43.003)]
    },
    {
        "day": "D5",
        "date": "10/5 周一",
        "title": "喀拉峻 ➔ 库尔德宁轻游 ➔ 唐布拉",
        "theme": "雪山云杉 · 百里画廊",
        "color": "#FFA502",
        "glow": "rgba(255, 165, 2, 0.4)",
        "highlight": "库尔德宁轻游2.5h (16:30前离园)，S315百里画廊晚霞，宿唐布拉",
        "road": "S242 · X723 · S315",
        "waypoints": [
            {"id": "w5_1", "name": "喀拉峻", "coord": [82.023, 43.003], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w5_2", "name": "巩留县城", "coord": [82.235, 43.484], "type": "city", "tag": "午餐整备", "stay": False},
            {"id": "w5_3", "name": "库尔德宁东沟", "coord": [82.855, 43.190], "type": "scenic", "tag": "世界遗产云杉林", "stay": False},
            {"id": "w5_4", "name": "唐布拉百里画廊", "coord": [83.275, 43.682], "type": "hotel", "tag": "D5宿 (放蜂人家)", "stay": True, "hotel": "放蜂人家民宿"}
        ],
        "route_pts": [(82.023, 43.003), (82.235, 43.484), (82.855, 43.190), (83.275, 43.682)]
    },
    {
        "day": "D6",
        "date": "10/6 周二",
        "title": "唐布拉 ➔ 独库北段 ➔ 果子沟 ➔ 赛湖",
        "theme": "独库天险 · 果子沟金顶",
        "color": "#9B59B6",
        "glow": "rgba(155, 89, 182, 0.4)",
        "highlight": "独库北段翻越哈希勒根防雪长廊(3400m)，果子沟金顶，赛湖看日落",
        "road": "S315 · G217 独库北段 · G30 连霍",
        "waypoints": [
            {"id": "w6_1", "name": "唐布拉百里画廊", "coord": [83.275, 43.682], "type": "scenic", "tag": "10:00+出发", "stay": False},
            {"id": "w6_2", "name": "乔尔玛", "coord": [83.697, 43.667], "type": "pass", "tag": "独库纪念碑", "stay": False},
            {"id": "w6_3", "name": "哈希勒根达坂", "coord": [83.950, 44.050], "type": "pass", "tag": "3400m 防雪长廊", "stay": False},
            {"id": "w6_4", "name": "果子沟金顶大桥", "coord": [81.162, 44.482], "type": "scenic", "tag": "天山奇观大桥", "stay": False},
            {"id": "w6_5", "name": "赛里木湖南门", "coord": [81.183, 44.542], "type": "scenic", "tag": "南门入园", "stay": False},
            {"id": "w6_6", "name": "赛湖东门", "coord": [81.348, 44.622], "type": "hotel", "tag": "D6宿 (看日落)", "stay": True, "hotel": "赛湖东门客栈"}
        ],
        "route_pts": [(83.275, 43.682), (83.697, 43.667), (84.882, 44.327), (81.162, 44.482), (81.348, 44.622)]
    },
    {
        "day": "D7",
        "date": "10/7 周三",
        "title": "赛里木湖深度环湖 ➔ 博乐市区",
        "theme": "大西洋眼泪 · 环湖87km",
        "color": "#00CEC9",
        "glow": "rgba(0, 206, 201, 0.4)",
        "highlight": "10:00+入园，点将台、松树头、克勒涌珠全环湖，下午赴博乐宿全季",
        "road": "赛湖环湖路 · G30 · S205",
        "waypoints": [
            {"id": "w7_1", "name": "赛湖东门", "coord": [81.348, 44.622], "type": "hotel", "tag": "10:00+环湖", "stay": False},
            {"id": "w7_2", "name": "点将台/西海", "coord": [81.140, 44.610], "type": "scenic", "tag": "蓝冰天鹅", "stay": False},
            {"id": "w7_3", "name": "克勒涌珠", "coord": [81.250, 44.670], "type": "scenic", "tag": "雪山清泉", "stay": False},
            {"id": "w7_4", "name": "博乐市区", "coord": [82.072, 44.903], "type": "city", "tag": "D7宿 (全季酒店)", "stay": True, "hotel": "全季博乐酒店"}
        ],
        # Combine loop around lake + road to Bole
        "multi_legs": [
            [(81.348, 44.622), (81.183, 44.542), (81.140, 44.610), (81.250, 44.670), (81.348, 44.622)],
            [(81.348, 44.622), (82.072, 44.903)]
        ]
    },
    {
        "day": "D8",
        "date": "10/8 周四",
        "title": "博乐市区短逛 ➔ 机场还车 ✈️ 广州",
        "theme": "轻松还车 · 飞返羊城",
        "color": "#FD79A8",
        "glow": "rgba(253, 121, 168, 0.4)",
        "highlight": "10:00逛商圈，11:30前到机场还车，MU6170 13:30起飞",
        "road": "博乐快速路 · G219",
        "waypoints": [
            {"id": "w8_1", "name": "博乐市区", "coord": [82.072, 44.903], "type": "city", "tag": "10:00短逛", "stay": False},
            {"id": "w8_2", "name": "博乐阿拉山口机场", "coord": [82.298, 44.895], "type": "airport", "tag": "还车飞返 (13:30)", "stay": False}
        ],
        "route_pts": [(82.072, 44.903), (82.298, 44.895)]
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
    {"road": "G577", "name": "伊昭公路/天山隧道", "coord": [81.08, 43.40], "color": "#FF4757"},
    {"road": "S237", "name": "特昭公路", "coord": [81.45, 43.18], "color": "#2ED573"},
    {"road": "S315", "name": "唐布拉百里画廊", "coord": [83.05, 43.62], "color": "#FFA502"},
    {"road": "G217", "name": "独库公路北段(哈希勒根)", "coord": [84.15, 43.90], "color": "#9B59B6"},
    {"road": "G30", "name": "连霍高速", "coord": [82.50, 44.58], "color": "#3498DB"},
    {"road": "果子沟大桥", "name": "特大悬索桥观景台", "coord": [81.16, 44.48], "color": "#E67E22"},
    {"road": "赛湖环湖路", "name": "环湖87km观光线", "coord": [81.24, 44.60], "color": "#00CEC9"}
]

out_data = {
    "title": "2026国庆新疆伊犁8天7晚自驾大环线",
    "subtitle": "伊宁 ➔ 昭苏玉湖 ➔ 喀拉峻 ➔ 库尔德宁 ➔ 唐布拉 ➔ 独库公路 ➔ 赛里木湖 ➔ 博乐",
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
