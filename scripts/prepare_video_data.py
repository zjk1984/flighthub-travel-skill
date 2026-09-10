import json
import math

with open('/workspace/data/route_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Calculate total points and lengths
for seg in data['segments']:
    coords = seg['coordinates']
    print(f"{seg['day']}: {len(coords)} points, {seg['distance_km']} km")

# Let's subsample points so that distance between consecutive points is reasonably even
def subsample_coords(coords, max_points=300):
    if len(coords) <= max_points:
        return coords
    step = len(coords) / float(max_points)
    sampled = [coords[int(i * step)] for i in range(max_points)]
    if coords[-1] not in sampled:
        sampled.append(coords[-1])
    return sampled

sampled_segments = []
for seg in data['segments']:
    sampled = subsample_coords(seg['coordinates'], max_points=250)
    seg_copy = dict(seg)
    seg_copy['coordinates'] = sampled
    sampled_segments.append(seg_copy)
    print(f"Sampled {seg['day']}: {len(sampled)} points")

data_sampled = dict(data)
data_sampled['segments'] = sampled_segments

with open('/workspace/data/route_data_sampled.json', 'w', encoding='utf-8') as f:
    json.dump(data_sampled, f, ensure_ascii=False)

print("Saved /workspace/data/route_data_sampled.json")
