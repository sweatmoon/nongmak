"""
VWorld 지적도 API 조회 모듈
WGS84 좌표 기반 필지 polygon 조회 및 좌표 변환
"""
import math
import httpx
from typing import Optional
from app.config import VWORLD_API_KEY


# ── 지구 반경 (m) ──────────────────────────────
EARTH_R = 6_371_000.0


def _deg2rad(d: float) -> float:
    return d * math.pi / 180.0


def wgs84_to_local(lon: float, lat: float, cx: float, cy: float) -> tuple[float, float]:
    """
    WGS84(lon,lat) → centroid 기준 로컬 좌표 (m)
    간이 equirectangular 근사 (수백m 범위에서 충분히 정확)
    """
    dx = _deg2rad(lon - cx) * EARTH_R * math.cos(_deg2rad(cy))
    dy = _deg2rad(lat - cy) * EARTH_R
    return dx, dy


def polygon_centroid(coords: list[list[float]]) -> tuple[float, float]:
    """polygon 꼭짓점 목록에서 centroid(lon,lat) 계산"""
    n = len(coords)
    cx = sum(c[0] for c in coords) / n
    cy = sum(c[1] for c in coords) / n
    return cx, cy


def polygon_area_m2(local_coords: list[tuple[float, float]]) -> float:
    """Shoelace 공식으로 polygon 면적 계산 (m²)"""
    n = len(local_coords)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += local_coords[i][0] * local_coords[j][1]
        area -= local_coords[j][0] * local_coords[i][1]
    return abs(area) / 2.0


async def fetch_parcel_by_coord(lon: float, lat: float) -> Optional[dict]:
    """
    VWorld WFS API를 통해 해당 좌표의 필지(지적) 정보 조회
    반환: {
        jibun, area_m2, jimok, yongdo, polygon_wgs84, polygon_local, centroid
    }
    """
    # VWorld WFS GetFeature – lp_pa_cbnd_bubun (토지특성_법정경계)
    # API 키가 없으면 mock 데이터 반환
    if not VWORLD_API_KEY:
        return _mock_parcel(lon, lat)

    url = "https://api.vworld.kr/req/wfs"
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": "lp_pa_cbnd_bubun",
        "key": VWORLD_API_KEY,
        "output": "application/json",
        "srsName": "EPSG:4326",
        "CQL_FILTER": f"INTERSECTS(geom,POINT({lon} {lat}))",
        "count": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        feature = data.get("features", [None])[0]
        if not feature:
            return _mock_parcel(lon, lat)
        return _parse_vworld_feature(feature)
    except Exception:
        return _mock_parcel(lon, lat)


async def fetch_parcel_by_address(address: str) -> Optional[dict]:
    """주소 문자열로 필지 조회 (geocode → coord → parcel)"""
    coord = await _geocode_kakao(address)
    if coord:
        return await fetch_parcel_by_coord(coord[0], coord[1])
    return None


async def _geocode_kakao(address: str) -> Optional[tuple[float, float]]:
    """카카오 주소 → 좌표 변환 (Kakao REST API 없이 VWorld geocode 사용)"""
    url = "https://api.vworld.kr/req/address"
    params = {
        "service": "address",
        "request": "getcoord",
        "address": address,
        "type": "parcel",
        "key": VWORLD_API_KEY or "devU01TX0FVVEgyMDI1",
        "refine": "false",
        "simple": "false",
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, params=params)
            data = resp.json()
        result = data.get("response", {}).get("result", {}).get("point", {})
        x = float(result.get("x", 0))
        y = float(result.get("y", 0))
        if x and y:
            return x, y
    except Exception:
        pass
    return None


def pnu_to_jibun(pnu: str) -> str:
    """
    19자리 PNU 코드를 지번 주소 문자열로 변환
    예: 3017010200100430000 → 대전 유성구 방동 43
    PNU 구조: 5자리 법정동코드 + 4자리 읍면동 + 2자리 리 + 1자리 대지구분 + 4자리 본번 + 4자리 부번
    """
    if not pnu or len(pnu) < 19:
        return pnu or ""
    try:
        bon = int(pnu[11:15])  # 본번
        bu = int(pnu[15:19])   # 부번
        if bu > 0:
            return f"{bon}-{bu}"
        return str(bon)
    except Exception:
        return pnu


def _parse_vworld_feature(feature: dict) -> dict:
    """VWorld GeoJSON feature → 내부 표준 형식"""
    props = feature.get("properties", {})
    geom = feature.get("geometry", {})

    # polygon 좌표 추출 (MultiPolygon 대응)
    geom_type = geom.get("type", "Polygon")
    if geom_type == "MultiPolygon":
        # 가장 큰 ring 선택
        all_rings = [ring for poly in geom.get("coordinates", []) for ring in poly]
        coords_raw = max(all_rings, key=len) if all_rings else []
    else:
        coords_raw = geom.get("coordinates", [[]])[0]  # 외곽 ring

    polygon_wgs84 = [[c[0], c[1]] for c in coords_raw]

    cx, cy = polygon_centroid(polygon_wgs84)
    polygon_local = [wgs84_to_local(c[0], c[1], cx, cy) for c in polygon_wgs84]
    area = polygon_area_m2(polygon_local)

    # 지번 파싱: pnu → 지번 변환 우선, 없으면 lbm_nm/addr 사용
    pnu = props.get("pnu", "")
    lbm_nm = props.get("lbm_nm", "")   # 법정동명 (예: 대전광역시 유성구 방동)
    addr = props.get("addr", "") or props.get("lbm_addr", "")
    jibun_num = pnu_to_jibun(pnu)

    if lbm_nm and jibun_num and not jibun_num.startswith("30"):
        jibun = f"{lbm_nm} {jibun_num}"
    elif addr:
        jibun = addr
    elif pnu:
        jibun = pnu
    else:
        jibun = ""

    return {
        "jibun": jibun,
        "area_m2": round(area, 1),
        "jimok": props.get("jimok_nm", "") or props.get("jimok", ""),
        "yongdo": props.get("prpos_area1_nm", "") or props.get("prpos_area", ""),
        "polygon_wgs84": polygon_wgs84,
        "polygon_local": [[round(x, 3), round(y, 3)] for x, y in polygon_local],
        "centroid": {"lon": round(cx, 7), "lat": round(cy, 7)},
        "is_mock": False,
    }


def _mock_parcel(lon: float, lat: float) -> dict:
    """
    API 키 없음 / 조회 실패 시 mock 필지 반환
    대략 30m × 28m 육각형 (약 843㎡)
    """
    # 필지 크기 (도 단위)
    dw = 0.00040   # ~40m
    dh = 0.00035   # ~35m

    polygon_wgs84 = [
        [lon - dw * 0.5, lat - dh * 0.5],
        [lon + dw * 0.3, lat - dh * 0.6],
        [lon + dw * 0.8, lat - dh * 0.1],
        [lon + dw * 0.9, lat + dh * 0.4],
        [lon + dw * 0.3, lat + dh * 0.8],
        [lon - dw * 0.4, lat + dh * 0.7],
        [lon - dw * 0.8, lat + dh * 0.2],
        [lon - dw * 0.5, lat - dh * 0.5],
    ]
    cx, cy = polygon_centroid(polygon_wgs84)
    polygon_local = [wgs84_to_local(c[0], c[1], cx, cy) for c in polygon_wgs84]
    area = polygon_area_m2(polygon_local)

    return {
        "jibun": f"샘플필지 ({lon:.5f},{lat:.5f})",
        "area_m2": round(area, 1),
        "jimok": "답",
        "yongdo": "농림지역",
        "polygon_wgs84": polygon_wgs84,
        "polygon_local": [[round(x, 3), round(y, 3)] for x, y in polygon_local],
        "centroid": {"lon": round(cx, 7), "lat": round(cy, 7)},
        "is_mock": True,
    }
