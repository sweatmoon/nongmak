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
    if parcel_data and parcel_data.get("polygon_local"):
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
    if parcel_data and parcel_data.get("polygon_local"):
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
