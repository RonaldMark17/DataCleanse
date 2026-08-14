import uuid
import os
import io
import pandas as pd
import numpy as np
from flask import Flask, render_template, request, jsonify, send_file, Response, session, redirect, url_for
from analytics_engine import AnalyticsEngine

import json

app = Flask(__name__)
app.config['SECRET_KEY'] = 'antigravity-data-analytics-secret-key-2026'
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # 32MB max upload

SESSION_DIR = os.path.join(os.path.dirname(__file__), 'session_data')
os.makedirs(SESSION_DIR, exist_ok=True)
CACHE_FILE = os.path.join(SESSION_DIR, 'active_dataset.pkl')
META_FILE = os.path.join(SESSION_DIR, 'active_metadata.json')

# Global state for current active session (in-memory dataset store)
DATASTORE = {
    "df": None,
    "dataset_name": "No File Uploaded",
    "cleaning_history": []
}

def save_session_to_disk():
    global DATASTORE
    try:
        if DATASTORE["df"] is not None:
            DATASTORE["df"].to_pickle(CACHE_FILE)
            meta = {
                "dataset_name": DATASTORE["dataset_name"],
                "cleaning_history": DATASTORE["cleaning_history"]
            }
            with open(META_FILE, 'w') as f:
                json.dump(meta, f)
        else:
            if os.path.exists(CACHE_FILE): os.remove(CACHE_FILE)
            if os.path.exists(META_FILE): os.remove(META_FILE)
    except Exception as e:
        print(f"Session save error: {e}")

def load_session_from_disk():
    global DATASTORE
    try:
        if os.path.exists(CACHE_FILE) and os.path.exists(META_FILE):
            df = pd.read_pickle(CACHE_FILE)
            with open(META_FILE, 'r') as f:
                meta = json.load(f)
            DATASTORE["df"] = df
            DATASTORE["dataset_name"] = meta.get("dataset_name", "Uploaded Dataset")
            DATASTORE["cleaning_history"] = meta.get("cleaning_history", [])
            print(f"Loaded active session dataset '{DATASTORE['dataset_name']}' ({len(df)} rows).")
    except Exception as e:
        print(f"Session load error: {e}")

# Load session on module load
load_session_from_disk()

def get_active_df():
    if DATASTORE.get("df") is None:
        load_session_from_disk()
    return DATASTORE.get("df")

# =============================================================================
# AUTHENTICATION SYSTEM
# =============================================================================
from functools import wraps

VALID_CREDENTIALS = {
    "username": "admin",
    "password": "admin123"
}

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            # For API routes, return 401 JSON
            if request.path.startswith('/api/'):
                return jsonify({"error": "Authentication required."}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'):
        return redirect(url_for('index'))

    if request.method == 'GET':
        return render_template('login.html', error=None)

    # Handle POST (JSON from AJAX)
    if request.is_json:
        data = request.get_json()
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
    else:
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''

    if username == VALID_CREDENTIALS['username'] and password == VALID_CREDENTIALS['password']:
        session['logged_in'] = True
        session['user'] = username
        if request.is_json:
            return jsonify({"success": True, "redirect": "/"})
        return redirect(url_for('index'))
    else:
        if request.is_json:
            return jsonify({"success": False, "error": "Invalid username or password."}), 401
        return render_template('login.html', error="Invalid username or password.")

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.before_request
def require_login():
    """Protect all routes except /login, /logout, and static files."""
    allowed_paths = ['/login', '/logout']
    if request.path.startswith('/static/'):
        return  # Allow static files
    if request.path in allowed_paths:
        return  # Allow login/logout
    if not session.get('logged_in'):
        if request.path.startswith('/api/'):
            return jsonify({"error": "Authentication required."}), 401
        return redirect(url_for('login'))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    global DATASTORE
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded in request."}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected."}), 400
        
    filename = file.filename.lower()
    try:
        if filename.endswith('.csv'):
            df = pd.read_csv(file)
        elif filename.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file)
        else:
            return jsonify({"error": "Unsupported file format. Please upload a .csv or .xlsx file."}), 400
            
        # Deduplicate column names to prevent 2D DataFrame indexing conflicts
        cols = pd.Series(df.columns.astype(str))
        for dup in cols[cols.duplicated()].unique():
            cols[cols[cols == dup].index] = [f"{dup}_{i}" if i != 0 else dup for i in range((cols == dup).sum())]
        df.columns = cols.tolist()

        DATASTORE["df"] = df
        DATASTORE["dataset_name"] = file.filename
        DATASTORE["cleaning_history"] = [f"Uploaded '{file.filename}' with {len(df)} rows and {len(df.columns)} columns."]
        
        save_session_to_disk()

        return jsonify({
            "success": True,
            "filename": file.filename,
            "rows": len(df),
            "columns": len(df.columns)
        })
    except Exception as e:
        return jsonify({"error": f"Failed to parse file: {str(e)}"}), 500

@app.route('/api/clear', methods=['POST'])
def clear_session():
    global DATASTORE
    DATASTORE["df"] = None
    DATASTORE["dataset_name"] = "No File Uploaded"
    DATASTORE["cleaning_history"] = []
    save_session_to_disk()
    return jsonify({"success": True, "message": "Dataset session cleared."})

@app.route('/api/overview', methods=['GET'])
def get_overview():
    df = get_active_df()
    if df is None:
        return jsonify({
            "has_data": False,
            "dataset_name": "No File Uploaded",
            "audit": {
                "total_rows": 0,
                "total_columns": 0,
                "duplicate_rows": 0,
                "memory_mb": 0,
                "quality_score": 0,
                "total_missing_cells": 0,
                "columns": []
            },
            "insights": ["**Upload Required**: Please upload an Excel (.xlsx, .xls) or CSV (.csv) file to begin data validation, correlation analysis, and trend statistics."],
            "cleaning_history": [],
            "column_names": [],
            "numeric_columns": [],
            "categorical_columns": []
        })

    audit = AnalyticsEngine.audit_dataset(df)
    insights = AnalyticsEngine.generate_automated_insights(df)
    
    # Avoid pandas 3 string select_dtypes deprecation warning
    numeric_cols = [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])]
    categorical_cols = [col for col in df.columns if not pd.api.types.is_numeric_dtype(df[col])]
    
    return jsonify({
        "has_data": True,
        "dataset_name": DATASTORE["dataset_name"],
        "audit": audit,
        "insights": insights,
        "cleaning_history": DATASTORE["cleaning_history"],
        "column_names": df.columns.tolist(),
        "numeric_columns": numeric_cols,
        "categorical_columns": categorical_cols
    })

@app.route('/api/clean', methods=['POST'])
def clean_data():
    global DATASTORE
    df = get_active_df()
    if df is None:
        return jsonify({"error": "No dataset loaded to clean. Please upload a file first."}), 400

    actions = request.get_json() or {}
    df_clean, logs = AnalyticsEngine.clean_dataset(df, actions)
    
    DATASTORE["df"] = df_clean
    DATASTORE["cleaning_history"].extend(logs)
    save_session_to_disk()
    
    audit = AnalyticsEngine.audit_dataset(df_clean)
    
    return jsonify({
        "success": True,
        "logs": logs,
        "audit": audit
    })

@app.route('/api/correlation', methods=['GET'])
def get_correlation():
    df = get_active_df()
    if df is None:
        return jsonify({"error": "No dataset loaded. Please upload a file."})

    method = request.args.get('method', 'pearson')
    corr_res = AnalyticsEngine.compute_correlation(df, method=method)
    return jsonify(corr_res)

@app.route('/api/demographics', methods=['GET'])
def get_demographics():
    df = get_active_df()
    if df is None:
        return jsonify({"numeric_summary": [], "categorical_distributions": {}})

    dem = AnalyticsEngine.compute_demographics(df)
    return jsonify(dem)

@app.route('/api/trend', methods=['POST'])
def get_trend():
    df = get_active_df()
    if df is None:
        return jsonify({"error": "No dataset loaded. Please upload a file."}), 400

    data = request.get_json() or {}
    x_col = data.get('x_col')
    y_col = data.get('y_col')
    aggregation = data.get('aggregation', 'sum')
    
    try:
        if not x_col or not y_col:
            all_cols = df.columns.tolist()
            num_cols = [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])]
            if len(all_cols) >= 2 and len(num_cols) >= 1:
                x_col = all_cols[0]
                y_col = num_cols[0] if num_cols[0] != x_col and len(num_cols) > 1 else (num_cols[0] if len(all_cols) > 1 else all_cols[1])
            else:
                return jsonify({"error": "At least 2 columns (1 numeric for Y-axis) are required for trend analysis."}), 400
                
        res = AnalyticsEngine.compute_trend_analysis(df, x_col, y_col, aggregation)
        if "error" in res:
            return jsonify(res), 400
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": f"Trend Analysis computation error: {str(e)}"}), 400

@app.route('/api/records', methods=['GET'])
def get_records():
    df = get_active_df()
    if df is None:
        return jsonify({
            "records": [],
            "total_records": 0,
            "page": 1,
            "per_page": 15,
            "total_pages": 1,
            "columns": []
        })

    page = int(request.args.get('page', 1))
    per_page = int(request.args.get('per_page', 15))
    search_term = request.args.get('search', '').strip().lower()
    sort_by = request.args.get('sort_by', '')
    sort_dir = request.args.get('sort_dir', 'asc')
    
    filtered_df = df.copy()
    
    # Global search across text columns
    if search_term:
        mask = np.column_stack([
            filtered_df[col].astype(str).str.lower().str.contains(search_term, na=False)
            for col in filtered_df.columns
        ]).any(axis=1)
        filtered_df = filtered_df[mask]
        
    # Sorting
    if sort_by and sort_by in filtered_df.columns:
        filtered_df.sort_values(by=sort_by, ascending=(sort_dir == 'asc'), inplace=True)
        
    total_records = len(filtered_df)
    total_pages = max(1, (total_records + per_page - 1) // per_page)
    
    start_idx = (page - 1) * per_page
    end_idx = start_idx + per_page
    
    page_df = filtered_df.iloc[start_idx:end_idx]
    
    import json
    records = json.loads(page_df.to_json(orient='records'))
    
    return jsonify({
        "records": records,
        "total_records": total_records,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "columns": df.columns.tolist()
    })

@app.route('/api/export/<fmt>', methods=['GET'])
def export_dataset(fmt):
    df = get_active_df()
    if df is None:
        return jsonify({"error": "No dataset loaded to export."}), 400

    if fmt == 'csv':
        output = io.StringIO()
        df.to_csv(output, index=False)
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment;filename=cleaned_dataset.csv"}
        )
    elif fmt == 'pdf':
        from report_generator import ExecutivePDFReportGenerator
        pdf_bytes = ExecutivePDFReportGenerator.generate_pdf_report(
            df=df,
            dataset_name=DATASTORE["dataset_name"],
            cleaning_history=DATASTORE["cleaning_history"]
        )
        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={"Content-Disposition": "inline; filename=integrated_executive_report.pdf"}
        )
    elif fmt == 'json':
        import json
        records = json.loads(df.to_json(orient='records'))
        return jsonify(records)
    return jsonify({"error": "Invalid export format"}), 400

# =============================================================================
# INVENTORY MANAGEMENT SYSTEM — SQLite Database & API Routes
# =============================================================================
import sqlite3

INVENTORY_DB = os.path.join(os.path.dirname(__file__), 'session_data', 'inventory.db')

def get_inv_db():
    """Get a connection to the inventory SQLite database."""
    conn = sqlite3.connect(INVENTORY_DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_inventory_db():
    """Create inventory tables if they don't exist."""
    conn = get_inv_db()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS stores (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL UNIQUE,
            description TEXT    DEFAULT '',
            status      TEXT    NOT NULL DEFAULT 'active',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            sku         TEXT    NOT NULL UNIQUE,
            category    TEXT    DEFAULT '',
            unit        TEXT    DEFAULT 'pcs',
            description TEXT    DEFAULT '',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS store_inventory (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id     INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
            item_id      INTEGER NOT NULL REFERENCES items(id)  ON DELETE CASCADE,
            qty_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK(qty_on_hand  >= 0),
            qty_on_store INTEGER NOT NULL DEFAULT 0 CHECK(qty_on_store >= 0),
            last_updated TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE(store_id, item_id)
        );
    """)
    conn.commit()
    conn.close()

# Initialize on module load
init_inventory_db()

# ── Inventory Page Route ──────────────────────────────────────────────────────
@app.route('/inventory')
def inventory_page():
    return render_template('inventory.html')

# ── Store CRUD ────────────────────────────────────────────────────────────────
@app.route('/api/inventory/stores', methods=['GET'])
def inv_get_stores():
    conn = get_inv_db()
    rows = conn.execute("SELECT * FROM stores ORDER BY name ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/inventory/stores', methods=['POST'])
def inv_create_store():
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip()
    if not name:
        return jsonify({"error": "Store name is required."}), 400
    conn = get_inv_db()
    try:
        c = conn.execute(
            "INSERT INTO stores (name, description) VALUES (?, ?)",
            (name, description)
        )
        store_id = c.lastrowid
        conn.commit()
        store = dict(conn.execute("SELECT * FROM stores WHERE id=?", (store_id,)).fetchone())
        conn.close()
        return jsonify(store), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": f"A store named '{name}' already exists."}), 409

@app.route('/api/inventory/stores/<int:store_id>', methods=['PUT'])
def inv_update_store(store_id):
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip()
    status = data.get('status', 'active')
    if not name:
        return jsonify({"error": "Store name is required."}), 400
    if status not in ('active', 'inactive'):
        return jsonify({"error": "Invalid status value."}), 400
    conn = get_inv_db()
    existing = conn.execute("SELECT id FROM stores WHERE id=?", (store_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Store not found."}), 404
    try:
        conn.execute(
            "UPDATE stores SET name=?, description=?, status=?, updated_at=datetime('now','localtime') WHERE id=?",
            (name, description, status, store_id)
        )
        conn.commit()
        store = dict(conn.execute("SELECT * FROM stores WHERE id=?", (store_id,)).fetchone())
        conn.close()
        return jsonify(store)
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": f"A store named '{name}' already exists."}), 409

@app.route('/api/inventory/stores/<int:store_id>', methods=['DELETE'])
def inv_delete_store(store_id):
    conn = get_inv_db()
    existing = conn.execute("SELECT * FROM stores WHERE id=?", (store_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Store not found."}), 404
    inv_count = conn.execute(
        "SELECT COUNT(*) as cnt FROM store_inventory WHERE store_id=?", (store_id,)
    ).fetchone()['cnt']
    if inv_count > 0:
        # Deactivate instead of hard-delete to preserve inventory data
        conn.execute(
            "UPDATE stores SET status='inactive', updated_at=datetime('now','localtime') WHERE id=?",
            (store_id,)
        )
        conn.commit()
        conn.close()
        return jsonify({"success": True, "deactivated": True,
                        "message": f"Store deactivated (has {inv_count} inventory record(s)). Inventory data preserved."})
    conn.execute("DELETE FROM stores WHERE id=?", (store_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "deactivated": False, "message": "Store permanently deleted."})

# ── Item CRUD ─────────────────────────────────────────────────────────────────
@app.route('/api/inventory/items', methods=['GET'])
def inv_get_items():
    conn = get_inv_db()
    rows = conn.execute("SELECT * FROM items ORDER BY name ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/inventory/all-items', methods=['GET'])
def inv_get_all_items_with_qty():
    """Return all items with aggregated quantities across all stores and their store breakdown."""
    conn = get_inv_db()
    items = conn.execute("SELECT id, name, sku, category, unit, description FROM items ORDER BY name ASC").fetchall()
    result = []
    for item in items:
        item_dict = dict(item)
        item_id = item_dict['id']
        assignments = conn.execute("""
            SELECT si.id as inv_id, si.store_id, s.name as store_name, si.qty_on_hand, si.qty_on_store, si.last_updated
            FROM store_inventory si
            JOIN stores s ON s.id = si.store_id
            WHERE si.item_id = ?
            ORDER BY s.name ASC
        """, (item_id,)).fetchall()
        
        breakdown = []
        total_on_hand = 0
        total_on_store = 0
        max_last_updated = None
        max_inv_id = None
        max_store_id = None
        
        for a in assignments:
            ad = dict(a)
            breakdown.append({
                "inv_id": ad['inv_id'],
                "store_id": ad['store_id'],
                "name": ad['store_name'],
                "qty": ad['qty_on_store'],
                "qty_on_hand": ad['qty_on_hand'],
                "qty_on_store": ad['qty_on_store']
            })
            total_on_hand += ad['qty_on_hand']
            total_on_store += ad['qty_on_store']
            max_inv_id = ad['inv_id']
            max_store_id = ad['store_id']
            if ad['last_updated'] and (not max_last_updated or ad['last_updated'] > max_last_updated):
                max_last_updated = ad['last_updated']
                
        item_dict['qty_on_hand'] = total_on_hand
        item_dict['qty_on_store'] = total_on_store
        item_dict['last_updated'] = max_last_updated
        item_dict['inv_id'] = max_inv_id
        item_dict['store_id'] = max_store_id
        item_dict['store_breakdown'] = breakdown
        result.append(item_dict)
        
    conn.close()
    return jsonify(result)

@app.route('/api/inventory/items', methods=['POST'])
def inv_create_item():
    data = request.get_json() or {}
    name        = (data.get('name') or '').strip()
    sku         = (data.get('sku') or '').strip()
    category    = (data.get('category') or '').strip()
    unit        = (data.get('unit') or 'pcs').strip()
    description = (data.get('description') or '').strip()
    if not name:
        return jsonify({"error": "Item name is required."}), 400
    if not sku:
        sku = f"AUTO-{uuid.uuid4().hex[:10].upper()}"
    conn = get_inv_db()
    try:
        c = conn.execute(
            "INSERT INTO items (name, sku, category, unit, description) VALUES (?,?,?,?,?)",
            (name, sku, category, unit, description)
        )
        item_id = c.lastrowid
        conn.commit()
        item = dict(conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())
        conn.close()
        return jsonify(item), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": f"An item with SKU '{sku}' already exists."}), 409

@app.route('/api/inventory/items/<int:item_id>', methods=['PUT'])
def inv_update_item(item_id):
    data = request.get_json() or {}
    name        = (data.get('name') or '').strip()
    sku         = (data.get('sku') or '').strip()
    category    = (data.get('category') or '').strip()
    unit        = (data.get('unit') or 'pcs').strip()
    description = (data.get('description') or '').strip()
    if not name:
        return jsonify({"error": "Item name is required."}), 400
    if not sku:
        sku = f"AUTO-{uuid.uuid4().hex[:10].upper()}"
    conn = get_inv_db()
    existing = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Item not found."}), 404
    try:
        conn.execute(
            "UPDATE items SET name=?, sku=?, category=?, unit=?, description=?, updated_at=datetime('now','localtime') WHERE id=?",
            (name, sku, category, unit, description, item_id)
        )
        conn.commit()
        item = dict(conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone())
        conn.close()
        return jsonify(item)
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": f"An item with SKU '{sku}' already exists."}), 409

@app.route('/api/inventory/items/<int:item_id>/store-assignments', methods=['POST'])
def inv_sync_store_assignments(item_id):
    data = request.get_json() or {}
    assignments = data.get('assignments', [])
    conn = get_inv_db()
    existing_item = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not existing_item:
        conn.close()
        return jsonify({"error": "Item not found."}), 404
        
    current_rows = conn.execute("SELECT id, store_id FROM store_inventory WHERE item_id=?", (item_id,)).fetchall()
    current_map = {row['store_id']: row['id'] for row in current_rows}
    
    new_store_ids = set()
    for assign in assignments:
        try:
            store_id = int(assign.get('store_id'))
            qty_store = int(assign.get('qty_on_store', assign.get('qty', 0)))
            qty_hand = int(assign.get('qty_on_hand', qty_store))
        except (ValueError, TypeError):
            continue
        
        if qty_store < 0 or qty_hand < 0:
            continue
            
        new_store_ids.add(store_id)
        if store_id in current_map:
            conn.execute(
                "UPDATE store_inventory SET qty_on_hand=?, qty_on_store=?, last_updated=datetime('now','localtime') WHERE id=?",
                (qty_hand, qty_store, current_map[store_id])
            )
        else:
            conn.execute(
                "INSERT INTO store_inventory (store_id, item_id, qty_on_hand, qty_on_store) VALUES (?,?,?,?)",
                (store_id, item_id, qty_hand, qty_store)
            )
            
    for s_id, inv_id in current_map.items():
        if s_id not in new_store_ids:
            conn.execute("DELETE FROM store_inventory WHERE id=?", (inv_id,))
            
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Store assignments updated successfully."})

@app.route('/api/inventory/items/<int:item_id>', methods=['DELETE'])
def inv_delete_item(item_id):
    conn = get_inv_db()
    existing = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Item not found."}), 404
    # Cascade: store_inventory records removed by FK ON DELETE CASCADE
    conn.execute("DELETE FROM items WHERE id=?", (item_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Item and all associated inventory records deleted."})

# ── Store-Inventory CRUD ──────────────────────────────────────────────────────
@app.route('/api/inventory/store-inventory', methods=['GET'])
def inv_get_store_inventory():
    store_id = request.args.get('store_id', type=int)
    conn = get_inv_db()
    if store_id:
        rows = conn.execute("""
            SELECT si.id, si.store_id, si.item_id, si.qty_on_hand, si.qty_on_store,
                   si.last_updated, i.name, i.sku, i.category, i.unit, i.description,
                   s.name as store_name
            FROM store_inventory si
            JOIN items i ON i.id = si.item_id
            JOIN stores s ON s.id = si.store_id
            WHERE si.store_id = ?
            ORDER BY i.name ASC
        """, (store_id,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT si.id, si.store_id, si.item_id, si.qty_on_hand, si.qty_on_store,
                   si.last_updated, i.name, i.sku, i.category, i.unit, i.description,
                   s.name as store_name
            FROM store_inventory si
            JOIN items i ON i.id = si.item_id
            JOIN stores s ON s.id = si.store_id
            ORDER BY s.name, i.name ASC
        """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route('/api/inventory/store-inventory', methods=['POST'])
def inv_create_store_inventory():
    data = request.get_json() or {}
    store_id     = data.get('store_id')
    item_id      = data.get('item_id')
    qty_on_hand  = data.get('qty_on_hand', 0)
    qty_on_store = data.get('qty_on_store', 0)
    if not store_id:
        return jsonify({"error": "Store is required."}), 400
    if not item_id:
        return jsonify({"error": "Item is required."}), 400
    try:
        qty_on_hand  = int(qty_on_hand)
        qty_on_store = int(qty_on_store)
    except (ValueError, TypeError):
        return jsonify({"error": "Quantities must be valid integers."}), 400
    if qty_on_hand < 0 or qty_on_store < 0:
        return jsonify({"error": "Quantities cannot be negative."}), 400
    conn = get_inv_db()
    store = conn.execute("SELECT id FROM stores WHERE id=?", (store_id,)).fetchone()
    if not store:
        conn.close()
        return jsonify({"error": "Selected store does not exist."}), 400
    item = conn.execute("SELECT id FROM items WHERE id=?", (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({"error": "Selected item does not exist."}), 400
    try:
        c = conn.execute(
            "INSERT INTO store_inventory (store_id, item_id, qty_on_hand, qty_on_store) VALUES (?,?,?,?)",
            (store_id, item_id, qty_on_hand, qty_on_store)
        )
        inv_id = c.lastrowid
        conn.commit()
        row = conn.execute("""
            SELECT si.*, i.name, i.sku, i.category, i.unit, i.description, s.name as store_name
            FROM store_inventory si JOIN items i ON i.id=si.item_id JOIN stores s ON s.id=si.store_id
            WHERE si.id=?
        """, (inv_id,)).fetchone()
        conn.close()
        return jsonify(dict(row)), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "This item already exists in the selected store. Use Edit to update quantities."}), 409

@app.route('/api/inventory/store-inventory/<int:inv_id>', methods=['PUT'])
def inv_update_store_inventory(inv_id):
    data = request.get_json() or {}
    qty_on_hand  = data.get('qty_on_hand')
    qty_on_store = data.get('qty_on_store')
    if qty_on_hand is None or qty_on_store is None:
        return jsonify({"error": "Both qty_on_hand and qty_on_store are required."}), 400
    try:
        qty_on_hand  = int(qty_on_hand)
        qty_on_store = int(qty_on_store)
    except (ValueError, TypeError):
        return jsonify({"error": "Quantities must be valid integers."}), 400
    if qty_on_hand < 0 or qty_on_store < 0:
        return jsonify({"error": "Quantities cannot be negative."}), 400
    conn = get_inv_db()
    existing = conn.execute("SELECT id FROM store_inventory WHERE id=?", (inv_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Inventory record not found."}), 404
    conn.execute(
        "UPDATE store_inventory SET qty_on_hand=?, qty_on_store=?, last_updated=datetime('now','localtime') WHERE id=?",
        (qty_on_hand, qty_on_store, inv_id)
    )
    conn.commit()
    row = conn.execute("""
        SELECT si.*, i.name, i.sku, i.category, i.unit, i.description, s.name as store_name
        FROM store_inventory si JOIN items i ON i.id=si.item_id JOIN stores s ON s.id=si.store_id
        WHERE si.id=?
    """, (inv_id,)).fetchone()
    conn.close()
    return jsonify(dict(row))

@app.route('/api/inventory/store-inventory/<int:inv_id>', methods=['DELETE'])
def inv_delete_store_inventory(inv_id):
    conn = get_inv_db()
    existing = conn.execute("SELECT id FROM store_inventory WHERE id=?", (inv_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Inventory record not found."}), 404
    conn.execute("DELETE FROM store_inventory WHERE id=?", (inv_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Inventory record removed."})

# ─────────────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print("Starting Flask Data Analytics & Cleaning Web System on http://127.0.0.1:5050")
    app.run(host='127.0.0.1', port=5050, debug=True)
