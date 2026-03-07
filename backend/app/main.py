"""
FastAPI 메인 애플리케이션
농막 도면 생성 시스템 백엔드
"""
import uuid
import urllib.parse
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from app.config import OUT_DIR, CORS_ORIGINS
from app.db import init_db, insert_order, update_order_zip, get_order, list_orders
from app.models import OrderRequest, OrderResponse, ReviseRequest, ParcelInfo
from app.rules import compute_order
from app.generators.package import build_zip_package
from app.parcel import fetch_parcel_by_coord, fetch_parcel_by_address
from app.layout import compute_layout
import math


def wgs84_to_local(lat: float, lng: float, origin_lat: float, origin_lng: float) -> tuple[float, float]:
    """WGS84 좌표를 origin 기준 미터 단위 로컬 좌표로 변환"""
    dx = (lng - origin_lng) * 111320 * math.cos(math.radians(origin_lat))
    dy = (lat - origin_lat) * 111320
    return dx, dy


def manual_layout_to_local(manual_layout, parcel_data: dict) -> dict | None:
    """
    LayoutEditor에서 사용자가 배치한 WGS84 좌표를 polygon_local 기준 layout_data로 변환
    배치도 생성(build_zip_package)에 사용할 수 있는 형식으로 반환
    """
    if not manual_layout or not parcel_data:
        return None

    polygon_local = parcel_data.get("polygon_local")
    polygon_wgs84 = parcel_data.get("polygon_wgs84")
    centroid = parcel_data.get("centroid")

    # origin 결정: polygon_local의 origin은 centroid 또는 첫 좌표 기준
    # polygon_wgs84의 중심(centroid)을 WGS84 origin으로 사용
    if centroid and centroid.get("lat") is not None:
        origin_lat = centroid["lat"]
        origin_lng = centroid["lon"]
    elif polygon_wgs84 and len(polygon_wgs84) > 0:
        lats = [p[1] for p in polygon_wgs84]
        lngs = [p[0] for p in polygon_wgs84]
        origin_lat = sum(lats) / len(lats)
        origin_lng = sum(lngs) / len(lngs)
    else:
        return None

    # polygon_local의 centroid를 local origin으로
    if polygon_local and len(polygon_local) > 0:
        local_cx = sum(p[0] for p in polygon_local) / len(polygon_local)
        local_cy = sum(p[1] for p in polygon_local) / len(polygon_local)
    else:
        local_cx, local_cy = 0.0, 0.0

    # manual_layout의 WGS84 → 로컬 미터 변환 (origin 기준 델타 + polygon_local centroid)
    hut_lat, hut_lng = manual_layout.hut_center_wgs84
    sep_lat, sep_lng = manual_layout.septic_center_wgs84

    hut_dx, hut_dy = wgs84_to_local(hut_lat, hut_lng, origin_lat, origin_lng)
    sep_dx, sep_dy = wgs84_to_local(sep_lat, sep_lng, origin_lat, origin_lng)

    hut_cx = local_cx + hut_dx
    hut_cy = local_cy + hut_dy
    sep_cx = local_cx + sep_dx
    sep_cy = local_cy + sep_dy

    # hut_w, hut_d는 실제 모델에서 가져와야 하므로 caller가 채워줌
    # 여기서는 좌표만 반환하고, w/d는 별도 처리
    return {
        "hut": {
            "cx": hut_cx, "cy": hut_cy,
            "w": None, "d": None,  # caller에서 채움
            "x": None, "y": None,
            "rotation_deg": manual_layout.hut_rotation_deg,
        },
        "septic": {
            "cx": sep_cx, "cy": sep_cy,
            "w": 2.0, "d": 1.5,
            "x": sep_cx - 1.0, "y": sep_cy - 0.75,
        },
        "manual": True,
        "placement_note": manual_layout.placement_note or "",
    }

app = FastAPI(
    title="농막 도면 생성 API",
    description="농막 및 정화조 설치를 위한 제출용 초안 패키지 자동 생성 시스템",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "service": "농막 도면 생성 API", "version": "2.0.0"}


# ── 지적도 필지 조회 API ─────────────────────────────────────────────────────

@app.get("/parcel/by-coord")
async def parcel_by_coord(lon: float, lat: float):
    """좌표(WGS84)로 필지 정보 조회"""
    result = await fetch_parcel_by_coord(lon, lat)
    if not result:
        raise HTTPException(status_code=404, detail="필지 정보를 찾을 수 없습니다.")
    return result


@app.get("/parcel/by-address")
async def parcel_by_address(address: str):
    """주소로 필지 정보 조회"""
    result = await fetch_parcel_by_address(address)
    if not result:
        raise HTTPException(status_code=404, detail="필지 정보를 찾을 수 없습니다.")
    return result


# ── 주문 생성 API ────────────────────────────────────────────────────────────

@app.post("/orders", response_model=OrderResponse)
async def create_order(req: OrderRequest):
    """주문 생성 및 패키지 생성"""
    order_id = f"ORD-{datetime.now().strftime('%Y%m%d')}-{str(uuid.uuid4())[:8].upper()}"
    created_at = datetime.now().isoformat()

    # 규칙 계산
    try:
        computed = compute_order(req)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"룰셋 오류: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"계산 오류: {e}")

    # 필지 정보 처리 (요청에 parcel이 없으면 주소로 조회 시도)
    parcel_data = None
    if req.parcel:
        parcel_data = req.parcel.model_dump()
    else:
        try:
            parcel_data = await fetch_parcel_by_address(req.address)
        except Exception:
            parcel_data = None

    # 레이아웃 계산 (polygon 기반)
    layout_data = None
    if req.manual_layout and parcel_data:
        # ✅ 사용자가 LayoutEditor에서 직접 배치한 좌표 우선 사용
        try:
            ml = manual_layout_to_local(req.manual_layout, parcel_data)
            if ml:
                ml["hut"]["w"] = req.hut_w_m
                ml["hut"]["d"] = req.hut_d_m
                ml["hut"]["x"] = ml["hut"]["cx"] - req.hut_w_m / 2
                ml["hut"]["y"] = ml["hut"]["cy"] - req.hut_d_m / 2
                if parcel_data.get("polygon_local"):
                    from app.layout import polygon_bbox, polygon_centroid_local
                    minx, miny, maxx, maxy = polygon_bbox(parcel_data["polygon_local"])
                    cx, cy = polygon_centroid_local(parcel_data["polygon_local"])
                    ml["bbox"] = {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy}
                    ml["centroid"] = {"x": cx, "y": cy}
                layout_data = ml
        except Exception:
            layout_data = None

    if layout_data is None and parcel_data and parcel_data.get("polygon_local"):
        # manual_layout 없거나 실패 시 자동 계산
        try:
            layout_data = compute_layout(
                parcel_data["polygon_local"],
                req.hut_w_m,
                req.hut_d_m,
                req.placement_hint,
            )
        except Exception:
            layout_data = None

    # computed에 parcel/layout 포함
    computed["parcel"] = parcel_data
    computed["layout"] = layout_data

    # ZIP 생성
    try:
        zip_path = build_zip_package(order_id, req, computed)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"패키지 생성 오류: {e}")

    # DB 저장
    order_record = {
        "order_id": order_id,
        "created_at": created_at,
        "region_code": req.region_code,
        "ruleset_id": computed["ruleset_id"],
        "applicant_name": req.applicant_name,
        "email": req.email,
        "phone": req.phone,
        "address": req.address,
        "inputs_json": req.model_dump(),
        "computed_json": {
            "septic_capacity_m3": computed["septic_capacity_m3"],
            "risk_flags": computed["risk_flags"],
            "ruleset_id": computed["ruleset_id"],
        },
        "zip_path": zip_path,
        "parcel_json": parcel_data,
        "revision_count": 0,
        "max_revision": 3,
    }
    try:
        insert_order(order_record)
    except Exception:
        pass

    # 반환
    parcel_obj = ParcelInfo(**parcel_data) if parcel_data else None
    return OrderResponse(
        order_id=order_id,
        ruleset_id=computed["ruleset_id"],
        septic_capacity_m3=computed["septic_capacity_m3"],
        risk_flags=computed["risk_flags"],
        download_url=f"/orders/{order_id}/download",
        parcel=parcel_obj,
        revision_count=0,
        max_revision=3,
    )


# ── 주문 수정 후 재생성 API ──────────────────────────────────────────────────

@app.post("/orders/{order_id}/revise", response_model=OrderResponse)
async def revise_order(order_id: str, rev: ReviseRequest):
    """
    기존 주문 정보를 부분 수정하고 ZIP 패키지 재생성
    최대 3회 무료 수정 제공
    """
    import json as _json

    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다.")

    rc = order.get("revision_count", 0)
    max_r = order.get("max_revision", 3)
    if rc >= max_r:
        raise HTTPException(status_code=400, detail=f"수정 횟수({max_r}회)를 초과했습니다.")

    # 기존 입력 복원
    try:
        inputs = _json.loads(order["inputs_json"]) if isinstance(order["inputs_json"], str) else order["inputs_json"]
    except Exception:
        inputs = {}

    # 변경사항 반영
    if rev.hut_area_m2 is not None:
        inputs["hut_area_m2"] = rev.hut_area_m2
    if rev.hut_w_m is not None:
        inputs["hut_w_m"] = rev.hut_w_m
    if rev.hut_d_m is not None:
        inputs["hut_d_m"] = rev.hut_d_m
    if rev.placement_hint is not None:
        inputs["placement_hint"] = rev.placement_hint.value
    if rev.occupants_regular is not None:
        inputs["occupants_regular"] = rev.occupants_regular
    if rev.occupants_max is not None:
        inputs["occupants_max"] = rev.occupants_max
    if rev.toilet_type is not None:
        inputs["toilet_type"] = rev.toilet_type.value
    if rev.treatment_mode is not None:
        inputs["treatment_mode"] = rev.treatment_mode.value
    if rev.notes is not None:
        inputs["notes"] = rev.notes

    # 필지 정보 업데이트
    parcel_data = None
    if rev.parcel:
        parcel_data = rev.parcel.model_dump()
    else:
        # 기존 parcel 유지
        try:
            pj = order.get("parcel_json")
            if pj:
                parcel_data = _json.loads(pj) if isinstance(pj, str) else pj
        except Exception:
            pass

    try:
        new_req = OrderRequest(**inputs)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"입력 오류: {e}")

    # 규칙 재계산
    computed = compute_order(new_req)

    # 레이아웃 재계산
    layout_data = None
    if new_req.manual_layout and parcel_data:
        try:
            ml = manual_layout_to_local(new_req.manual_layout, parcel_data)
            if ml:
                ml["hut"]["w"] = new_req.hut_w_m
                ml["hut"]["d"] = new_req.hut_d_m
                ml["hut"]["x"] = ml["hut"]["cx"] - new_req.hut_w_m / 2
                ml["hut"]["y"] = ml["hut"]["cy"] - new_req.hut_d_m / 2
                if parcel_data.get("polygon_local"):
                    from app.layout import polygon_bbox, polygon_centroid_local
                    minx, miny, maxx, maxy = polygon_bbox(parcel_data["polygon_local"])
                    cx, cy = polygon_centroid_local(parcel_data["polygon_local"])
                    ml["bbox"] = {"minx": minx, "miny": miny, "maxx": maxx, "maxy": maxy}
                    ml["centroid"] = {"x": cx, "y": cy}
                layout_data = ml
        except Exception:
            layout_data = None

    if layout_data is None and parcel_data and parcel_data.get("polygon_local"):
        try:
            layout_data = compute_layout(
                parcel_data["polygon_local"],
                new_req.hut_w_m,
                new_req.hut_d_m,
                new_req.placement_hint,
            )
        except Exception:
            pass

    computed["parcel"] = parcel_data
    computed["layout"] = layout_data

    # ZIP 재생성 (새 파일명으로)
    new_order_id = f"{order_id}-R{rc + 1}"
    try:
        zip_path = build_zip_package(new_order_id, new_req, computed)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"패키지 재생성 오류: {e}")

    # DB 업데이트
    new_computed_json = {
        "septic_capacity_m3": computed["septic_capacity_m3"],
        "risk_flags": computed["risk_flags"],
        "ruleset_id": computed["ruleset_id"],
    }
    update_order_zip(order_id, zip_path, new_computed_json, rc + 1)

    parcel_obj = ParcelInfo(**parcel_data) if parcel_data else None
    return OrderResponse(
        order_id=order_id,
        ruleset_id=computed["ruleset_id"],
        septic_capacity_m3=computed["septic_capacity_m3"],
        risk_flags=computed["risk_flags"],
        download_url=f"/orders/{order_id}/download",
        parcel=parcel_obj,
        revision_count=rc + 1,
        max_revision=max_r,
    )


# ── 다운로드 ─────────────────────────────────────────────────────────────────

@app.get("/orders/{order_id}/download")
def download_order(order_id: str):
    """ZIP 파일 다운로드"""
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다.")

    zip_path = order.get("zip_path")
    if not zip_path or not Path(zip_path).exists():
        raise HTTPException(status_code=404, detail="파일이 존재하지 않습니다.")

    filename_ascii = f"farmhut_package_{order_id}.zip"
    filename_utf8 = urllib.parse.quote(f"농막도면패키지_{order_id}.zip")

    def iterfile():
        with open(zip_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{filename_ascii}\"; "
                f"filename*=UTF-8''{filename_utf8}"
            )
        },
    )


# ── 주문 조회 ────────────────────────────────────────────────────────────────

@app.get("/orders")
def get_orders(limit: int = 50):
    """주문 목록 조회 (관리자용)"""
    orders = list_orders(limit=limit)
    result = []
    for o in orders:
        import json
        try:
            o["inputs_json"] = json.loads(o["inputs_json"]) if isinstance(o["inputs_json"], str) else o["inputs_json"]
            o["computed_json"] = json.loads(o["computed_json"]) if isinstance(o["computed_json"], str) else o["computed_json"]
        except Exception:
            pass
        result.append(o)
    return {"orders": result, "total": len(result)}


@app.get("/orders/{order_id}")
def get_order_detail(order_id: str):
    """주문 상세 조회"""
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다.")
    import json
    try:
        order["inputs_json"] = json.loads(order["inputs_json"]) if isinstance(order["inputs_json"], str) else order["inputs_json"]
        order["computed_json"] = json.loads(order["computed_json"]) if isinstance(order["computed_json"], str) else order["computed_json"]
        if order.get("parcel_json"):
            order["parcel_json"] = json.loads(order["parcel_json"]) if isinstance(order["parcel_json"], str) else order["parcel_json"]
    except Exception:
        pass
    return order


# ── VWorld 타일/WMS 프록시 ──────────────────────────────────────────────────
import httpx

# 1x1 투명 PNG (VWorld 응답 실패 시 폴백용)
_TRANSPARENT_PNG = (
    b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x01\x00\x00\x00\x01\x00'
    b'\x08\x06\x00\x00\x00\x1fz\x92\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00'
    b'\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'
)

# 공유 httpx 클라이언트 (커넥션 재사용으로 속도 향상)
_vworld_client: httpx.AsyncClient | None = None

def _get_vworld_client() -> httpx.AsyncClient:
    global _vworld_client
    if _vworld_client is None or _vworld_client.is_closed:
        _vworld_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=3.0, read=6.0, write=3.0, pool=1.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            headers={
                "Referer": "https://www.vworld.kr",
                "User-Agent": "Mozilla/5.0 (compatible; AgriApp/1.0)",
            },
        )
    return _vworld_client


@app.get("/proxy/vworld-tile")
async def proxy_vworld_tile(
    layer: str = "LP_PA_CBND_BUBUN",
    style: str = "default",
    tilematrixset: str = "EPSG:900913",
    tilematrix: str = "15",
    tilerow: int = 0,
    tilecol: int = 0,
):
    """VWorld WMTS 타일 프록시 (CORS 우회, 캐시 최적화)"""
    from app.config import VWORLD_API_KEY
    api_key = VWORLD_API_KEY or ""
    if not api_key:
        raise HTTPException(status_code=503, detail="VWORLD_API_KEY 미설정")

    # 허용된 레이어만 통과 (보안)
    allowed_layers = {"LP_PA_CBND_BUBUN", "LP_PA_CBND_JIBUN", "white", "midnight"}
    if layer not in allowed_layers:
        raise HTTPException(status_code=400, detail=f"허용되지 않은 레이어: {layer}")

    url = (
        f"https://api.vworld.kr/req/wmts/1.0.0/{api_key}/{layer}"
        f"/{style}/{tilematrixset}/{tilematrix}/{tilerow}/{tilecol}.png"
    )
    try:
        client = _get_vworld_client()
        resp = await client.get(url)
        if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image"):
            return StreamingResponse(
                iter([resp.content]),
                media_type="image/png",
                headers={
                    "Cache-Control": "public, max-age=86400",  # 24시간 캐시
                    "X-Tile-Source": "vworld",
                },
            )
        # VWorld 오류 → 투명 타일 반환 (지도 깨짐 방지)
        return StreamingResponse(
            iter([_TRANSPARENT_PNG]),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=60"},
        )
    except httpx.TimeoutException:
        # 타임아웃 → 투명 타일 (브라우저 재시도로 해결됨)
        return StreamingResponse(
            iter([_TRANSPARENT_PNG]),
            media_type="image/png",
            headers={"Cache-Control": "no-store"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/proxy/vworld-status")
async def proxy_vworld_status():
    """VWorld API 키 활성화 상태 확인"""
    from app.config import VWORLD_API_KEY
    api_key = VWORLD_API_KEY or ""
    if not api_key:
        return {"status": "no_key"}
    # 줌 10 수준 간단한 타일로 테스트
    url = (
        f"https://api.vworld.kr/req/wmts/1.0.0/{api_key}/LP_PA_CBND_BUBUN"
        f"/default/EPSG:900913/10/420/868.png"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, headers={"Referer": "https://www.vworld.kr"})
            is_image = resp.status_code == 200 and "image" in resp.headers.get("content-type","")
            return {
                "status": "active" if is_image else "pending",
                "http_code": resp.status_code,
                "content_type": resp.headers.get("content-type",""),
            }
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@app.get("/proxy/vworld-wms")
async def proxy_vworld_wms(
    layers: str = "LP_PA_CBND_JIBUN",
    bbox: str = "",
    width: int = 256,
    height: int = 256,
    srs: str = "EPSG:4326",
):
    """VWorld WMS 프록시 - 지번 표시용 (CORS 우회)"""
    from app.config import VWORLD_API_KEY
    api_key = VWORLD_API_KEY or ""
    if not api_key:
        raise HTTPException(status_code=503, detail="VWORLD_API_KEY 미설정")
    if not bbox:
        raise HTTPException(status_code=400, detail="bbox 필수")

    url = (
        f"https://api.vworld.kr/req/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
        f"&LAYERS={layers}&STYLES=&FORMAT=image/png&TRANSPARENT=true"
        f"&SRS={srs}&BBOX={bbox}&WIDTH={width}&HEIGHT={height}"
        f"&KEY={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"Referer": "https://www.vworld.kr"})
            if resp.status_code == 200 and "image" in resp.headers.get("content-type", ""):
                return StreamingResponse(
                    iter([resp.content]),
                    media_type="image/png",
                    headers={"Cache-Control": "public, max-age=300"},
                )
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:200])
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="VWorld WMS 타임아웃")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
