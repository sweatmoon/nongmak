import json
from pathlib import Path
from app.config import RULESETS_DIR
from app.models import OrderRequest


def load_ruleset(region_code: str, version: str = "v1") -> dict:
    path = RULESETS_DIR / f"{region_code}.{version}.json"
    if not path.exists():
        raise FileNotFoundError(f"Ruleset not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def calc_septic_capacity(occupants_max: int, ruleset: dict) -> float:
    for rule in ruleset["septic_capacity_rules"]:
        if occupants_max <= rule["max_occupants"]:
            return rule["capacity_m3"]
    return 4.0


def calc_risk_flags(req: OrderRequest, ruleset: dict) -> list:
    flags = []
    notes = (req.notes or "").strip()

    water_keywords = ruleset.get("risk_keywords_water", ["저수지", "수변", "하천"])
    for kw in water_keywords:
        if kw in notes:
            flags.append("WATER_AREA_POSSIBLE")
            break

    from app.models import ToiletType, TreatmentMode
    if req.toilet_type == ToiletType.FLUSH and req.treatment_mode == TreatmentMode.UNKNOWN:
        flags.append("TREATMENT_MODE_UNCERTAIN")

    return flags


def compute_order(req: OrderRequest) -> dict:
    ruleset = load_ruleset(req.region_code)
    ruleset_id = f"{req.region_code}.v1"
    capacity = calc_septic_capacity(req.occupants_max, ruleset)
    risk_flags = calc_risk_flags(req, ruleset)

    return {
        "ruleset_id": ruleset_id,
        "septic_capacity_m3": capacity,
        "risk_flags": risk_flags,
        "ruleset": ruleset,
    }
