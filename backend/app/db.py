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
            zip_path TEXT
        )
    """)
    conn.commit()
    conn.close()


def insert_order(order: dict):
    conn = get_connection()
    conn.execute("""
        INSERT INTO orders (
            order_id, created_at, region_code, ruleset_id,
            applicant_name, email, phone, address,
            inputs_json, computed_json, zip_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
