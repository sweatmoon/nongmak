from pydantic import BaseModel, Field
from typing import Optional, List
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


class OrderResponse(BaseModel):
    order_id: str
    ruleset_id: str
    septic_capacity_m3: float
    risk_flags: List[str]
    download_url: str


class OrderRecord(BaseModel):
    order_id: str
    created_at: str
    region_code: str
    ruleset_id: str
    applicant_name: Optional[str]
    email: Optional[str]
    phone: Optional[str]
    address: Optional[str]
    inputs_json: Optional[dict]
    computed_json: Optional[dict]
    zip_path: Optional[str]
