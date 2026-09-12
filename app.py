"""
BodyComp Tracker - a simple local web app for logging body composition
and health metrics (weight, sleep, macros, calories, steps).

Run with:  python3 app.py
Then open: http://127.0.0.1:5050
"""

import csv
import io
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request, Response

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "bodycomp.db"

app = Flask(__name__)

# Canonical column order used everywhere (DB, CSV import/export, API payloads).
COLUMNS = [
    "date",
    "weight",
    "sleep_hours",
    "sleep_score",
    "deep_sleep_minutes",
    "protein_g",
    "fat_g",
    "carbs_g",
    "calories_intake",
    "calories_goal",
    "steps",
]

# Accepts a range of human-friendly header spellings when importing a CSV.
HEADER_ALIASES = {
    "date": "date",
    "weight": "weight",
    "weight_lbs": "weight",
    "sleep": "sleep_hours",
    "sleep_hours": "sleep_hours",
    "sleep_hrs": "sleep_hours",
    "sleep_score": "sleep_score",
    "deep_sleep": "deep_sleep_minutes",
    "deep_sleep_minutes": "deep_sleep_minutes",
    "deep_sleep_min": "deep_sleep_minutes",
    "protein": "protein_g",
    "protein_g": "protein_g",
    "fat": "fat_g",
    "fats": "fat_g",
    "fat_g": "fat_g",
    "carbs": "carbs_g",
    "carbs_g": "carbs_g",
    "carbohydrates": "carbs_g",
    "calories_intake": "calories_intake",
    "calorie_intake": "calories_intake",
    "calories": "calories_intake",
    "daily_calories": "calories_intake",
    "calories_goal": "calories_goal",
    "calorie_goal": "calories_goal",
    "calorie_target": "calories_goal",
    "goal_calories": "calories_goal",
    "steps": "steps",
    "daily_steps": "steps",
}

NUMERIC_COLUMNS = [c for c in COLUMNS if c != "date"]


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT UNIQUE NOT NULL,
            weight REAL,
            sleep_hours REAL,
            sleep_score REAL,
            deep_sleep_minutes REAL,
            protein_g REAL,
            fat_g REAL,
            carbs_g REAL,
            calories_intake REAL,
            calories_goal REAL,
            steps REAL
        )
        """
    )
    conn.commit()
    conn.close()


def normalize_header(name):
    key = name.strip().lower().replace(" ", "_").replace("-", "_")
    key = key.replace("(", "").replace(")", "")
    return HEADER_ALIASES.get(key)


DATE_FORMATS = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d-%m-%Y"]


def normalize_date(value):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def to_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    value = str(value).strip()
    if value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def row_to_dict(row):
    return {col: row[col] for col in ["id"] + COLUMNS}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/entries", methods=["GET"])
def list_entries():
    db = get_db()
    rows = db.execute("SELECT * FROM entries ORDER BY date ASC").fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route("/api/entries", methods=["POST"])
def upsert_entry():
    payload = request.get_json(force=True, silent=True) or {}
    date = normalize_date(payload.get("date"))
    if not date:
        return jsonify({"error": "A valid date is required."}), 400

    values = {col: to_number(payload.get(col)) for col in NUMERIC_COLUMNS}

    db = get_db()
    db.execute(
        """
        INSERT INTO entries (date, weight, sleep_hours, sleep_score, deep_sleep_minutes,
                              protein_g, fat_g, carbs_g, calories_intake, calories_goal, steps)
        VALUES (:date, :weight, :sleep_hours, :sleep_score, :deep_sleep_minutes,
                :protein_g, :fat_g, :carbs_g, :calories_intake, :calories_goal, :steps)
        ON CONFLICT(date) DO UPDATE SET
            weight=excluded.weight,
            sleep_hours=excluded.sleep_hours,
            sleep_score=excluded.sleep_score,
            deep_sleep_minutes=excluded.deep_sleep_minutes,
            protein_g=excluded.protein_g,
            fat_g=excluded.fat_g,
            carbs_g=excluded.carbs_g,
            calories_intake=excluded.calories_intake,
            calories_goal=excluded.calories_goal,
            steps=excluded.steps
        """,
        {"date": date, **values},
    )
    db.commit()
    row = db.execute("SELECT * FROM entries WHERE date = ?", (date,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/entries/<int:entry_id>", methods=["DELETE"])
def delete_entry(entry_id):
    db = get_db()
    db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/import", methods=["POST"])
def import_csv():
    file = request.files.get("file")
    if file is None:
        return jsonify({"error": "No file was uploaded."}), 400

    try:
        text = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return jsonify({"error": "Could not read that file. Please upload a CSV file."}), 400

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return jsonify({"error": "The CSV file appears to be empty."}), 400

    column_map = {}
    for raw_header in reader.fieldnames:
        canonical = normalize_header(raw_header)
        if canonical:
            column_map[raw_header] = canonical

    if "date" not in column_map.values():
        return jsonify({"error": "The CSV must include a 'date' column (YYYY-MM-DD)."}), 400

    db = get_db()
    inserted = 0
    updated = 0
    skipped = []

    for line_number, raw_row in enumerate(reader, start=2):
        row = {}
        for raw_header, value in raw_row.items():
            canonical = column_map.get(raw_header)
            if canonical:
                row[canonical] = value

        date = normalize_date(row.get("date"))
        if not date:
            skipped.append({"line": line_number, "reason": "missing or unrecognized date"})
            continue

        values = {col: to_number(row.get(col)) for col in NUMERIC_COLUMNS}

        existing = db.execute("SELECT id FROM entries WHERE date = ?", (date,)).fetchone()
        db.execute(
            """
            INSERT INTO entries (date, weight, sleep_hours, sleep_score, deep_sleep_minutes,
                                  protein_g, fat_g, carbs_g, calories_intake, calories_goal, steps)
            VALUES (:date, :weight, :sleep_hours, :sleep_score, :deep_sleep_minutes,
                    :protein_g, :fat_g, :carbs_g, :calories_intake, :calories_goal, :steps)
            ON CONFLICT(date) DO UPDATE SET
                weight=excluded.weight,
                sleep_hours=excluded.sleep_hours,
                sleep_score=excluded.sleep_score,
                deep_sleep_minutes=excluded.deep_sleep_minutes,
                protein_g=excluded.protein_g,
                fat_g=excluded.fat_g,
                carbs_g=excluded.carbs_g,
                calories_intake=excluded.calories_intake,
                calories_goal=excluded.calories_goal,
                steps=excluded.steps
            """,
            {"date": date, **values},
        )
        if existing:
            updated += 1
        else:
            inserted += 1

    db.commit()
    return jsonify({"inserted": inserted, "updated": updated, "skipped": skipped})


@app.route("/api/export")
def export_csv():
    db = get_db()
    rows = db.execute("SELECT * FROM entries ORDER BY date ASC").fetchall()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS)
    for row in rows:
        writer.writerow([row[col] if row[col] is not None else "" for col in COLUMNS])

    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=bodycomp_export.csv"},
    )


@app.route("/api/template")
def download_template():
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(COLUMNS)
    writer.writerow(
        ["2026-01-05", 189.4, 7.5, 82, 95, 165, 70, 210, 2200, 2100, 8500]
    )
    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=bodycomp_template.csv"},
    )


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=True)
