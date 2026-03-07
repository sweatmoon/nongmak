from pydantic import BaseModel, Field
from typing import Optional, List, Any
from enum import Enum


class ProductType(str, Enum):
    BUNDLE = "BUNDLE"
    SEPTIC_ONLY = "SEPTIC_ONLY"


class PlacementHint(str, Enum):
    CENTER = "CENTER"
    NORTH = "NORTH"
    SOUTH = "SOUTH"
    EAST = "EAST"
    WEST = "WEST"


class ToiletType(str, Enum):
    FLUSH = "FLUSH"
    PORTABLE = "PORTABLE"
    HOLDING_TANK = "HOLDING_TANK"


class TreatmentMode(str, Enum):
    SEPTIC_DISCHARGE = "SEPTIC_DISCHARGE"
    INFILTRATION = "INFILTRATION"
    UNKNOWN = "UNKNOWN"


class ParcelInfo(BaseModel):
    """지적도 필지 정보"""
    jibun: Optional[str] = None
    area_m2: Optional[float] = None
    jimok: Optional[str] = None
    yongdo: Optional[str] = None
    polygon_wgs84: Optional[List[List[float]]] = None
    polygon_local: Optional[List[List[float]]] = None
    centroid: Optional[dict] = None
    is_mock: Optional[bool] = False


class OrderRequest(BaseModel):
    product_type: ProductType = ProductType.BUNDLE
    region_code: str = "KR-DJ-YS"
    applicant_name: str = Field(..., min_length=1)
    email: Optional[str] = None
    phone: Optional[str] = None
    address: str = Field(..., min_length=1)
    hut_area_m2: float = Field(..., gt=0, le=33)
    hut_w_m: float = Field(..., gt=0)
    hut_d_m: float = Field(..., gt=0)
    placement_hint: PlacementHint = PlacementHint.CENTER
    occupants_regular: int = Field(..., ge=1)
    occupants_max: int = Field(..., ge=1)
    toilet_type: ToiletType = ToiletType.FLUSH
    treatment_mode: TreatmentMode = TreatmentMode.SEPTIC_DISCHARGE
    notes: Optional[str] = ""
    # 지적도 필지 정보 (지도 선택 시 첨부)
    parcel: Optional[ParcelInfo] = None


class OrderResponse(BaseModel):
    order_id: str
    ruleset_id: str
    septic_capacity_m3: float
    risk_flags: List[str]
    download_url: str
    parcel: Optional[ParcelInfo] = None
    revision_count: int = 0
    max_revision: int = 3


class ReviseRequest(BaseModel):
    """수정 후 재생성 요청"""
    hut_area_m2: Optional[float] = None
    hut_w_m: Optional[float] = None
    hut_d_m: Optional[float] = None
    placement_hint: Optional[PlacementHint] = None
    occupants_regular: Optional[int] = None
    occupants_max: Optional[int] = None
    toilet_type: Optional[ToiletType] = None
    treatment_mode: Optional[TreatmentMode] = None
    notes: Optional[str] = None
    parcel: Optional[ParcelInfo] = None


class OrderRecord(BaseModel):
    order_id: str
    created_at: str
    region_code: str
    ruleset_id: str
    applicant_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    inputs_json: Optional[Any]
    computed_json: Optional[Any]
    zip_path: Optional[str]
    parcel_json: Optional[Any] = None
    revision_count: int = 0
    max_revision: int = 3
