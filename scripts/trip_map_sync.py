"""Sync map/video segment metadata from config/trip-profile.json."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRIP_PATH = ROOT / "config" / "trip-profile.json"


def load_trip():
    with open(TRIP_PATH, encoding="utf-8") as f:
        return json.load(f)


def strip_md(text):
    return re.sub(r"\*\*", "", text or "").strip()


def day_by_card(trip, card_id):
    for day in trip.get("itinerary", {}).get("days", []):
        if day.get("cardId") == card_id:
            return day
    return None


def hotel_override_for_card(trip, card_id):
    day = day_by_card(trip, card_id)
    if not day:
        return None
    overrides = trip.get("hotelOverrides", {})
    override = overrides.get(day["date"])
    if override:
        return override
    if card_id == "D7":
        return overrides.get("2026-10-06")
    return None


def short_hotel_name(full_name):
    name = (full_name or "").split("|")[0].strip()
    return name


def stay_tag_for_card(card_id):
    tags = {
        "D1": "D1宿 (已订)",
        "D2": "D2宿 (已订)",
        "D3": "D3宿 (已订 · 连住第1晚)",
        "D4": "续住 (已订 · 连住第2晚)",
        "D5": "D5宿 (已订)",
        "D6": "D6-D7连宿 (已订 · 第1晚)",
        "D7": "连住第2晚 (已订)",
    }
    return tags.get(card_id, "已订")


def apply_trip_to_segments(segments):
    """Patch route segment waypoints/titles from trip-profile hotelOverrides."""
    trip = load_trip()
    outbound = trip.get("bookedOutbound", {})
    ret = trip.get("bookedReturn", {})

    for seg in segments:
        card_id = seg.get("day")
        day = day_by_card(trip, card_id)
        hotel = hotel_override_for_card(trip, card_id)

        if day:
            title = strip_md(day.get("title", ""))
            if title:
                seg["title"] = title if card_id == "D1" else seg.get("title", title)
            if card_id == "D1":
                seg["title"] = "广州飞抵伊宁 · 入住机场全季"
                seg["highlight"] = (
                    f"{outbound.get('flightNo', 'CZ6888')} "
                    f"{outbound.get('arrTime', '23:10')}落地，"
                    f"宿{short_hotel_name(hotel['name']) if hotel else '机场全季'}，免深夜赶路"
                )
            elif card_id == "D8":
                seg["highlight"] = (
                    "08:00–09:00喀兰朵早餐，09:30出发(D7已出园)，"
                    f"12:00前机场还车，{ret.get('flightNo', 'MU6170')} "
                    f"{ret.get('depTime', '13:30')}起飞"
                )

        if not hotel:
            continue

        hname = hotel["name"]
        short = short_hotel_name(hname)
        booked = hotel.get("booked", True)

        for wp in seg.get("waypoints", []):
            if not wp.get("stay"):
                continue
            wp["name"] = short
            wp["hotel"] = hname
            if booked:
                wp["tag"] = stay_tag_for_card(card_id)

    return segments


def apply_trip_to_subtitles(subtitles):
    """Patch subtitle copy with confirmed hotel names from trip-profile."""
    trip = load_trip()

    for seg in subtitles:
        card_id = seg.get("day")
        hotel = hotel_override_for_card(trip, card_id)
        if not hotel:
            continue

        short = short_hotel_name(hotel["name"])
        tag = stay_tag_for_card(card_id)

        for scenic in seg.get("active_scenics", []):
            if scenic.get("hotel") or scenic.get("type") == "hotel":
                scenic["name"] = short
                scenic["hotel"] = f"宿 {hotel['name']}(已订)"
                if "tag" in scenic and card_id in ("D3", "D4", "D6", "D7"):
                    scenic["tag"] = tag.split(" (")[0].replace("D3宿 ", "连住免搬箱 · ").replace("续住 ", "")

        if card_id == "D1":
            seg["subtitle"] = (
                f"【D1 抵疆休整】CZ6888 23:10落地伊宁(北京钟)，机上简餐，"
                f"入住{short}(已订)养精蓄锐。"
            )
            seg["subtitle_short"] = f"23:10 落地伊宁 ➔ 宿{short} (已订)"
        elif card_id == "D2":
            seg["subtitle"] = (
                f"【D2 伊昭盘山】10:00(当地8点节奏)出发，13:30昭苏午餐，"
                f"下午玉湖游玩，日落约20:15，宿{short}(已订)。"
            )
            seg["subtitle_short"] = (
                f"10:00+出发 ➔ 13:30昭苏午餐 ➔ 玉湖 ➔ 日落~20:15 ➔ 宿{short} (已订)"
            )
        elif card_id == "D3":
            seg["subtitle"] = (
                f"【D3 西喀拉峻下午场】10:00出发，13:30特克斯午餐，"
                f"下午西线人体草原，18:00前离园，宿{short}(已订 · 连住第1晚)。"
            )
        elif card_id == "D5":
            seg["subtitle"] = (
                f"【D5 直赴唐布拉】10:00出发，13:30巩留午餐，"
                f"沿S315百里画廊18:30前抵种蜂场，宿{short}(已订)，晚查独库。"
            )

    return subtitles


def build_key_markers(route_data):
    """Build map POI markers from synced route segments + fixed scenics."""
    trip = load_trip()
    markers = []
    seen_coords = set()

    def add_marker(entry):
        key = tuple(round(c, 3) for c in entry["coord"])
        if key in seen_coords and entry.get("type") != "airport":
            return
        seen_coords.add(key)
        markers.append(entry)

    add_marker({
        "name": "伊宁国际机场",
        "tag": f"D1 落地 {trip.get('bookedOutbound', {}).get('arrTime', '23:10')}",
        "coord": [81.330, 43.956],
        "color": "#747D8C",
        "icon": "✈️",
        "type": "airport",
        "layout": "left",
    })

    for seg in route_data.get("segments", []):
        hotel_wp = next((w for w in seg.get("waypoints", []) if w.get("stay")), None)
        if hotel_wp:
            add_marker({
                "name": hotel_wp["name"],
                "tag": hotel_wp.get("tag", seg["day"]),
                "coord": hotel_wp["coord"],
                "color": seg["color"],
                "icon": "🏨",
                "hotel": f"宿 {hotel_wp.get('hotel', hotel_wp['name'])}(已订)",
                "layout": "right" if seg["day"] in ("D3", "D4", "D7") else "left",
            })

    scenic_extras = [
        {"name": "昭苏玉湖", "tag": "D2 冰川蓝湖", "coord": [80.887, 42.943], "color": "#FF4757", "icon": "🌊", "layout": "left"},
        {"name": "西喀拉峻人体草原", "tag": "D3 下午九曲十八弯", "coord": [82.080, 42.980], "color": "#2ED573", "icon": "🏔️", "layout": "left"},
        {"name": "G217独库北段", "tag": "D6 唐布拉→赛湖", "coord": [83.780, 43.670], "color": "#9B59B6", "icon": "🛣️", "layout": "right"},
        {"name": "乔尔玛烈士陵园", "tag": "G217独库起点", "coord": [83.697, 43.667], "color": "#9B59B6", "icon": "🎖️", "layout": "right"},
        {"name": "哈希勒根达坂", "tag": "3400m 防雪长廊", "coord": [83.950, 44.050], "color": "#9B59B6", "icon": "❄️", "layout": "right"},
        {"name": "赛里木湖东门", "tag": "D7 东门进逆时针", "coord": [81.395, 44.612], "color": "#00CEC9", "icon": "💎", "layout": "right"},
        {"name": "果子沟金顶大桥", "tag": "D7 日落~20:05", "coord": [81.162, 44.482], "color": "#2563eb", "icon": "🌉", "layout": "left"},
        {"name": "博乐阿拉山口机场", "tag": "D8 09:30出发 · 12:00还车", "coord": [82.298, 44.895], "color": "#FD79A8", "icon": "✈️", "type": "airport", "layout": "right"},
    ]
    for m in scenic_extras:
        add_marker(m)

    return markers
