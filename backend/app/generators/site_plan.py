"""
배치도 PDF 생성 모듈
"""
import io
import math
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String, Line, Circle, Polygon as RLPolygon, PolyLine
from reportlab.graphics import renderPDF
import os, sys


def _register_fonts():
    """시스템 한글 폰트 등록 시도"""
    candidates = [
        ("/usr/share/fonts/truetype/nanum/NanumGothic.ttf", "NanumGothic"),
        ("/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf", "NanumBarunGothic"),
        ("/System/Library/Fonts/AppleGothic.ttf", "AppleGothic"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJK"),
    ]
    for path, name in candidates:
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                return name
            except Exception:
                pass
    return None


FONT_NAME = _register_fonts() or "Helvetica"
FONT_BOLD = FONT_NAME


def _style(size=10, bold=False, align=TA_LEFT, color=colors.black):
    return ParagraphStyle(
        name="custom",
        fontName=FONT_BOLD if bold else FONT_NAME,
        fontSize=size,
        textColor=color,
        alignment=align,
        leading=size * 1.5,
    )


DISCLAIMER = "※ 본 도면은 제출용 초안이며, 최종 제출 전 관할 지자체 및 등록 시공업체의 검토가 반드시 필요합니다."


def generate_site_plan_pdf(order_id: str, req, computed: dict) -> bytes:
    """배치도 PDF 생성 - polygon 기반 or 기존 사각형 기반 fallback"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        rightMargin=20*mm, leftMargin=20*mm,
        topMargin=20*mm, bottomMargin=20*mm,
        title="배치도"
    )
    ruleset = computed.get("ruleset", {})
    capacity = computed["septic_capacity_m3"]
    risk_flags = computed.get("risk_flags", [])
    parcel = computed.get("parcel")   # parcel dict (polygon_local 포함)
    layout = computed.get("layout")  # pre-computed layout dict
    elements = []

    # 제목
    elements.append(Paragraph("농막 배치도 (제출용 초안)", _style(16, bold=True, align=TA_CENTER)))
    elements.append(Spacer(1, 4*mm))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB")))
    elements.append(Spacer(1, 4*mm))


    # 기본 정보 테이블
    info_data = [
        ["주문번호", order_id, "신청인", req.applicant_name],
        ["주소/지번", req.address, "농막 면적", f"{req.hut_area_m2} ㎡"],
        ["농막 규격", f"{req.hut_w_m}m × {req.hut_d_m}m", "배치 방향", req.placement_hint.value],
        ["화장실 유형", req.toilet_type.value, "처리 방식", req.treatment_mode.value],
        ["정화조 용량", f"{capacity} m³", "룰셋", computed["ruleset_id"]],
    ]
    tbl = Table(info_data, colWidths=[35*mm, 60*mm, 35*mm, 40*mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
        ("FONTNAME", (2, 0), (2, -1), FONT_BOLD),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(tbl)
    elements.append(Spacer(1, 6*mm))

    # 배치 다이어그램 (polygon 기반 or 기존 방식)
    if parcel and parcel.get("polygon_local") and layout:
        diagram = _build_polygon_site_diagram(req, computed, ruleset, parcel, layout)
        # 필지 정보 표시
        elements.append(Paragraph("■ 토지(필지) 정보", _style(10, bold=True)))
        elements.append(Spacer(1, 2*mm))
        parcel_data = [
            ["지번", parcel.get("jibun", "-"), "면적", f"{parcel.get('area_m2', '-')} ㎡"],
            ["지목", parcel.get("jimok", "-"), "용도지역", parcel.get("yongdo", "-")],
        ]
        ptbl = Table(parcel_data, colWidths=[25*mm, 60*mm, 25*mm, 60*mm])
        ptbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F0FDF4")),
            ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F0FDF4")),
            ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
            ("FONTNAME", (2, 0), (2, -1), FONT_BOLD),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("PADDING", (0, 0), (-1, -1), 4),
        ]))
        elements.append(ptbl)
        elements.append(Spacer(1, 4*mm))
    else:
        diagram = _build_site_diagram(req, computed, ruleset)
    elements.append(diagram)
    elements.append(Spacer(1, 4*mm))

    # 이격거리 기준
    elements.append(Paragraph("■ 이격거리 기준 (지역: 대전 유성구 기준)", _style(10, bold=True)))
    elements.append(Spacer(1, 2*mm))
    dist_data = [
        ["기준", "최소 이격거리", "비고"],
        ["인접 경계선", f"{ruleset.get('boundary_min_m', 1.0)} m 이상", "농막 외벽 기준"],
        ["우물/지하수 취수구", f"{ruleset.get('well_min_m', 20.0)} m 이상", "정화조 기준"],
        ["수체(하천/저수지 등)", f"{ruleset.get('waterbody_min_m', 10.0)} m 이상", "방류구 기준"],
    ]
    dtbl = Table(dist_data, colWidths=[55*mm, 55*mm, 60*mm])
    dtbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E40AF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(dtbl)
    elements.append(Spacer(1, 4*mm))

    # 리스크 플래그
    if risk_flags:
        elements.append(Paragraph("■ 리스크 플래그", _style(10, bold=True, color=colors.HexColor("#DC2626"))))
        elements.append(Spacer(1, 2*mm))
        for flag in risk_flags:
            flag_desc = {
                "WATER_AREA_POSSIBLE": "수변구역 가능성 — 정화조 방류 기준 강화 적용 여부 지자체 확인 필요",
                "TREATMENT_MODE_UNCERTAIN": "처리 방식 미확정 — 시공 전 처리 방식 확정 및 업체 협의 필요",
            }.get(flag, flag)
            elements.append(Paragraph(f"⚠ {flag}: {flag_desc}", _style(9, color=colors.HexColor("#DC2626"))))
        elements.append(Spacer(1, 3*mm))

    # 비고
    if req.notes and req.notes.strip():
        elements.append(Paragraph(f"■ 비고: {req.notes}", _style(9)))
        elements.append(Spacer(1, 3*mm))

    # 면책 문구
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#94A3B8")))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(DISCLAIMER, _style(8, color=colors.HexColor("#64748B"))))

    doc.build(elements)
    return buf.getvalue()


def _build_polygon_site_diagram(req, computed, ruleset, parcel: dict, layout: dict) -> Drawing:
    """
    실제 지적 polygon 기반 배치도 다이어그램
    polygon_local 좌표를 도면 좌표로 변환하여 그림
    """
    W, H = 170*mm, 120*mm
    d = Drawing(W, H)
    MARGIN = 10*mm

    polygon_local = parcel.get("polygon_local", [])
    if not polygon_local:
        return _build_site_diagram(req, computed, ruleset)

    # ── 좌표 정규화 (polygon_local → 도면 좌표) ──────────────────────────
    xs = [c[0] for c in polygon_local]
    ys = [c[1] for c in polygon_local]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max_x - min_x or 1
    span_y = max_y - min_y or 1

    draw_w = W - 2 * MARGIN
    draw_h = H - 2 * MARGIN
    scale = min(draw_w / span_x, draw_h / span_y) * 0.85

    def to_draw(px, py):
        """로컬 좌표 → 도면 좌표"""
        cx_offset = MARGIN + draw_w / 2 - (min_x + max_x) / 2 * scale
        cy_offset = MARGIN + draw_h / 2 - (min_y + max_y) / 2 * scale
        return px * scale + cx_offset, py * scale + cy_offset

    # ── 배경 ──────────────────────────────────────────────────────────────
    d.add(Rect(0, 0, W, H, fillColor=colors.HexColor("#F8FAFC"), strokeColor=None, strokeWidth=0))

    # ── 토지 경계 polygon (SITE_BOUNDARY 레이어) ──────────────────────────
    pts_flat = []
    for c in polygon_local:
        dx, dy = to_draw(c[0], c[1])
        pts_flat.extend([dx, dy])
    if len(pts_flat) >= 6:
        d.add(RLPolygon(pts_flat,
                        fillColor=colors.white,
                        fillOpacity=0,
                        strokeColor=colors.HexColor("#166534"),
                        strokeWidth=2.0))

    # ── 레이어: HUT ──────────────────────────────────────────────────────
    hut = layout.get("hut", {})
    if hut:
        hw = hut["w"] * scale
        hd = hut["d"] * scale
        rot_deg = hut.get("rotation_deg", 0) or 0
        tcx, tcy = to_draw(hut["cx"], hut["cy"])
        if rot_deg != 0:
            rad = math.radians(rot_deg)
            cos_r, sin_r = math.cos(rad), math.sin(rad)
            corners_local = [
                (-hw/2, -hd/2), (hw/2, -hd/2),
                (hw/2,  hd/2), (-hw/2,  hd/2)
            ]
            pts_hut = []
            for (cx_l, cy_l) in corners_local:
                rx = cx_l * cos_r - cy_l * sin_r
                ry = cx_l * sin_r + cy_l * cos_r
                pts_hut.extend([tcx + rx, tcy + ry])
            d.add(RLPolygon(pts_hut,
                           fillColor=colors.HexColor("#DBEAFE"),
                           strokeColor=colors.HexColor("#1D4ED8"),
                           strokeWidth=1.5))
        else:
            hx1, hy1 = to_draw(hut["x"], hut["y"])
            d.add(Rect(hx1, hy1, hw, hd,
                       fillColor=colors.HexColor("#DBEAFE"),
                       strokeColor=colors.HexColor("#1D4ED8"),
                       strokeWidth=1.5))
        d.add(String(tcx - 8*mm, tcy + 1*mm, "농  막",
                     fontSize=8, fontName=FONT_BOLD, fillColor=colors.HexColor("#1D4ED8")))
        d.add(String(tcx - 10*mm, tcy - 2.5*mm, f"{req.hut_w_m}m\u00d7{req.hut_d_m}m",
                     fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#1D4ED8")))
        if rot_deg != 0:
            d.add(String(tcx - 8*mm, tcy - 5.5*mm, f"회전:{rot_deg:.0f}°",
                         fontSize=5.5, fontName=FONT_NAME, fillColor=colors.HexColor("#6B7280")))

    # ── 레이어: SEPTIC ────────────────────────────────────────────────────
    septic = layout.get("septic", {})
    if septic:
        sx1, sy1 = to_draw(septic["x"], septic["y"])
        sw = septic["w"] * scale
        sd = septic["d"] * scale
        d.add(Rect(sx1, sy1, sw, sd,
                   fillColor=colors.HexColor("#FEF9C3"),
                   strokeColor=colors.HexColor("#CA8A04"),
                   strokeWidth=1.5))
        scx, scy = to_draw(septic["cx"], septic["cy"])
        d.add(String(scx - 7*mm, scy + 0.5*mm, "정화조",
                     fontSize=7.5, fontName=FONT_BOLD, fillColor=colors.HexColor("#854D0E")))
        d.add(String(scx - 8*mm, scy - 3*mm, f"{computed['septic_capacity_m3']}m³",
                     fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#854D0E")))

    # ── 배관 연결선 (HUT → SEPTIC) ────────────────────────────────────────
    if hut and septic:
        hcx, hcy = to_draw(hut["cx"], hut["cy"])
        scx, scy = to_draw(septic["cx"], septic["cy"])
        d.add(Line(hcx, hcy, scx, scy,
                   strokeColor=colors.HexColor("#CA8A04"),
                   strokeWidth=1.2,
                   strokeDashArray=[4, 3]))
        # 방류 화살표 (정화조에서 바깥쪽)
        arrow_dx = scx - hcx
        arrow_dy = scy - hcy
        arrow_len = math.hypot(arrow_dx, arrow_dy) or 1
        ex = scx + arrow_dx / arrow_len * 15 * mm
        ey = scy + arrow_dy / arrow_len * 15 * mm
        # clamp
        ex = max(3*mm, min(W - 3*mm, ex))
        ey = max(3*mm, min(H - 3*mm, ey))
        d.add(Line(scx, scy, ex, ey,
                   strokeColor=colors.HexColor("#0891B2"),
                   strokeWidth=1.5,
                   strokeDashArray=[5, 3]))
        d.add(String(ex - 6*mm, ey + 1*mm, "→방류",
                     fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#0891B2")))

    # ── 방위 표시 ──────────────────────────────────────────────────────────
    d.add(String(W - 12*mm, H - 9*mm, "N↑", fontSize=9, fontName=FONT_BOLD, fillColor=colors.HexColor("#374151")))

    # ── 축척 및 레이어 범례 ───────────────────────────────────────────────
    lx = 4*mm
    ly = H - 10*mm
    items = [
        (colors.HexColor("#DCFCE7"), colors.HexColor("#166534"), "토지 경계"),
        (colors.HexColor("#DBEAFE"), colors.HexColor("#1D4ED8"), "농  막"),
        (colors.HexColor("#FEF9C3"), colors.HexColor("#CA8A04"), "정화조"),
    ]
    for i, (fc, sc, lbl) in enumerate(items):
        ry = ly - i * 6*mm
        d.add(Rect(lx, ry - 1.5*mm, 6*mm, 4*mm, fillColor=fc, strokeColor=sc, strokeWidth=0.8))
        d.add(String(lx + 7.5*mm, ry - 0.5*mm, lbl, fontSize=6.5, fontName=FONT_NAME, fillColor=colors.black))

    # ── 면적 정보 ─────────────────────────────────────────────────────────
    area = parcel.get("area_m2", "")
    jibun = parcel.get("jibun", "")
    if jibun:
        d.add(String(4*mm, 7*mm, f"지번: {jibun}", fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#374151")))
    if area:
        d.add(String(4*mm, 3*mm, f"면적: {area} ㎡", fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#374151")))

    # ── mock 표시 ─────────────────────────────────────────────────────────
    if parcel.get("is_mock"):
        d.add(String(W / 2 - 20*mm, H - 5*mm,
                     "※ 샘플 필지 (지적도 API 미연동)",
                     fontSize=6.5, fontName=FONT_NAME, fillColor=colors.HexColor("#DC2626")))

    return d


def _build_site_diagram(req, computed, ruleset) -> Drawing:
    """배치도 SVG-like 다이어그램 생성 (polygon 없을 때 fallback)"""
    W, H = 170*mm, 110*mm
    d = Drawing(W, H)

    # 배경 (대지)
    d.add(Rect(5*mm, 5*mm, W - 10*mm, H - 10*mm,
               fillColor=colors.HexColor("#F0FDF4"), strokeColor=colors.HexColor("#166534"),
               strokeWidth=2))
    # 대지 레이블
    d.add(String(8*mm, H - 12*mm, "[ 대  지 ]", fontSize=8, fontName=FONT_BOLD, fillColor=colors.HexColor("#166534")))

    # 농막 위치 계산
    hint = req.placement_hint.value
    cx, cy = _get_hut_center(W, H, hint)

    hut_w = min(req.hut_w_m * 8*mm, 55*mm)
    hut_d = min(req.hut_d_m * 8*mm, 40*mm)
    hx = cx - hut_w / 2
    hy = cy - hut_d / 2

    # 농막
    d.add(Rect(hx, hy, hut_w, hut_d,
               fillColor=colors.HexColor("#DBEAFE"), strokeColor=colors.HexColor("#1D4ED8"), strokeWidth=1.5))
    d.add(String(cx - 10*mm, cy + 2*mm, "농 막", fontSize=9, fontName=FONT_BOLD, fillColor=colors.HexColor("#1D4ED8")))
    d.add(String(cx - 15*mm, cy - 3*mm, f"{req.hut_w_m}m × {req.hut_d_m}m", fontSize=7, fontName=FONT_NAME, fillColor=colors.HexColor("#1D4ED8")))

    # 정화조 위치 (농막 오른쪽 또는 남쪽)
    sx, sy = cx + hut_w / 2 + 15*mm, cy - 8*mm
    if sx > W - 20*mm:
        sx, sy = cx, hy - 20*mm

    sw, sh = 18*mm, 12*mm
    d.add(Rect(sx - sw/2, sy - sh/2, sw, sh,
               fillColor=colors.HexColor("#FEF9C3"), strokeColor=colors.HexColor("#CA8A04"), strokeWidth=1.5))
    d.add(String(sx - 8*mm, sy, "정화조", fontSize=8, fontName=FONT_BOLD, fillColor=colors.HexColor("#854D0E")))
    d.add(String(sx - 9*mm, sy - 4*mm, f"{computed['septic_capacity_m3']}m³", fontSize=7, fontName=FONT_NAME, fillColor=colors.HexColor("#854D0E")))

    # 배관 연결선 (농막 → 정화조)
    toilet_x = cx + hut_w / 2
    d.add(Line(toilet_x, cy, sx - sw/2, sy,
               strokeColor=colors.HexColor("#CA8A04"), strokeWidth=1, strokeDashArray=[3, 2]))

    # 방류 화살표
    end_x = min(sx + sw/2 + 18*mm, W - 8*mm)
    d.add(Line(sx + sw/2, sy, end_x, sy,
               strokeColor=colors.HexColor("#0891B2"), strokeWidth=1.2, strokeDashArray=[4, 2]))
    d.add(String(end_x - 12*mm, sy + 2*mm, "→ 방류", fontSize=7, fontName=FONT_NAME, fillColor=colors.HexColor("#0891B2")))

    # 이격거리 표시 (경계선)
    bd = ruleset.get("boundary_min_m", 1.0)
    d.add(String(8*mm, 8*mm, f"경계선 최소 {bd}m", fontSize=7, fontName=FONT_NAME, fillColor=colors.HexColor("#64748B")))

    # 범례
    legend_x = 5*mm
    legend_y = H - 22*mm
    d.add(Rect(legend_x, legend_y - 2*mm, 8*mm, 5*mm, fillColor=colors.HexColor("#DBEAFE"), strokeColor=colors.HexColor("#1D4ED8"), strokeWidth=1))
    d.add(String(legend_x + 10*mm, legend_y, "농막", fontSize=7, fontName=FONT_NAME, fillColor=colors.black))
    d.add(Rect(legend_x, legend_y - 10*mm, 8*mm, 5*mm, fillColor=colors.HexColor("#FEF9C3"), strokeColor=colors.HexColor("#CA8A04"), strokeWidth=1))
    d.add(String(legend_x + 10*mm, legend_y - 8*mm, "정화조", fontSize=7, fontName=FONT_NAME, fillColor=colors.black))

    # 주석
    d.add(String(5*mm, 1*mm, "※ 본 배치도는 개략 개념도이며 실제 위치는 현장 측량 기준으로 작성되어야 합니다.", fontSize=6, fontName=FONT_NAME, fillColor=colors.HexColor("#94A3B8")))

    return d


def _get_hut_center(W, H, hint):
    pad = 25*mm
    cx_c = W / 2
    cy_c = H / 2
    mapping = {
        "CENTER": (cx_c, cy_c),
        "NORTH": (cx_c, H - pad),
        "SOUTH": (cx_c, pad + 5*mm),
        "EAST": (W - pad, cy_c),
        "WEST": (pad, cy_c),
    }
    return mapping.get(hint, (cx_c, cy_c))


def generate_pipe_plan_pdf(order_id: str, req, computed: dict) -> bytes:
    """배관도 PDF 생성"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm, title="배관도")
    ruleset = computed.get("ruleset", {})
    elements = []

    elements.append(Paragraph("배관도 (제출용 초안)", _style(16, bold=True, align=TA_CENTER)))
    elements.append(Spacer(1, 4*mm))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB")))
    elements.append(Spacer(1, 4*mm))

    # 기본 정보
    info = [
        ["주문번호", order_id, "신청인", req.applicant_name],
        ["주소", req.address, "화장실 유형", req.toilet_type.value],
        ["처리 방식", req.treatment_mode.value, "정화조 용량", f"{computed['septic_capacity_m3']} m³"],
    ]
    tbl = Table(info, colWidths=[35*mm, 65*mm, 35*mm, 35*mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
        ("FONTNAME", (2, 0), (2, -1), FONT_BOLD),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(tbl)
    elements.append(Spacer(1, 6*mm))

    # 배관 개념도
    elements.append(Paragraph("■ 배관 흐름 개념도", _style(11, bold=True)))
    elements.append(Spacer(1, 3*mm))
    pipe_diag = _build_pipe_diagram(req, computed, ruleset)
    elements.append(pipe_diag)
    elements.append(Spacer(1, 5*mm))

    # 배관 사양
    elements.append(Paragraph("■ 배관 기본 사양", _style(10, bold=True)))
    elements.append(Spacer(1, 2*mm))
    pipe_d = ruleset.get("pipe_diameter_mm", 100)
    slope = ruleset.get("pipe_slope_min_pct", 1.0)
    spec_data = [
        ["항목", "기준값", "비고"],
        ["배관 구경", f"Ø{pipe_d} mm", "오수 배수관 기준"],
        ["배관 경사", f"{slope}% 이상", "자연 유하 기준"],
        ["배관 재질", "PVC 또는 동등 이상", "내식성 확보"],
        ["청소구(맨홀)", "정화조 입구 측 설치", "시공업체 협의"],
        ["누수 검사", "시공 후 만수 시험", "준공 전 의무"],
    ]
    stbl = Table(spec_data, colWidths=[50*mm, 55*mm, 65*mm])
    stbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E40AF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    elements.append(stbl)
    elements.append(Spacer(1, 4*mm))

    # 시공업체 확인 요청사항
    elements.append(Paragraph("■ 시공업체 확인 요청사항", _style(10, bold=True, color=colors.HexColor("#DC2626"))))
    elements.append(Spacer(1, 2*mm))
    checks = [
        "현장 토질 확인 후 배관 경로 최종 결정",
        "정화조 위치 및 방류 방향 현장 측량 후 확정",
        "지하 매설물 사전 탐사 (가스관, 전기선 등)",
        "우수관(빗물)과 오수관(오수) 분리 여부 확인",
        "방류수 수질 기준 적합 여부 지자체 사전 협의",
    ]
    for c in checks:
        elements.append(Paragraph(f"  □ {c}", _style(9)))
    elements.append(Spacer(1, 4*mm))

    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#94A3B8")))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(DISCLAIMER, _style(8, color=colors.HexColor("#64748B"))))

    doc.build(elements)
    return buf.getvalue()


def _build_pipe_diagram(req, computed, ruleset) -> Drawing:
    """배관 흐름 개념도"""
    W, H = 170*mm, 55*mm
    d = Drawing(W, H)

    boxes = [
        (12*mm, H/2, "화장실", "#DBEAFE", "#1D4ED8"),
        (55*mm, H/2, "오수 배수관\n(하향 경사)", "#F1F5F9", "#475569"),
        (98*mm, H/2, "정화조\n" + f"{computed['septic_capacity_m3']}m³", "#FEF9C3", "#CA8A04"),
    ]

    mode = req.treatment_mode.value
    if mode == "INFILTRATION":
        last = (145*mm, H/2, "침투 시설", "#DCFCE7", "#166534")
    else:
        last = (145*mm, H/2, "방류\n(하천·농수로)", "#CFFAFE", "#0891B2")
    boxes.append(last)

    bw, bh = 26*mm, 14*mm
    for bx, by, label, fc, sc in boxes:
        d.add(Rect(bx - bw/2, by - bh/2, bw, bh,
                   fillColor=colors.HexColor(fc), strokeColor=colors.HexColor(sc), strokeWidth=1.5))
        lines = label.split("\n")
        for i, ln in enumerate(lines):
            d.add(String(bx - len(ln)*2.2, by + (len(lines)-1)*2.5*mm - i*5*mm, ln,
                         fontSize=7.5, fontName=FONT_NAME, fillColor=colors.HexColor(sc)))

    # 화살표 연결
    arrow_y = H / 2
    for i in range(len(boxes) - 1):
        x1 = boxes[i][0] + bw/2
        x2 = boxes[i+1][0] - bw/2
        d.add(Line(x1, arrow_y, x2 - 2*mm, arrow_y,
                   strokeColor=colors.HexColor("#64748B"), strokeWidth=1.5))
        # 화살촉
        d.add(Line(x2 - 2*mm, arrow_y, x2 - 5*mm, arrow_y + 2*mm, strokeColor=colors.HexColor("#64748B"), strokeWidth=1.5))
        d.add(Line(x2 - 2*mm, arrow_y, x2 - 5*mm, arrow_y - 2*mm, strokeColor=colors.HexColor("#64748B"), strokeWidth=1.5))

    # 경사 기준 표시
    pipe_d = ruleset.get("pipe_diameter_mm", 100)
    slope = ruleset.get("pipe_slope_min_pct", 1.0)
    d.add(String(42*mm, arrow_y + 7*mm, f"Ø{pipe_d}mm / {slope}%↘", fontSize=7, fontName=FONT_NAME, fillColor=colors.HexColor("#94A3B8")))

    return d


def generate_capacity_pdf(order_id: str, req, computed: dict) -> bytes:
    """용량산정서 PDF 생성"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm, title="용량산정서")
    elements = []

    elements.append(Paragraph("정화조 용량산정서 (제출용 초안)", _style(16, bold=True, align=TA_CENTER)))
    elements.append(Spacer(1, 4*mm))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB")))
    elements.append(Spacer(1, 6*mm))

    # 신청 정보
    elements.append(Paragraph("1. 신청 정보", _style(11, bold=True)))
    elements.append(Spacer(1, 2*mm))
    info_data = [
        ["신청인", req.applicant_name, "연락처", req.phone or "-"],
        ["이메일", req.email or "-", "주문번호", order_id],
        ["설치 주소", req.address, "", ""],
    ]
    t1 = Table(info_data, colWidths=[30*mm, 60*mm, 30*mm, 50*mm])
    t1.setStyle(_common_table_style())
    elements.append(t1)
    elements.append(Spacer(1, 5*mm))

    # 산정 입력값
    elements.append(Paragraph("2. 산정 입력값", _style(11, bold=True)))
    elements.append(Spacer(1, 2*mm))
    input_data = [
        ["항목", "입력값", "비고"],
        ["화장실 유형", req.toilet_type.value, "FLUSH=수세식, PORTABLE=이동식, HOLDING_TANK=저장조"],
        ["처리 방식", req.treatment_mode.value, "SEPTIC_DISCHARGE=방류형, INFILTRATION=침투형"],
        ["상시 인원", f"{req.occupants_regular} 명", "일상적 이용 인원"],
        ["최대 인원", f"{req.occupants_max} 명", "용량 산정 기준 인원"],
        ["농막 면적", f"{req.hut_area_m2} ㎡", "건축물 기준"],
    ]
    t2 = Table(input_data, colWidths=[45*mm, 45*mm, 80*mm])
    t2.setStyle(_header_table_style())
    elements.append(t2)
    elements.append(Spacer(1, 5*mm))

    # 산정 기준 테이블
    elements.append(Paragraph("3. 정화조 용량 산정 기준표 (대전 유성구 기준)", _style(11, bold=True)))
    elements.append(Spacer(1, 2*mm))
    ruleset = computed.get("ruleset", {})
    cap_rules = ruleset.get("septic_capacity_rules", [])
    cap_data = [["최대 인원(명)", "권장 정화조 용량(m³)", "적용 여부"]]
    labels = ["2명 이하", "5명 이하", "8명 이하", "9명 이상"]
    for i, rule in enumerate(cap_rules):
        applied = "✓ 적용" if rule["capacity_m3"] == computed["septic_capacity_m3"] else ""
        lbl = labels[i] if i < len(labels) else f"{rule['max_occupants']}명 이하"
        cap_data.append([lbl, f"{rule['capacity_m3']} m³", applied])
    t3 = Table(cap_data, colWidths=[55*mm, 65*mm, 50*mm])
    style3 = _header_table_style()
    # 적용 행 하이라이트
    for i, row in enumerate(cap_data[1:], 1):
        if "✓" in row[2]:
            style3.add("BACKGROUND", (0, i), (-1, i), colors.HexColor("#DCFCE7"))
            style3.add("TEXTCOLOR", (2, i), (2, i), colors.HexColor("#166534"))
            style3.add("FONTNAME", (2, i), (2, i), FONT_BOLD)
    t3.setStyle(style3)
    elements.append(t3)
    elements.append(Spacer(1, 5*mm))

    # 최종 결과
    elements.append(Paragraph("4. 산정 결과", _style(11, bold=True)))
    elements.append(Spacer(1, 2*mm))
    result_data = [
        ["항목", "결과"],
        ["최대 인원", f"{req.occupants_max} 명"],
        ["권장 정화조 용량", f"{computed['septic_capacity_m3']} m³"],
        ["적용 룰셋", computed["ruleset_id"]],
        ["리스크 플래그", ", ".join(computed.get("risk_flags", [])) or "없음"],
    ]
    t4 = Table(result_data, colWidths=[60*mm, 110*mm])
    style4 = _header_table_style()
    style4.add("BACKGROUND", (0, 2), (-1, 2), colors.HexColor("#FEF9C3"))
    style4.add("FONTNAME", (1, 2), (1, 2), FONT_BOLD)
    style4.add("FONTSIZE", (1, 2), (1, 2), 12)
    t4.setStyle(style4)
    elements.append(t4)
    elements.append(Spacer(1, 5*mm))

    # 주의사항
    elements.append(Paragraph("5. 주의사항", _style(10, bold=True)))
    elements.append(Spacer(1, 2*mm))
    notes_list = [
        "본 용량 산정은 대전 유성구 기준 템플릿에 의한 초안이며, 관할 지자체 최종 확인이 필요합니다.",
        "정화조 설치 전 관할 환경부/지자체에 개인하수처리시설 신고가 의무입니다.",
        "실제 현장 여건(토질, 지하수위 등)에 따라 용량 및 방식이 변경될 수 있습니다.",
        "등록된 시공업체(정화조 전문)에 최종 설계 및 시공을 의뢰하여야 합니다.",
    ]
    for n in notes_list:
        elements.append(Paragraph(f"  • {n}", _style(9)))
    elements.append(Spacer(1, 4*mm))

    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#94A3B8")))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(DISCLAIMER, _style(8, color=colors.HexColor("#64748B"))))

    doc.build(elements)
    return buf.getvalue()


def generate_checklist_pdf(order_id: str, req, computed: dict) -> bytes:
    """제출 체크리스트 PDF 생성"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            rightMargin=20*mm, leftMargin=20*mm,
                            topMargin=20*mm, bottomMargin=20*mm, title="제출 체크리스트")
    elements = []

    elements.append(Paragraph("제출 체크리스트 (제출용 초안)", _style(16, bold=True, align=TA_CENTER)))
    elements.append(Spacer(1, 3*mm))
    elements.append(Paragraph(f"주문번호: {order_id}  |  신청인: {req.applicant_name}  |  주소: {req.address}",
                               _style(9, align=TA_CENTER, color=colors.HexColor("#64748B"))))
    elements.append(Spacer(1, 4*mm))
    elements.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563EB")))
    elements.append(Spacer(1, 5*mm))

    def section(title, items, color="#1E40AF"):
        elements.append(Paragraph(title, _style(11, bold=True, color=colors.HexColor(color))))
        elements.append(Spacer(1, 2*mm))
        for item, note in items:
            row = Table([[f"  □ {item}", note]], colWidths=[100*mm, 70*mm])
            row.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("TEXTCOLOR", (1, 0), (1, 0), colors.HexColor("#64748B")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 2),
            ]))
            elements.append(row)
        elements.append(Spacer(1, 4*mm))

    # 농막 관련 서류
    section("1. 농막(가설건축물) 관련 서류", [
        ("가설건축물 축조신고서", "관할 시군구 건축과"),
        ("농막 배치도 (본 초안 활용)", "정밀 측량 권장"),
        ("토지 등기부등본", "최근 3개월 이내 발급"),
        ("토지이용계획확인서", "토지 용도지역 확인"),
        ("농지 원부 또는 영농확인서", "농지법 적용 확인"),
        ("인감증명서 또는 본인서명사실확인서", "신청인 본인 기준"),
    ])

    # 정화조 관련 서류
    section("2. 개인하수처리시설(정화조) 관련 서류", [
        ("개인하수처리시설 설치신고서", "관할 시군구 환경과/하수도과"),
        ("정화조 배치도/배관도 (본 초안 활용)", "등록 시공업체 최종 확인 필요"),
        ("용량산정서 (본 초안 활용)", "시공업체 검토 후 제출"),
        ("정화조 제품 사양서/형식승인서", "시공업체 제공"),
        ("시공업체 등록증 사본", "전문업체 등록 확인"),
        ("토지 동의서 또는 토지사용승낙서", "해당 시 첨부"),
    ])

    # 상담 및 리스크 확인
    risk_items = [
        ("관할 지자체(건축과) 사전 상담 완료", "농막 허용 여부 등 확인"),
        ("관할 지자체(환경과) 사전 상담 완료", "정화조 방류 기준 확인"),
        ("등록 시공업체 현장 답사 예약", "배관/정화조 현장 확인"),
    ]
    if "WATER_AREA_POSSIBLE" in computed.get("risk_flags", []):
        risk_items.append(("수변구역 여부 지자체 확인 필수", "⚠ 리스크 플래그 WATER_AREA_POSSIBLE 발생"))
    if "TREATMENT_MODE_UNCERTAIN" in computed.get("risk_flags", []):
        risk_items.append(("처리 방식(방류/침투) 시공 전 확정 필수", "⚠ 리스크 플래그 TREATMENT_MODE_UNCERTAIN 발생"))
    section("3. 상담 및 리스크 확인", risk_items, color="#DC2626")

    # 최종 제출 전 확인
    section("4. 최종 제출 전 확인", [
        ("본 패키지의 모든 초안 서류를 지자체 양식에 맞게 재작성", "초안 → 공식 서식으로 변환"),
        ("모든 치수 및 용량 수치 재검토", "현장 조건 반영 여부 확인"),
        ("서명 및 날인 완료", "신청인 자필 서명"),
        ("첨부서류 누락 여부 최종 점검", "담당 부서 문의 권장"),
        ("접수 방법 확인 (방문/온라인)", "관할 지자체 별도 확인"),
    ])

    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#94A3B8")))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(DISCLAIMER, _style(8, color=colors.HexColor("#64748B"))))

    doc.build(elements)
    return buf.getvalue()


def generate_disclaimer_pdf(order_id: str, req, computed: dict) -> bytes:
    """면책 및 사용 안내 PDF 생성"""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            rightMargin=25*mm, leftMargin=25*mm,
                            topMargin=25*mm, bottomMargin=25*mm, title="면책 및 사용 안내")
    elements = []

    elements.append(Paragraph("면책 및 사용 안내", _style(18, bold=True, align=TA_CENTER)))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph("농막 도면 생성 시스템", _style(11, align=TA_CENTER, color=colors.HexColor("#2563EB"))))
    elements.append(Spacer(1, 5*mm))
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor("#2563EB")))
    elements.append(Spacer(1, 6*mm))

    sections = [
        ("1. 본 패키지의 성격", [
            "본 패키지는 농막(가설건축물) 및 개인하수처리시설(정화조) 설치를 위한 제출용 초안 문서 패키지입니다.",
            "시스템은 사용자가 입력한 정보를 바탕으로 규칙 기반(Rule-based) 알고리즘을 통해 자동 생성된 초안을 제공합니다.",
            "본 패키지에 포함된 배치도, 배관도, 용량산정서, 신고서 초안은 '초안(Draft)' 성격이며, 공식 인허가용 최종 문서가 아닙니다.",
        ]),
        ("2. 승인·허가 미보장", [
            "본 패키지의 내용이 관할 지자체의 인허가를 보장하지 않습니다.",
            "농막 및 정화조 관련 규정은 지자체별, 지역별로 상이할 수 있으며, 본 시스템은 대전 유성구 기준 템플릿을 기반으로 합니다.",
            "최종 인허가 여부는 관할 시군구청(건축과, 환경과 등)의 검토 결과에 따릅니다.",
        ]),
        ("3. 검토 의무", [
            "최종 제출 전 반드시 관할 지자체(시군구) 담당 부서에 사전 상담 및 검토를 받아야 합니다.",
            "정화조 설치 및 배관 공사는 반드시 등록된 전문 시공업체에 의뢰하여야 합니다.",
            "치수, 용량, 배관 경로 등 모든 기술적 수치는 현장 실측 및 전문가 검토를 통해 최종 확정되어야 합니다.",
        ]),
        ("4. 책임 한계", [
            "본 시스템 및 운영자는 본 패키지 사용으로 인한 인허가 거부, 공사 오류, 법적 문제 등에 대해 책임을 지지 않습니다.",
            "본 시스템은 정보 제공 및 초안 생성 도구로만 사용되어야 하며, 전문 설계 용역 또는 법적 문서를 대체하지 않습니다.",
        ]),
        ("5. 사용 방법", [
            "본 패키지의 각 파일을 참고하여 관할 지자체 공식 서식에 맞게 재작성하시기 바랍니다.",
            "신고서 초안(.docx)은 MS Word 또는 한글(HWP)로 열어 내용을 수정 후 제출하시기 바랍니다.",
            "배치도/배관도 PDF는 참고용 개념도이며, 정밀 GIS/지적 도면은 측량 전문업체에 별도 의뢰하시기 바랍니다.",
            "체크리스트를 활용하여 누락 서류 없이 제출 준비를 완료하시기 바랍니다.",
        ]),
    ]

    for title, items in sections:
        elements.append(Paragraph(title, _style(11, bold=True, color=colors.HexColor("#1E40AF"))))
        elements.append(Spacer(1, 2*mm))
        for item in items:
            elements.append(Paragraph(f"  • {item}", _style(9)))
        elements.append(Spacer(1, 4*mm))

    # 주문 정보
    elements.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#CBD5E1")))
    elements.append(Spacer(1, 3*mm))
    elements.append(Paragraph("■ 주문 정보", _style(10, bold=True)))
    elements.append(Spacer(1, 2*mm))
    info = [
        ["주문번호", order_id, "신청인", req.applicant_name],
        ["주소", req.address, "정화조 용량", f"{computed['septic_capacity_m3']} m³"],
        ["상품 유형", req.product_type.value, "룰셋", computed["ruleset_id"]],
    ]
    ti = Table(info, colWidths=[30*mm, 60*mm, 35*mm, 45*mm])
    ti.setStyle(_common_table_style())
    elements.append(ti)
    elements.append(Spacer(1, 5*mm))

    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#94A3B8")))
    elements.append(Spacer(1, 2*mm))
    elements.append(Paragraph(
        "본 패키지는 '농막 도면 생성' 시스템에 의해 자동 생성된 제출용 초안입니다. "
        "최종 제출 전 관할 지자체 및 등록 시공업체의 검토가 반드시 필요합니다.",
        _style(8, color=colors.HexColor("#64748B"), align=TA_CENTER)
    ))

    doc.build(elements)
    return buf.getvalue()


def _common_table_style():
    return TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EFF6FF")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#EFF6FF")),
        ("FONTNAME", (0, 0), (0, -1), FONT_BOLD),
        ("FONTNAME", (2, 0), (2, -1), FONT_BOLD),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 4),
    ])


def _header_table_style():
    return TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), FONT_NAME),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E40AF")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ])
