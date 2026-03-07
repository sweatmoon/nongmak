"""
ZIP 패키지 생성 모듈
"""
import zipfile
import io
import os
from datetime import datetime
from pathlib import Path

from app.config import OUT_DIR
from app.models import OrderRequest, ProductType
from app.generators.site_plan import (
    generate_site_plan_pdf,
    generate_pipe_plan_pdf,
    generate_capacity_pdf,
    generate_checklist_pdf,
    generate_disclaimer_pdf,
)
from app.generators.forms import generate_septic_docx, generate_hut_docx


DISCLAIMER_TXT = "※ 본 패키지는 제출용 초안이며, 최종 제출 전 관할 지자체 및 등록 시공업체 검토가 반드시 필요합니다."


def generate_memo_txt(order_id: str, req: OrderRequest, computed: dict) -> str:
    """시공업체 전달 메모 생성"""
    flags_str = ", ".join(computed.get("risk_flags", [])) or "없음"
    memo = f"""================================
농막 도면 생성 시스템 - 시공업체 전달 메모
================================
[자동 생성 초안 - 시공 전 현장 확인 필수]

■ 주문 정보
  주문번호  : {order_id}
  생성 일시 : {datetime.now().strftime('%Y-%m-%d %H:%M')}
  룰셋      : {computed['ruleset_id']}

■ 현장 정보
  주소/지번  : {req.address}
  신청인     : {req.applicant_name}
  연락처     : {req.phone or '미입력'}

■ 농막 정보
  면적       : {req.hut_area_m2} ㎡
  규격       : {req.hut_w_m}m × {req.hut_d_m}m
  배치 방향  : {req.placement_hint.value}

■ 정화조(개인하수처리시설) 정보
  권장 용량  : {computed['septic_capacity_m3']} m³
  화장실 유형: {req.toilet_type.value}
  처리 방식  : {req.treatment_mode.value}
  상시 인원  : {req.occupants_regular}명
  최대 인원  : {req.occupants_max}명

■ 리스크 플래그
  {flags_str}

■ 비고
  {req.notes or '없음'}

================================
■ 시공업체 확인 요청사항
================================
  □ 현장 토질 확인 후 배관 경로 최종 결정
  □ 정화조 위치 및 방류 방향 현장 측량 후 확정
  □ 지하 매설물 사전 탐사 (가스관, 전기선 등)
  □ 우수관(빗물)과 오수관(오수) 분리 여부 확인
  □ 방류수 수질 기준 적합 여부 지자체 사전 협의
  □ 이격거리 기준 준수 여부 현장 확인
    - 경계선 최소 1.0m 이상
    - 우물/지하수 취수구 최소 20.0m 이상
    - 수체(하천/저수지 등) 최소 10.0m 이상

================================
{DISCLAIMER_TXT}
농막 도면 생성 시스템 | KR-DJ-YS v1 기준
================================
"""
    return memo


def build_zip_package(order_id: str, req: OrderRequest, computed: dict) -> str:
    """ZIP 패키지 생성 후 경로 반환"""
    zip_filename = f"{order_id}.zip"
    zip_path = OUT_DIR / zip_filename

    with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
        # 01_배치도.pdf
        try:
            pdf_site = generate_site_plan_pdf(order_id, req, computed)
            zf.writestr("01_배치도.pdf", pdf_site)
        except Exception as e:
            zf.writestr("01_배치도_ERROR.txt", f"생성 오류: {e}")

        # 02_배관도.pdf
        try:
            pdf_pipe = generate_pipe_plan_pdf(order_id, req, computed)
            zf.writestr("02_배관도.pdf", pdf_pipe)
        except Exception as e:
            zf.writestr("02_배관도_ERROR.txt", f"생성 오류: {e}")

        # 03_용량산정서.pdf
        try:
            pdf_cap = generate_capacity_pdf(order_id, req, computed)
            zf.writestr("03_용량산정서.pdf", pdf_cap)
        except Exception as e:
            zf.writestr("03_용량산정서_ERROR.txt", f"생성 오류: {e}")

        # 04_신고서초안_가설건축물.docx (BUNDLE만)
        if req.product_type == ProductType.BUNDLE:
            try:
                docx_hut = generate_hut_docx(order_id, req, computed)
                zf.writestr("04_신고서초안_가설건축물.docx", docx_hut)
            except Exception as e:
                zf.writestr("04_신고서초안_가설건축물_ERROR.txt", f"생성 오류: {e}")

        # 05_신고서초안_개인하수처리시설.docx
        try:
            docx_septic = generate_septic_docx(order_id, req, computed)
            zf.writestr("05_신고서초안_개인하수처리시설.docx", docx_septic)
        except Exception as e:
            zf.writestr("05_신고서초안_개인하수처리시설_ERROR.txt", f"생성 오류: {e}")

        # 06_제출체크리스트.pdf
        try:
            pdf_check = generate_checklist_pdf(order_id, req, computed)
            zf.writestr("06_제출체크리스트.pdf", pdf_check)
        except Exception as e:
            zf.writestr("06_제출체크리스트_ERROR.txt", f"생성 오류: {e}")

        # 07_면책및사용안내.pdf
        try:
            pdf_disc = generate_disclaimer_pdf(order_id, req, computed)
            zf.writestr("07_면책및사용안내.pdf", pdf_disc)
        except Exception as e:
            zf.writestr("07_면책및사용안내_ERROR.txt", f"생성 오류: {e}")

        # 08_시공업체전달메모.txt
        try:
            memo = generate_memo_txt(order_id, req, computed)
            zf.writestr("08_시공업체전달메모.txt", memo.encode("utf-8"))
        except Exception as e:
            zf.writestr("08_시공업체전달메모_ERROR.txt", f"생성 오류: {e}")

    return str(zip_path)
