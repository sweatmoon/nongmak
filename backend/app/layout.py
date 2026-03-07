"""
토지 polygon 기반 농막/정화조 자동 배치 계산 모듈
WGS84 polygon → 로컬 좌표 → buffer → 농막/정화조 배치
"""
import math
from typing import Optional
from app.models import PlacementHint


# ── polygon 유틸 ────────────────────────────────────────────────────────────

def polygon_bbox(coords: list[list]) -> tuple[float, float, float, float]:
    """polygon의 bounding box (minx, miny, maxx, maxy)"""
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return min(xs), min(ys), max(xs), max(ys)


def point_in_polygon(px: float, py: float, polygon: list[list]) -> bool:
    """레이 캐스팅으로 점이 polygon 안에 있는지 확인"""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def polygon_offset(coords: list[list], dist: float) -> list[list]:
    """
    단순 polygon 내부 offset (buffer -dist)
    각 꼭짓점을 안쪽 법선 방향으로 dist만큼 이동
    복잡한 self-intersection은 처리하지 않음 (MVP 수준)
    """
    n = len(coords)
    result = []
    for i in range(n):
        prev = coords[(i - 1) % n]
        curr = coords[i]
        nxt = coords[(i + 1) % n]

        # 두 에지의 안쪽 법선 평균
        def edge_normal(a, b):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)
            if length < 1e-9:
                return 0.0, 0.0
            return -dy / length, dx / length

        n1 = edge_normal(prev, curr)
        n2 = edge_normal(curr, nxt)
        nx = (n1[0] + n2[0]) / 2
        ny = (n1[1] + n2[1]) / 2
        norm = math.hypot(nx, ny)
        if norm > 1e-9:
            nx, ny = nx / norm, ny / norm

        result.append([curr[0] + nx * dist, curr[1] + ny * dist])
    return result


def polygon_centroid_local(coords: list[list]) -> tuple[float, float]:
    """로컬 좌표 polygon 무게중심"""
    n = len(coords)
    return sum(c[0] for c in coords) / n, sum(c[1] for c in coords) / n


# ── 농막 배치 ────────────────────────────────────────────────────────────────

def place_hut(
    polygon_local: list[list],
    hut_w: float,
    hut_d: float,
    hint: PlacementHint,
    buffer_m: float = 1.5,
) -> dict:
    """
    polygon 내부에 농막(rectangle) 배치
    반환: {x, y, w, d, cx, cy}  (x,y=좌하단 좌표, cx/cy=중심)
    """
    buffered = polygon_offset(polygon_local, -buffer_m)
    minx, miny, maxx, maxy = polygon_bbox(buffered)
    cx_site, cy_site = polygon_centroid_local(buffered)

    # placement_hint에 따른 후보 중심 계산
    hint_val = hint.value if hasattr(hint, "value") else hint
    margin_w = hut_w / 2 + 0.5
    margin_d = hut_d / 2 + 0.5

    candidates = {
        "CENTER": (cx_site, cy_site),
        "NORTH":  (cx_site, maxy - margin_d),
        "SOUTH":  (cx_site, miny + margin_d),
        "EAST":   (maxx - margin_w, cy_site),
        "WEST":   (minx + margin_w, cy_site),
    }
    hcx, hcy = candidates.get(hint_val, candidates["CENTER"])

    # clamp to buffered bbox
    hcx = max(minx + margin_w, min(maxx - margin_w, hcx))
    hcy = max(miny + margin_d, min(maxy - margin_d, hcy))

    return {
        "x": hcx - hut_w / 2,
        "y": hcy - hut_d / 2,
        "w": hut_w,
        "d": hut_d,
        "cx": hcx,
        "cy": hcy,
    }


def place_septic(
    polygon_local: list[list],
    hut: dict,
    hint: PlacementHint,
    septic_w: float = 2.0,
    septic_d: float = 1.5,
    min_gap: float = 2.5,
) -> dict:
    """
    정화조 위치 결정
    - 농막에서 min_gap 이상 이격
    - polygon 내부
    - 농막 반대쪽 또는 남측 우선
    """
    hint_val = hint.value if hasattr(hint, "value") else hint
    hcx, hcy = hut["cx"], hut["cy"]
    minx, miny, maxx, maxy = polygon_bbox(polygon_local)

    # 정화조 후보 위치: 농막에서 hint 반대 방향
    offset_map = {
        "CENTER": (0, -(hut["d"] / 2 + min_gap + septic_d / 2)),
        "NORTH":  (0, -(hut["d"] / 2 + min_gap + septic_d / 2)),
        "SOUTH":  (0,  (hut["d"] / 2 + min_gap + septic_d / 2)),
        "EAST":   (-(hut["w"] / 2 + min_gap + septic_w / 2), 0),
        "WEST":   ( (hut["w"] / 2 + min_gap + septic_w / 2), 0),
    }
    dx, dy = offset_map.get(hint_val, offset_map["CENTER"])
    scx = hcx + dx
    scy = hcy + dy

    # clamp to polygon bbox with margin
    margin = 1.0
    scx = max(minx + septic_w / 2 + margin, min(maxx - septic_w / 2 - margin, scx))
    scy = max(miny + septic_d / 2 + margin, min(maxy - septic_d / 2 - margin, scy))

    # polygon 안에 있는지 확인; 아니면 centroid 쪽으로 이동
    if not point_in_polygon(scx, scy, polygon_local):
        cx_site, cy_site = polygon_centroid_local(polygon_local)
        scx = (scx + cx_site) / 2
        scy = (scy + cy_site) / 2

    return {
        "x": scx - septic_w / 2,
        "y": scy - septic_d / 2,
        "w": septic_w,
        "d": septic_d,
        "cx": scx,
        "cy": scy,
    }


def compute_layout(
    polygon_local: list[list],
    hut_w: float,
    hut_d: float,
    hint: PlacementHint,
) -> dict:
    """
    전체 배치 계산 반환
    {
        hut: {x,y,w,d,cx,cy},
        septic: {x,y,w,d,cx,cy},
        bbox: {minx,miny,maxx,maxy},
        centroid: {x,y}
    }
    """
    hut = place_hut(polygon_local, hut_w, hut_d, hint)
    septic = place_septic(polygon_local, hut, hint)
    minx, miny, maxx, maxy = polygon_bbox(polygon_local)
    cx, cy = polygon_centroid_local(polygon_local)
    return {
        "hut": hut,
        "septic": septic,
        "bbox": {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy},
        "centroid": {"x": cx, "y": cy},
    }
