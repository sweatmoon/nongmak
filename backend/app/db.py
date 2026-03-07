import sqlite3
import json
from pathlib import Path
from app.config import DB_PATH


def get_connection():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_connection()
    # 기존 테이블 생성
    conn.execute("""
        CREATE TABLE IF NOT EXISTS orders (
            order_id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            region_code TEXT NOT NULL,
            ruleset_id TEXT NOT NULL,
            applicant_name TEXT,
            email TEXT,
            phone TEXT,
            address TEXT,
            inputs_json TEXT,
            computed_json TEXT,
            zip_path TEXT,
            parcel_json TEXT,
            revision_count INTEGER DEFAULT 0,
            max_revision INTEGER DEFAULT 3
        )
    """)
    # 기존 DB에 새 컬럼 추가 (마이그레이션)
    _migrate_add_column(conn, "orders", "parcel_json", "TEXT")
    _migrate_add_column(conn, "orders", "revision_count", "INTEGER DEFAULT 0")
    _migrate_add_column(conn, "orders", "max_revision", "INTEGER DEFAULT 3")
    conn.commit()
    conn.close()


def _migrate_add_column(conn, table: str, column: str, col_type: str):
    """컬럼이 없으면 추가 (ALTER TABLE)"""
    try:
        existing = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        if column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
    except Exception:
        pass


def insert_order(order: dict):
    conn = get_connection()
    conn.execute("""
        INSERT INTO orders (
            order_id, created_at, region_code, ruleset_id,
            applicant_name, email, phone, address,
            inputs_json, computed_json, zip_path,
            parcel_json, revision_count, max_revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        order["order_id"],
        order["created_at"],
        order["region_code"],
        order["ruleset_id"],
        order.get("applicant_name"),
        order.get("email"),
        order.get("phone"),
        order.get("address"),
        json.dumps(order.get("inputs_json", {}), ensure_ascii=False),
        json.dumps(order.get("computed_json", {}), ensure_ascii=False),
        order.get("zip_path"),
        json.dumps(order.get("parcel_json"), ensure_ascii=False) if order.get("parcel_json") else None,
        order.get("revision_count", 0),
        order.get("max_revision", 3),
    ))
    conn.commit()
    conn.close()


def update_order_zip(order_id: str, zip_path: str, computed_json: dict, revision_count: int):
    """수정 후 재생성 시 ZIP 경로 및 revision_count 업데이트"""
    conn = get_connection()
    conn.execute("""
        UPDATE orders SET zip_path=?, computed_json=?, revision_count=?
        WHERE order_id=?
    """, (
        zip_path,
        json.dumps(computed_json, ensure_ascii=False),
        revision_count,
        order_id,
    ))
    conn.commit()
    conn.close()


def get_order(order_id: str):
    conn = get_connection()
    row = conn.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None


def list_orders(limit: int = 50):
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
