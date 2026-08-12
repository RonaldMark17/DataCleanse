import pandas as pd
import numpy as np
import math

class AnalyticsEngine:
    @staticmethod
    def audit_dataset(df: pd.DataFrame) -> dict:
        """
        Performs a comprehensive data quality and structure audit.
        """
        total_rows, total_cols = df.shape
        duplicate_rows = int(df.duplicated().sum())
        
        col_stats = []
        total_missing_cells = 0
        total_cells = total_rows * total_cols if total_cols > 0 else 1
        
        for col in df.columns:
            s = df[col]
            missing_cnt = int(s.isna().sum())
            total_missing_cells += missing_cnt
            missing_pct = round((missing_cnt / total_rows) * 100, 2) if total_rows > 0 else 0
            unique_cnt = int(s.nunique(dropna=True))
            dtype_str = str(s.dtype)
            
            # Outlier detection for numeric columns
            outliers_iqr = 0
            if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s) and not s.dropna().empty:
                q1 = s.quantile(0.25)
                q3 = s.quantile(0.75)
                iqr = q3 - q1
                if iqr > 0:
                    lower_bound = q1 - 1.5 * iqr
                    upper_bound = q3 + 1.5 * iqr
                    outliers_iqr = int(((s < lower_bound) | (s > upper_bound)).sum())
            
            col_stats.append({
                "column": col,
                "dtype": dtype_str,
                "missing_count": missing_cnt,
                "missing_pct": missing_pct,
                "unique_count": unique_cnt,
                "outliers_count": outliers_iqr,
                "sample_values": s.dropna().unique()[:3].tolist()
            })
            
        # Quality score formula (weighted: 60% completeness, 40% uniqueness)
        completeness = max(0, 100 - (total_missing_cells / total_cells * 100))
        uniqueness = max(0, 100 - (duplicate_rows / max(1, total_rows) * 100))
        quality_score = round(float(0.6 * completeness + 0.4 * uniqueness), 1)
        
        memory_mb = round(float(df.memory_usage(deep=True).sum() / (1024 * 1024)), 3)
        
        return {
            "total_rows": total_rows,
            "total_columns": total_cols,
            "duplicate_rows": duplicate_rows,
            "memory_mb": memory_mb,
            "quality_score": quality_score,
            "total_missing_cells": total_missing_cells,
            "columns": col_stats
        }

    @staticmethod
    def clean_dataset(df: pd.DataFrame, actions: dict) -> tuple[pd.DataFrame, list[str]]:
        """
        Executes interactive data cleaning transformations.
        """
        df_clean = df.copy()
        log = []
        
        # 1. Drop specific columns
        drop_cols = actions.get("drop_columns", [])
        if drop_cols:
            valid_drops = [c for c in drop_cols if c in df_clean.columns]
            if valid_drops:
                df_clean.drop(columns=valid_drops, inplace=True)
                log.append(f"Dropped column(s): {', '.join(valid_drops)}")

        # 2. Remove duplicate rows
        if actions.get("remove_duplicates", False):
            before_cnt = len(df_clean)
            df_clean.drop_duplicates(inplace=True)
            removed = before_cnt - len(df_clean)
            log.append(f"Removed {removed} duplicate row(s).")
            
        # 3. Handle missing values
        missing_strategies = actions.get("missing_strategies", {})
        constant_values = actions.get("constant_values", {})
        for col, strategy in missing_strategies.items():
            if col not in df_clean.columns or df_clean[col].isna().sum() == 0:
                continue
                
            null_count = int(df_clean[col].isna().sum())
            if strategy == "drop":
                df_clean.dropna(subset=[col], inplace=True)
                log.append(f"Dropped {null_count} row(s) with nulls in '{col}'.")
            elif strategy == "mean" and pd.api.types.is_numeric_dtype(df_clean[col]):
                val = float(df_clean[col].mean())
                df_clean[col].fillna(val, inplace=True)
                log.append(f"Imputed {null_count} null(s) in '{col}' with Mean ({round(val, 2)}).")
            elif strategy == "median" and pd.api.types.is_numeric_dtype(df_clean[col]):
                val = float(df_clean[col].median())
                df_clean[col].fillna(val, inplace=True)
                log.append(f"Imputed {null_count} null(s) in '{col}' with Median ({round(val, 2)}).")
            elif strategy == "mode":
                mode_val = df_clean[col].mode()
                val = str(mode_val.iloc[0]) if not mode_val.empty else "Unknown"
                df_clean[col].fillna(val, inplace=True)
                log.append(f"Imputed {null_count} null(s) in '{col}' with Mode ({val}).")
            elif strategy == "zero" and pd.api.types.is_numeric_dtype(df_clean[col]):
                df_clean[col].fillna(0, inplace=True)
                log.append(f"Imputed {null_count} null(s) in '{col}' with 0.")
            elif strategy == "constant":
                c_val = constant_values.get(col, "Unknown")
                df_clean[col].fillna(c_val, inplace=True)
                log.append(f"Imputed {null_count} null(s) in '{col}' with Constant ('{c_val}').")

        # 4. Outlier clipping (1st - 99th percentile)
        clip_cols = actions.get("clip_outliers", [])
        for col in clip_cols:
            if col in df_clean.columns and pd.api.types.is_numeric_dtype(df_clean[col]):
                p01 = float(df_clean[col].quantile(0.01))
                p99 = float(df_clean[col].quantile(0.99))
                df_clean[col] = df_clean[col].clip(lower=p01, upper=p99)
                log.append(f"Clipped outliers in '{col}' to 1st-99th percentile range [{round(p01,2)}, {round(p99,2)}].")

        # 5. Type Conversions
        type_convs = actions.get("type_conversions", {})
        for col, target_type in type_convs.items():
            if col in df_clean.columns:
                try:
                    if target_type == "int":
                        df_clean[col] = pd.to_numeric(df_clean[col], errors='coerce').fillna(0).astype(int)
                    elif target_type == "float":
                        df_clean[col] = pd.to_numeric(df_clean[col], errors='coerce')
                    elif target_type == "str":
                        df_clean[col] = df_clean[col].astype(str)
                    elif target_type == "datetime":
                        df_clean[col] = pd.to_datetime(df_clean[col], errors='coerce')
                    log.append(f"Converted column '{col}' to type '{target_type}'.")
                except Exception as e:
                    log.append(f"Failed converting '{col}' to '{target_type}': {str(e)}")

        return df_clean, log

    @staticmethod
    def compute_correlation(df: pd.DataFrame, method: str = "pearson") -> dict:
        """
        Computes numerical correlation matrix and ranks relationship strengths.
        """
        numeric_df = df.select_dtypes(include=[np.number])
        if numeric_df.shape[1] < 2:
            return {"error": "At least 2 numeric columns are required for correlation analysis."}
            
        corr_matrix = numeric_df.corr(method=method).round(3)
        cols = corr_matrix.columns.tolist()
        
        # Format matrix for heatmaps
        matrix_data = []
        for r_idx, row_name in enumerate(cols):
            for c_idx, col_name in enumerate(cols):
                val = corr_matrix.iloc[r_idx, c_idx]
                clean_val = float(val) if pd.notna(val) else 0.0
                matrix_data.append({
                    "x": str(col_name),
                    "y": str(row_name),
                    "value": clean_val
                })
                
        # Extract top pairs
        pairs = []
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                val = corr_matrix.iloc[i, j]
                if pd.notna(val):
                    f_val = float(val)
                    pairs.append({
                        "var1": str(cols[i]),
                        "var2": str(cols[j]),
                        "correlation": f_val,
                        "abs_correlation": abs(f_val),
                        "strength": "Strong" if abs(f_val) >= 0.6 else ("Moderate" if abs(f_val) >= 0.3 else "Weak")
                    })
                    
        pairs.sort(key=lambda x: x["abs_correlation"], reverse=True)
        
        return {
            "columns": cols,
            "matrix": corr_matrix.fillna(0).to_dict(),
            "heatmap_data": matrix_data,
            "top_correlations": pairs[:10]
        }

    @staticmethod
    def compute_demographics(df: pd.DataFrame) -> dict:
        """
        Computes summary statistics and categorical demographic distributions.
        """
        num_summary = []
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and not pd.api.types.is_bool_dtype(df[c])]
        
        for col in numeric_cols:
            s = df[col].dropna()
            if not s.empty:
                num_summary.append({
                    "column": str(col),
                    "count": int(len(s)),
                    "mean": round(float(s.mean()), 2),
                    "std": round(float(s.std()), 2) if len(s) > 1 else 0.0,
                    "min": round(float(s.min()), 2),
                    "q25": round(float(s.quantile(0.25)), 2),
                    "median": round(float(s.median()), 2),
                    "q75": round(float(s.quantile(0.75)), 2),
                    "max": round(float(s.max()), 2),
                    "skewness": round(float(s.skew()), 2) if len(s) > 2 else 0.0
                })
                
        cat_distributions = {}
        categorical_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]) or pd.api.types.is_bool_dtype(df[c])]
        
        for col in categorical_cols:
            if df[col].nunique() <= 20: # limit to reasonable categorical cardinalities
                counts = df[col].value_counts(dropna=False)
                cat_distributions[str(col)] = [
                    {"category": str(k) if pd.notna(k) else "Missing", "count": int(v), "percentage": round(float(v / len(df)) * 100, 1)}
                    for k, v in counts.items()
                ]
                
        return {
            "numeric_summary": num_summary,
            "categorical_distributions": cat_distributions
        }

    @staticmethod
    def compute_trend_analysis(df: pd.DataFrame, x_col: str, y_col: str, aggregation: str = 'sum') -> dict:
        """
        Computes flexible, universal trend & metric aggregations for ANY imported Excel or CSV dataset.
        """
        try:
            if not x_col or not y_col or x_col not in df.columns or y_col not in df.columns:
                return {"error": "Selected attributes not found in current dataset."}

            sub_df = df[[x_col, y_col]].dropna().copy()
            if sub_df.empty:
                return {"error": "Selected columns contain no non-null values."}

            # Safely ensure numeric y_col
            y_s = sub_df[y_col]
            if isinstance(y_s, pd.DataFrame):
                y_s = y_s.iloc[:, 0]
            sub_df['__y'] = pd.to_numeric(y_s, errors='coerce')
            sub_df = sub_df.dropna(subset=['__y'])

            if sub_df.empty:
                return {"error": f"Column '{y_col}' contains no numeric values to plot trends."}

            # Aggregation logic
            agg = str(aggregation).lower()
            if agg == 'mean' or agg == 'average':
                grouped = sub_df.groupby(x_col)['__y'].mean()
            elif agg == 'count':
                grouped = sub_df.groupby(x_col)['__y'].count()
            elif agg == 'min':
                grouped = sub_df.groupby(x_col)['__y'].min()
            elif agg == 'max':
                grouped = sub_df.groupby(x_col)['__y'].max()
            else: # default sum
                grouped = sub_df.groupby(x_col)['__y'].sum()

            trend_data = []
            for k, v in grouped.items():
                if not pd.isna(k) and not pd.isna(v):
                    trend_data.append({
                        "x": str(k),
                        "y": round(float(v), 2)
                    })

            total_val = round(float(sub_df['__y'].sum()), 2)
            avg_val = round(float(sub_df['__y'].mean()), 2)

            return {
                "x_col": x_col,
                "y_col": y_col,
                "aggregation": agg,
                "total_value": total_val,
                "average_value": avg_val,
                "sample_size": len(sub_df),
                "data": trend_data
            }
        except Exception as e:
            return {"error": f"Trend Analysis error: {str(e)}"}

    @staticmethod
    def generate_automated_insights(df: pd.DataFrame) -> list[str]:
        """
        Generates automated analytical reasoning and data insights cleanly without unicode charmap issues.
        """
        try:
            insights = []
            audit = AnalyticsEngine.audit_dataset(df)
            
            # Quality Insight
            score = audit["quality_score"]
            if score >= 90:
                insights.append(f"[High Quality ({score}%)] Dataset is well-structured with minimal missing values ({audit['total_missing_cells']} missing cells across {audit['total_rows']} records).")
            elif score >= 70:
                insights.append(f"[Moderate Quality ({score}%)] Found {audit['total_missing_cells']} missing entries and {audit['duplicate_rows']} duplicate rows requiring cleaning.")
            else:
                insights.append(f"[Low Quality ({score}%)] Significant missing values or duplicate records detected. Immediate data cleaning recommended.")
                
            # Structural Insight
            insights.append(f"[Structure] Dataset contains **{audit['total_rows']} rows** and **{audit['total_columns']} attributes**, occupying ~{audit['memory_mb']} MB in memory.")

            # Correlation Insights
            numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
            if len(numeric_cols) >= 2:
                corr = AnalyticsEngine.compute_correlation(df)
                top = corr.get("top_correlations", [])
                if top:
                    best = top[0]
                    direction = "positive" if best["correlation"] > 0 else "negative"
                    insights.append(f"[Covariance] Strongest relationship identified between **'{best['var1']}'** and **'{best['var2']}'** (r = {best['correlation']}, {best['strength']} {direction} correlation).")

            # Categorical Breakdown Insight
            cat_cols = [c for c in df.columns if not pd.api.types.is_numeric_dtype(df[c])]
            if len(cat_cols) > 0:
                col = cat_cols[0]
                top_val = str(df[col].value_counts().idxmax())
                top_pct = round(float(df[col].value_counts().max() / len(df)) * 100, 1)
                insights.append(f"[Demographics] Dominant category in **'{col}'** is **'{top_val}'**, representing **{top_pct}%** of records.")

            return insights
        except Exception as e:
            return [f"[Analytics Engine] Generated automated summary analysis for {len(df)} records."]
