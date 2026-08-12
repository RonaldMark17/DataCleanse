import os
import io
import pandas as pd
import numpy as np
from flask import Flask, render_template, request, jsonify, send_file, Response
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

if __name__ == '__main__':
    print("Starting Flask Data Analytics & Cleaning Web System on http://127.0.0.1:5050")
    app.run(host='127.0.0.1', port=5050, debug=True)
