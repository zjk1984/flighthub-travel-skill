import json

# Extended daily script with rich subtitles, scenic spots, roads, lunch, and tips
subtitles_and_routes = [
    {
        "day": "D1",
        "date": "10/1 周四",
        "title": "广州飞抵伊宁 · 提车入住",
        "theme": "航班落地 · 机场休整",
        "color": "#747D8C",
        "lunch": "机上简餐（23:10落地无正餐）",
        "roads": ["机场快速路"],
        "scenics": ["伊宁国际机场"],
        "subtitle": "【D1 抵疆休整】CZ6888 广州直飞23:10落地伊宁，机上简餐，租车备妥直接入住机场全季，免深夜长途奔波。",
        "subtitle_short": "23:10 落地伊宁机场 ➔ 宿机场全季酒店 (已订) · 免深夜赶路",
        "active_scenics": [
            {"name": "伊宁国际机场", "tag": "CZ6888 23:10落地", "coord": [81.330, 43.956], "icon": "✈️", "type": "airport", "layout": "left"}
        ],
        "active_roads": [
            {"road": "机场快速路", "coord": [81.328, 43.945], "type": "city"}
        ]
    },
    {
        "day": "D2",
        "date": "10/2 周五",
        "title": "伊昭公路 ➔ 昭苏 ➔ 梦幻玉湖",
        "theme": "伊昭盘山 · 梦幻玉湖",
        "color": "#FF4757",
        "lunch": "昭苏县城",
        "roads": ["S237 伊昭公路", "昭玉公路"],
        "scenics": ["白石峰观景台", "昭苏天马故乡", "昭苏玉湖景区"],
        "subtitle": "【D2 伊昭盘山】10:00出发沿S237伊昭公路翻越天山，昭苏县城午餐，白石峰可短停，游览玉湖，夜宿望湖庄园。",
        "subtitle_short": "10:00+出发 ➔ S237伊昭公路 ➔ 昭苏午餐 ➔ 玉湖 ➔ 宿望湖庄园 (已订)",
        "active_scenics": [
            {"name": "昭苏县城", "tag": "午餐 · 天马故乡", "coord": [81.130, 43.155], "icon": "🍽️", "type": "lunch", "layout": "left"},
            {"name": "白石峰观景台", "tag": "伊昭公路经典打卡", "coord": [81.080, 43.380], "icon": "⛰️", "type": "scenic", "layout": "left"},
            {"name": "昭苏玉湖", "tag": "冰川峡谷蓝湖 · 宿望湖庄园", "coord": [80.887, 42.943], "icon": "🌊", "hotel": "宿 望湖庄园 (已订)", "layout": "left"}
        ],
        "active_roads": [
            {"road": "S237 伊昭公路", "coord": [81.120, 43.460], "type": "provincial"}
        ]
    },
    {
        "day": "D3",
        "date": "10/3 周六",
        "title": "昭苏玉湖 ➔ 特昭公路 ➔ 喀拉峻 · 下午阔克苏",
        "theme": "直赴草原 · 下午阔克苏",
        "color": "#2ED573",
        "lunch": "特克斯县城",
        "roads": ["S237 特昭公路", "阔克苏观光道"],
        "scenics": ["特克斯八卦城", "阔克苏大峡谷", "鳄鱼湾", "人体草原"],
        "subtitle": "【D3 阔克苏下午场】10:00退房经S237特昭公路直赴喀拉峻，特克斯县城午餐，下午游览阔克苏鳄鱼湾与人体草原，宿山涧云海民宿(已订)。",
        "subtitle_short": "10:00+退房 ➔ 特克斯午餐 ➔ 下午阔克苏鳄鱼湾 ➔ 宿山涧云海民宿 (已订 · 连住第1晚)",
        "active_scenics": [
            {"name": "特克斯县城", "tag": "午餐 · 八卦城", "coord": [81.838, 43.212], "icon": "🍽️", "type": "lunch", "layout": "right"},
            {"name": "阔克苏鳄鱼湾", "tag": "下午峡谷人体草原", "coord": [82.160, 43.030], "icon": "🐊", "type": "scenic", "layout": "left"},
            {"name": "山涧云海民宿", "tag": "连住免搬箱", "coord": [82.023, 43.003], "icon": "🏔️", "hotel": "宿 山涧云海民宿 (已订)", "layout": "right"}
        ],
        "active_roads": [
            {"road": "S237 特昭公路", "coord": [81.420, 43.160], "type": "provincial"}
        ]
    },
    {
        "day": "D4",
        "date": "10/4 周日",
        "title": "东喀拉峻 · 西喀拉峻 全天慢玩",
        "theme": "东西两线 · 深度慢游",
        "color": "#1E90FF",
        "lunch": "喀拉峻游客中心/自带",
        "roads": ["喀拉峻全景公路", "东线观光道", "西线观光道"],
        "scenics": ["东喀拉峻鲜花台", "猎鹰台", "西喀拉峻人体草原", "九曲十八弯"],
        "subtitle": "【D4 东西喀拉峻】10:00慢起，景区内午餐后全天游览东喀拉峻鲜花台/猎鹰台与西喀拉峻人体草原，续住山涧云海民宿(已订)。",
        "subtitle_short": "10:00+慢起 ➔ 喀拉峻午餐 ➔ 东/西喀拉峻 ➔ 续住山涧云海民宿 (已订)",
        "active_scenics": [
            {"name": "喀拉峻游客中心", "tag": "午餐 · 景区内", "coord": [82.050, 43.010], "icon": "🍽️", "type": "lunch", "layout": "right"},
            {"name": "东喀拉峻猎鹰台", "tag": "鲜花台/立体草原", "coord": [82.240, 43.040], "icon": "🦅", "type": "scenic", "layout": "right"},
            {"name": "西喀拉峻人体草原", "tag": "九曲十八弯", "coord": [82.080, 42.980], "icon": "🏔️", "type": "scenic", "layout": "left"}
        ],
        "active_roads": [
            {"road": "喀拉峻全景公路", "coord": [82.120, 43.020], "type": "scenic"}
        ]
    },
    {
        "day": "D5",
        "date": "10/5 周一",
        "title": "喀拉峻 ➔ 巩留 ➔ 唐布拉",
        "theme": "百里画廊 · 直抵唐布拉",
        "color": "#FFA502",
        "lunch": "巩留县城",
        "roads": ["S242", "S315 唐布拉百里画廊"],
        "scenics": ["巩留县城", "尼勒克转场", "唐布拉百里画廊"],
        "subtitle": "【D5 直赴唐布拉】10:00喀拉峻退房，巩留午餐后沿S315百里画廊经尼勒克直抵唐布拉，宿放蜂人家，晚查独库路况。",
        "subtitle_short": "10:00+出发 ➔ 巩留午餐 ➔ S315百里画廊 ➔ 宿唐布拉放蜂人家",
        "active_scenics": [
            {"name": "巩留县城", "tag": "午餐", "coord": [82.235, 43.484], "icon": "🍽️", "type": "lunch", "layout": "left"},
            {"name": "唐布拉百里画廊", "tag": "十里花海小华山", "coord": [83.275, 43.682], "icon": "🏕️", "hotel": "宿 放蜂人家", "layout": "left"}
        ],
        "active_roads": [
            {"road": "S315 百里画廊", "coord": [83.050, 43.620], "type": "provincial"}
        ]
    },
    {
        "day": "D6",
        "date": "10/6 周二",
        "title": "唐布拉 ➔ G217独库北段 ➔ 赛湖",
        "theme": "G217独库 · 果子沟金顶",
        "color": "#9B59B6",
        "lunch": "乔尔玛",
        "roads": ["S315", "G217 独库北段", "G30 连霍高速"],
        "scenics": ["G217独库北段", "乔尔玛烈士陵园", "哈希勒根3400m", "果子沟金顶大桥", "赛里木湖南门"],
        "subtitle": "【D6 G217独库抵赛湖】10:00唐布拉出发，乔尔玛午餐后走G217独库北段翻越3400m哈希勒根，转G30经果子沟金顶，南门入赛湖看日落。",
        "subtitle_short": "10:00+出发 ➔ 乔尔玛午餐 ➔ G217独库北段(3400m) ➔ 果子沟 ➔ 赛湖南门进/东门宿",
        "active_scenics": [
            {"name": "乔尔玛", "tag": "午餐 · 独库起点", "coord": [83.697, 43.667], "icon": "🍽️", "type": "lunch", "layout": "right"},
            {"name": "哈希勒根达坂", "tag": "3400m 防雪长廊", "coord": [83.950, 44.050], "icon": "❄️", "type": "scenic", "layout": "right"},
            {"name": "果子沟金顶大桥", "tag": "天山奇观特大悬索桥", "coord": [81.162, 44.482], "icon": "🌉", "type": "scenic", "layout": "left"},
            {"name": "赛里木湖南门", "tag": "南门入园赏大西洋眼泪", "coord": [81.183, 44.542], "icon": "💎", "type": "scenic", "layout": "left"}
        ],
        "active_roads": [
            {"road": "G217 独库北段", "coord": [83.780, 43.670], "type": "national"},
            {"road": "G217 独库北段", "coord": [84.150, 43.900], "type": "national"},
            {"road": "G30 连霍高速", "coord": [82.500, 44.580], "type": "highway"}
        ]
    },
    {
        "day": "D7",
        "date": "10/7 周三",
        "title": "赛里木湖环湖深度游 ➔ 博乐",
        "theme": "大西洋眼泪 · 环湖87km",
        "color": "#00CEC9",
        "lunch": "赛湖东门高白鲑鱼坊",
        "roads": ["赛里木湖87km景区环湖路", "G30 连霍高速", "S205 博乐线"],
        "scenics": ["赛里木湖点将台", "松树头", "克勒涌珠", "博乐市区"],
        "subtitle": "【D7 赛湖全景环游】10:00东门高白鲑午餐后环湖：点将台、松树头、克勒涌珠，下午驶往博乐市区宿全季。",
        "subtitle_short": "10:00+东门高白鲑午餐 ➔ 赛湖87km环湖 ➔ 博乐全季酒店",
        "active_scenics": [
            {"name": "赛湖高白鲑鱼坊", "tag": "午餐 · 高白鲑", "coord": [81.340, 44.615], "icon": "🍽️", "type": "lunch", "layout": "left"},
            {"name": "赛里木湖点将台", "tag": "西海草原 · 天鹅近拍", "coord": [81.140, 44.610], "icon": "🦢", "type": "scenic", "layout": "left"},
            {"name": "克勒涌珠", "tag": "雪山清泉融水圣境", "coord": [81.250, 44.670], "icon": "✨", "type": "scenic", "layout": "right"},
            {"name": "博乐市区", "tag": "D7夜宿", "coord": [82.072, 44.903], "icon": "🏙️", "hotel": "宿 全季博乐酒店", "layout": "left"}
        ],
        "active_roads": [
            {"road": "赛湖 87km 环湖路", "coord": [81.240, 44.590], "type": "lake"}
        ]
    },
    {
        "day": "D8",
        "date": "10/8 周四",
        "title": "博乐市区短逛 ➔ 机场还车 ✈️ 广州",
        "theme": "轻松还车 · 飞返羊城",
        "color": "#FD79A8",
        "lunch": "博乐友好商圈",
        "roads": ["博乐城市主干道", "G219 机场快速路"],
        "scenics": ["博乐友好商圈", "滨河公园", "博乐阿拉山口机场"],
        "subtitle": "【D8 轻松收官返程】10:00博乐友好商圈早午餐短逛，11:30前抵达阿拉山口机场还车，MU6170 13:30起飞返广州。",
        "subtitle_short": "10:00友好商圈早午餐 ➔ 11:30前机场还车 ➔ MU6170 13:30返穗",
        "active_scenics": [
            {"name": "博乐友好商圈", "tag": "早午餐", "coord": [82.072, 44.903], "icon": "🍽️", "type": "lunch", "layout": "left"},
            {"name": "博乐阿拉山口机场", "tag": "11:30前还车 · MU6170起飞", "coord": [82.298, 44.895], "icon": "✈️", "type": "airport", "layout": "right"}
        ],
        "active_roads": [
            {"road": "G219 机场路", "coord": [82.180, 44.900], "type": "city"}
        ]
    }
]

with open('/workspace/data/subtitles_data.json', 'w', encoding='utf-8') as f:
    json.dump(subtitles_and_routes, f, ensure_ascii=False, indent=2)

print("Created /workspace/data/subtitles_data.json successfully!")
