import io
import datetime
import pandas as pd
import numpy as np
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from analytics_engine import AnalyticsEngine

class ExecutivePDFReportGenerator:
    @staticmethod
    def generate_pdf_report(df: pd.DataFrame, dataset_name: str, cleaning_history: list) -> bytes:
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=letter,
            leftMargin=36,
            rightMargin=36,
            topMargin=36,
            bottomMargin=36
        )

        styles = getSampleStyleSheet()
        
        # Color Palette for Executive Design
        PRIMARY = colors.HexColor('#1e1b4b')      # Deep Indigo
        ACCENT = colors.HexColor('#4338ca')       # Indigo
        TEXT_COLOR = colors.HexColor('#0f172a')   # Dark Slate
        MUTED_TEXT = colors.HexColor('#475569')   # Slate
        LIGHT_BG = colors.HexColor('#f8fafc')     # Light Slate fill
        BORDER_COLOR = colors.HexColor('#cbd5e1') # Slate border

        title_style = ParagraphStyle(
            'ReportTitle',
            parent=styles['Title'],
            fontName='Helvetica-Bold',
            fontSize=18,
            leading=22,
            textColor=PRIMARY,
            alignment=0,
            spaceAfter=4
        )

        subtitle_style = ParagraphStyle(
            'ReportSubTitle',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            leading=13,
            textColor=MUTED_TEXT,
            alignment=0,
            spaceAfter=10
        )

        heading_style = ParagraphStyle(
            'SectionHeading',
            parent=styles['Heading2'],
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=15,
            textColor=ACCENT,
            spaceBefore=12,
            spaceAfter=6
        )

        body_style = ParagraphStyle(
            'ReportBody',
            parent=styles['BodyText'],
            fontName='Helvetica',
            fontSize=8.5,
            leading=11,
            textColor=TEXT_COLOR,
            spaceAfter=3
        )

        bullet_style = ParagraphStyle(
            'ReportBullet',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=8.5,
            leading=12,
            textColor=TEXT_COLOR,
            leftIndent=10,
            firstLineIndent=-6,
            spaceAfter=3
        )

        table_text = ParagraphStyle(
            'TableText',
            parent=styles['Normal'],
            fontName='Helvetica',
            fontSize=8,
            leading=10,
            textColor=TEXT_COLOR
        )

        table_header = ParagraphStyle(
            'TableHeaderText',
            parent=styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8,
            leading=10,
            textColor=colors.white
        )

        story = []

        # 1. Header Title & Meta Info
        story.append(Paragraph("DataCleanse & Applied Analytics Studio", title_style))
        story.append(Paragraph("Integrated Executive Analytics & Dataset Health Report", subtitle_style))
        story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT, spaceBefore=0, spaceAfter=10))

        audit = AnalyticsEngine.audit_dataset(df)
        insights = AnalyticsEngine.generate_automated_insights(df)
        demographics = AnalyticsEngine.compute_demographics(df)

        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # Metadata Header Table
        meta_data = [
            [Paragraph("<b>Dataset Name:</b>", body_style), Paragraph(str(dataset_name), body_style),
             Paragraph("<b>Report Date:</b>", body_style), Paragraph(now_str, body_style)],
            [Paragraph("<b>Total Rows:</b>", body_style), Paragraph(f"{audit['total_rows']:,}", body_style),
             Paragraph("<b>Total Columns:</b>", body_style), Paragraph(str(audit['total_columns']), body_style)],
            [Paragraph("<b>Data Quality Score:</b>", body_style), Paragraph(f"<b>{audit['quality_score']}%</b>", body_style),
             Paragraph("<b>Missing Cells:</b>", body_style), Paragraph(f"{audit['total_missing_cells']:,}", body_style)]
        ]
        meta_table = Table(meta_data, colWidths=[110, 160, 110, 160])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), LIGHT_BG),
            ('BOX', (0,0), (-1,-1), 1, BORDER_COLOR),
            ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 10))

        # 2. Key Insights Section
        story.append(Paragraph("Automated Data Insights & Observations", heading_style))
        if insights:
            for ins in insights:
                clean_ins = ins.replace('**', '').replace('[Demographics]', '').replace('[Health]', '').replace('[Data Loss Risk]', '').strip()
                story.append(Paragraph(f"• {clean_ins}", bullet_style))
        else:
            story.append(Paragraph("No specific data anomalies detected.", body_style))
        story.append(Spacer(1, 10))

        # 3. Column Data Health Audit Table
        story.append(Paragraph("Column Data Health Audit", heading_style))
        col_headers = [Paragraph("Column", table_header), Paragraph("Type", table_header),
                       Paragraph("Total Rows", table_header), Paragraph("Missing", table_header), Paragraph("Missing %", table_header)]
        col_rows = [col_headers]
        for col_info in audit.get('columns', []):
            col_rows.append([
                Paragraph(str(col_info['column']), table_text),
                Paragraph(str(col_info['dtype']), table_text),
                Paragraph(f"{audit['total_rows']:,}", table_text),
                Paragraph(f"{col_info['missing_count']:,}", table_text),
                Paragraph(f"{col_info['missing_pct']}%", table_text)
            ])
        col_table = Table(col_rows, colWidths=[150, 90, 100, 100, 100])
        col_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), PRIMARY),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, LIGHT_BG]),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        story.append(col_table)
        story.append(Spacer(1, 10))

        # 4. Numerical Demographic Metrics Summary
        num_summary = demographics.get('numeric_summary', [])
        if num_summary:
            story.append(Paragraph("Numerical Demographic Metrics Summary", heading_style))
            num_headers = [
                Paragraph("Attribute", table_header), Paragraph("Mean", table_header),
                Paragraph("Std Dev", table_header), Paragraph("Median", table_header),
                Paragraph("Min", table_header), Paragraph("Max", table_header), Paragraph("Skewness", table_header)
            ]
            num_rows = [num_headers]
            for row in num_summary:
                num_rows.append([
                    Paragraph(str(row['column']), table_text),
                    Paragraph(str(row['mean']), table_text),
                    Paragraph(str(row['std']), table_text),
                    Paragraph(str(row['median']), table_text),
                    Paragraph(str(row['min']), table_text),
                    Paragraph(str(row['max']), table_text),
                    Paragraph(str(row['skewness']), table_text)
                ])
            num_table = Table(num_rows, colWidths=[120, 70, 70, 70, 70, 70, 70])
            num_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,0), ACCENT),
                ('TEXTCOLOR', (0,0), (-1,0), colors.white),
                ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
                ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, LIGHT_BG]),
                ('PADDING', (0,0), (-1,-1), 4),
            ]))
            story.append(num_table)
            story.append(Spacer(1, 10))

        # 5. Data Cleaning History Audit Trail
        if cleaning_history:
            story.append(Paragraph("Data Cleaning Audit Trail History", heading_style))
            for item in cleaning_history:
                story.append(Paragraph(f"• {item}", bullet_style))
            story.append(Spacer(1, 10))

        # 6. Sample Records Table Preview (First 20 Rows)
        story.append(Paragraph("Dataset Sample Records Preview (First 20 Rows)", heading_style))
        sample_df = df.head(20)
        display_cols = list(sample_df.columns[:6])
        
        sample_headers = [Paragraph(str(c)[:15], table_header) for c in display_cols]
        sample_rows = [sample_headers]

        col_w = max(40, min(140, int(540 / max(1, len(display_cols)))))
        col_widths = [col_w] * len(display_cols)

        for _, row in sample_df.iterrows():
            row_cells = [Paragraph(str(row[c])[:25] if pd.notna(row[c]) else "<i>null</i>", table_text) for c in display_cols]
            sample_rows.append(row_cells)

        sample_table = Table(sample_rows, colWidths=col_widths)
        sample_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0f172a')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('GRID', (0,0), (-1,-1), 0.5, BORDER_COLOR),
            ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, LIGHT_BG]),
            ('PADDING', (0,0), (-1,-1), 3),
        ]))
        story.append(sample_table)

        doc.build(story)
        return buffer.getvalue()
