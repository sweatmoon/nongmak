"""
FastAPI 메인 애플리케이션
농막 도면 생성 시스템 백엔드
"""
import uuid
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.config import OUT_DIR, CORS_ORIGINS
from app.db import init_db, insert_order, get_order, list_orders
from app.models import OrderRequest, OrderResponse
from app.rules import compute_order
from app.generators.package import build_zip_package

app = FastAPI(
    title="농막 도면 생성 API",
    description="농막 및 정화조 설치를 위한 제출용 초안 패키지 자동 생성 시스템",
    version="1.0.0",
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
    return {"status": "ok", "service": "농막 도면 생성 API", "version": "1.0.0"}


@app.post("/orders", response_model=OrderResponse)
def create_order(req: OrderRequest):
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
    }
    try:
        insert_order(order_record)
    except Exception as e:
        # DB 저장 실패해도 파일은 이미 생성됨
        pass

    return OrderResponse(
        order_id=order_id,
        ruleset_id=computed["ruleset_id"],
        septic_capacity_m3=computed["septic_capacity_m3"],
        risk_flags=computed["risk_flags"],
        download_url=f"/orders/{order_id}/download",
    )


@app.get("/orders/{order_id}/download")
def download_order(order_id: str):
    """ZIP 파일 다운로드"""
    order = get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="주문을 찾을 수 없습니다.")

    zip_path = order.get("zip_path")
    if not zip_path or not Path(zip_path).exists():
        raise HTTPException(status_code=404, detail="파일이 존재하지 않습니다.")

    return FileResponse(
        path=zip_path,
        media_type="application/zip",
        filename=f"농막도면패키지_{order_id}.zip",
        headers={"Content-Disposition": f'attachment; filename*=UTF-8\'\'농막도면패키지_{order_id}.zip'}
    )


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
    except Exception:
        pass
    return order
