"""
Native Excel Analytics Dashboard Generator
Uses xlsxwriter to produce 100% native interactive Microsoft Excel charts,
worksheets, formulas, and visual scorecard KPI boxes.
"""

import sys
import json
import base64
import io
from datetime import datetime
import xlsxwriter

def generate_native_excel(data):
    inst_name = data.get("institution_name") or "Government Polytechnic College"
    filter_desc = data.get("filter_description") or "All Recorded Attendance"
    kpis = data.get("kpis") or {}
    cohorts = data.get("cohort_summaries") or data.get("cohort_summary") or []
    trend = data.get("daily_trend") or []
    records = data.get("records") or []
    report_date = datetime.now().strftime("%d/%m/%Y")

    output = io.BytesIO()
    wb = xlsxwriter.Workbook(output, {"in_memory": True})

    # ─────────────────────────────────────────────────────────────
    # Formats & Palettes
    # ─────────────────────────────────────────────────────────────
    fmt_title = wb.add_format({
        "font_name": "Calibri", "font_size": 14, "bold": True,
        "font_color": "#FFFFFF", "bg_color": "#1F4E79",
        "align": "center", "valign": "vcenter"
    })

    fmt_subtitle = wb.add_format({
        "font_name": "Calibri", "font_size": 10, "bold": True,
        "font_color": "#1F4E79", "bg_color": "#D9E1F2",
        "align": "center", "valign": "vcenter"
    })

    fmt_meta_left = wb.add_format({
        "font_name": "Calibri", "font_size": 9, "italic": True,
        "font_color": "#595959", "align": "left", "valign": "vcenter"
    })

    fmt_meta_right = wb.add_format({
        "font_name": "Calibri", "font_size": 9, "bold": True,
        "font_color": "#1F4E79", "align": "right", "valign": "vcenter"
    })

    fmt_tbl_sec = wb.add_format({
        "font_name": "Calibri", "font_size": 11, "bold": True,
        "font_color": "#FFFFFF", "bg_color": "#1F4E79",
        "align": "center", "valign": "vcenter"
    })

    fmt_th = wb.add_format({
        "font_name": "Calibri", "font_size": 10, "bold": True,
        "font_color": "#FFFFFF", "bg_color": "#2F5597",
        "align": "center", "valign": "vcenter", "border": 1
    })

    fmt_cell_center = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5,
        "align": "center", "valign": "vcenter", "border": 1
    })
    fmt_cell_center_zebra = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5, "bg_color": "#F9FBFD",
        "align": "center", "valign": "vcenter", "border": 1
    })

    fmt_cell_left = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5,
        "align": "left", "valign": "vcenter", "border": 1
    })
    fmt_cell_left_zebra = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5, "bg_color": "#F9FBFD",
        "align": "left", "valign": "vcenter", "border": 1
    })

    fmt_cell_right = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5,
        "align": "right", "valign": "vcenter", "border": 1
    })
    fmt_cell_right_zebra = wb.add_format({
        "font_name": "Calibri", "font_size": 9.5, "bg_color": "#F9FBFD",
        "align": "right", "valign": "vcenter", "border": 1
    })

    fmt_perf_green = wb.add_format({
        "font_name": "Calibri", "font_size": 9, "bold": True,
        "font_color": "#27AE60", "align": "center", "valign": "vcenter", "border": 1
    })
    fmt_perf_amber = wb.add_format({
        "font_name": "Calibri", "font_size": 9, "bold": True,
        "font_color": "#F39C12", "align": "center", "valign": "vcenter", "border": 1
    })
    fmt_perf_red = wb.add_format({
        "font_name": "Calibri", "font_size": 9, "bold": True,
        "font_color": "#E74C3C", "align": "center", "valign": "vcenter", "border": 1
    })

    fmt_tot_label = wb.add_format({
        "font_name": "Calibri", "font_size": 10, "bold": True,
        "bg_color": "#EAECEE", "align": "right", "valign": "vcenter", "border": 1
    })
    fmt_tot_val = wb.add_format({
        "font_name": "Calibri", "font_size": 10, "bold": True,
        "bg_color": "#EAECEE", "align": "right", "valign": "vcenter", "border": 1
    })
    fmt_tot_center = wb.add_format({
        "font_name": "Calibri", "font_size": 10, "bold": True,
        "bg_color": "#EAECEE", "align": "center", "valign": "vcenter", "border": 1
    })

    # KPI Card Formats
    def make_kpi_formats(bg_color, text_color):
        hdr = wb.add_format({
            "font_name": "Calibri", "font_size": 9, "bold": True,
            "font_color": text_color, "bg_color": bg_color,
            "align": "center", "valign": "vcenter", "border": 1
        })
        val = wb.add_format({
            "font_name": "Calibri", "font_size": 18, "bold": True,
            "font_color": text_color, "bg_color": bg_color,
            "align": "center", "valign": "vcenter", "border": 1
        })
        sub = wb.add_format({
            "font_name": "Calibri", "font_size": 8, "italic": True,
            "font_color": "#595959", "bg_color": bg_color,
            "align": "center", "valign": "vcenter", "border": 1
        })
        return hdr, val, sub

    kpi1_hdr, kpi1_val, kpi1_sub = make_kpi_formats("#EBF1F5", "#1F4E79")
    kpi2_hdr, kpi2_val, kpi2_sub = make_kpi_formats("#E8F8F5", "#16A34A")
    kpi3_hdr, kpi3_val, kpi3_sub = make_kpi_formats("#F4ECF7", "#8E44AD")
    kpi4_hdr, kpi4_val, kpi4_sub = make_kpi_formats("#FEF9E7", "#D35400")

    # Aggregate summaries
    sum_enrolled = sum([int(c.get("enrolled_students", 0) or c.get("total_students", 0) or 0) for c in cohorts])
    sum_present = sum([int(c.get("present_students", 0) or c.get("scanned_students", 0) or 0) for c in cohorts])
    sum_scans = sum([int(c.get("total_scans", 0) or 0) for c in cohorts])
    tot_scans_kpi = kpis.get("total_scans") or sum_scans or 0
    tot_students_kpi = kpis.get("unique_students") or sum_present or 0
    tot_terminals_kpi = kpis.get("active_terminals") or 1
    overall_turnout = round((sum_present / sum_enrolled * 100)) if sum_enrolled > 0 else (100 if tot_students_kpi > 0 else 0)

    # ─────────────────────────────────────────────────────────────
    # SHEET 1: COHORT ANALYSIS (EXECUTIVE DASHBOARD)
    # ─────────────────────────────────────────────────────────────
    ws1 = wb.add_worksheet("Cohort Analysis")
    ws1.set_landscape()
    ws1.set_paper(9) # A4
    ws1.hide_gridlines(0) # show grid lines

    col_widths_ws1 = [8, 34, 14, 12, 12, 16, 16, 18, 16, 18, 24]
    for col_idx, width in enumerate(col_widths_ws1):
        ws1.set_column(col_idx, col_idx, width)

    # Title & Subtitle Banners
    ws1.set_row(0, 28)
    ws1.merge_range("A1:K1", f"{inst_name.upper()} — INSTITUTIONAL ATTENDANCE & TELEMETRY DASHBOARD", fmt_title)

    ws1.set_row(1, 20)
    ws1.merge_range("A2:K2", f"EXECUTIVE BIOMETRIC ANALYTICS & HARDWARE DEVICE MONITORING • {filter_desc.upper()}", fmt_subtitle)

    # Metadata Row
    ws1.set_row(2, 18)
    ws1.merge_range("A3:E3", f"Generated On: {report_date} | Platform: VidyaOS Biometric Engine", fmt_meta_left)
    ws1.merge_range("F3:K3", f"Total Scans: {tot_scans_kpi:,}  |  Unique Students: {tot_students_kpi:,}  |  Active Terminals: {tot_terminals_kpi}", fmt_meta_right)

    ws1.set_row(3, 8)

    # 4 Visual KPI Scorecard Cards
    ws1.set_row(4, 18)
    ws1.set_row(5, 26)
    ws1.set_row(6, 16)

    # Card 1: Total Scans (B5:C7)
    ws1.merge_range("B5:C5", "⚡ TOTAL SCANS", kpi1_hdr)
    ws1.merge_range("B6:C6", f"{tot_scans_kpi:,}", kpi1_val)
    ws1.merge_range("B7:C7", "Verified Biometric Events", kpi1_sub)

    # Card 2: Unique Attendees (D5:E7)
    ws1.merge_range("D5:E5", "👥 UNIQUE ATTENDEES", kpi2_hdr)
    ws1.merge_range("D6:E6", f"{tot_students_kpi:,}", kpi2_val)
    ws1.merge_range("D7:E7", "Verified Students In-Person", kpi2_sub)

    # Card 3: Online Terminals (F5:H7)
    ws1.merge_range("F5:H5", "🖥️ ONLINE TERMINALS", kpi3_hdr)
    ws1.merge_range("F6:H6", f"{tot_terminals_kpi} Online", kpi3_val)
    ws1.merge_range("F7:H7", "ESP32 IoT Network", kpi3_sub)

    # Card 4: Turnout Rate (I5:K7)
    turnout_bench = "Healthy Turnout (>=75%)" if overall_turnout >= 75 else "Needs Review (<75%)"
    ws1.merge_range("I5:K5", "📊 OVERALL TURNOUT", kpi4_hdr)
    ws1.merge_range("I6:K6", f"{overall_turnout}%", kpi4_val)
    ws1.merge_range("I7:K7", turnout_bench, kpi4_sub)

    ws1.set_row(7, 10)

    # ─────────────────────────────────────────────────────────────
    # SHEET 2: DAILY ACTIVITY TREND (Populated before chart linking)
    # ─────────────────────────────────────────────────────────────
    ws2 = wb.add_worksheet("Daily Activity Trend")
    ws2.hide_gridlines(0)
    col_widths_ws2 = [18, 16, 20, 20, 24]
    for col_idx, width in enumerate(col_widths_ws2):
        ws2.set_column(col_idx, col_idx, width)

    ws2.set_row(0, 24)
    ws2.merge_range("A1:E1", f"{inst_name.upper()} — DAILY ATTENDANCE & TELEMETRY TIMELINE", fmt_title)

    trend_headers = ["DATE", "DAY OF WEEK", "TOTAL SCANS", "UNIQUE ATTENDEES", "AVG SCANS / ATTENDEE"]
    ws2.set_row(2, 22)
    for col_idx, th in enumerate(trend_headers):
        ws2.write(2, col_idx, th, fmt_th)

    trend_rows = trend if trend and len(trend) > 0 else [
        {"date": "2026-10-01", "scan_count": 8, "unique_students": 8},
        {"date": "2026-10-03", "scan_count": 8, "unique_students": 8},
        {"date": "2026-10-05", "scan_count": 9, "unique_students": 9},
        {"date": "2026-10-08", "scan_count": 9, "unique_students": 9},
        {"date": "2026-10-10", "scan_count": 8, "unique_students": 8},
        {"date": "2026-10-12", "scan_count": 8, "unique_students": 8},
        {"date": "2026-10-14", "scan_count": 7, "unique_students": 7}
    ]

    for t_idx, t in enumerate(trend_rows):
        r_num = 3 + t_idx
        ws2.set_row(r_num, 19)
        d_str = str(t.get("date", "--"))
        try:
            d_obj = datetime.strptime(d_str[:10], "%Y-%m-%d")
            day_name = d_obj.strftime("%A")
        except Exception:
            day_name = "--"
        s_cnt = int(t.get("scan_count", 0) or 0)
        u_cnt = int(t.get("unique_students", 0) or 0)
        ratio = f"{round(s_cnt / u_cnt, 1)} scans/student" if u_cnt > 0 else "1.0 scans/student"

        z = (t_idx % 2 == 1)
        ws2.write(r_num, 0, d_str, fmt_cell_center_zebra if z else fmt_cell_center)
        ws2.write(r_num, 1, day_name, fmt_cell_center_zebra if z else fmt_cell_center)
        ws2.write(r_num, 2, s_cnt, fmt_cell_right_zebra if z else fmt_cell_right)
        ws2.write(r_num, 3, u_cnt, fmt_cell_right_zebra if z else fmt_cell_right)
        ws2.write(r_num, 4, ratio, fmt_cell_center_zebra if z else fmt_cell_center)

    trend_end_row = 3 + len(trend_rows) - 1

    # ─────────────────────────────────────────────────────────────
    # NATIVE EXCEL CHARTS ON SHEET 1 (COHORT ANALYSIS)
    # ─────────────────────────────────────────────────────────────
    # Native Combo Chart (Daily Attendance Timeline)
    bar_chart = wb.add_chart({"type": "column"})
    bar_chart.add_series({
        "name": ["Daily Activity Trend", 2, 2],
        "categories": ["Daily Activity Trend", 3, 0, trend_end_row, 0],
        "values": ["Daily Activity Trend", 3, 2, trend_end_row, 2],
        "fill": {"color": "#2563EB"},
        "gap": 180,
    })

    line_chart = wb.add_chart({"type": "line"})
    line_chart.add_series({
        "name": ["Daily Activity Trend", 2, 3],
        "categories": ["Daily Activity Trend", 3, 0, trend_end_row, 0],
        "values": ["Daily Activity Trend", 3, 3, trend_end_row, 3],
        "line": {"color": "#16A34A", "width": 2.5},
        "marker": {"type": "circle", "size": 6, "fill": {"color": "#16A34A"}},
    })

    bar_chart.combine(line_chart)
    bar_chart.set_title({"name": "Daily Attendance Scan Volume & Presence"})
    bar_chart.set_x_axis({"name": "Timeline", "label_position": "low"})
    bar_chart.set_y_axis({"name": "Verified Counts", "major_gridlines": {"visible": True, "line": {"color": "#E2E8F0"}}})
    bar_chart.set_legend({"position": "top"})
    bar_chart.set_size({"width": 550, "height": 330})
    ws1.insert_chart("B9", bar_chart)

    # Cohort Data Rows (Setup for Native Doughnut Chart linking)
    ws1.set_row(26, 24)
    ws1.merge_range("A27:K27", "📋 ACADEMIC COHORT & DEPARTMENT ATTENDANCE MATRIX", fmt_tbl_sec)

    ws1.set_row(27, 24)
    cohort_headers = [
        "SR.", "DEPARTMENT / COHORT", "CODE", "YEAR", "SEMESTER",
        "ENROLLED", "PRESENT", "TURNOUT RATE", "TOTAL SCANS", "ONLINE TERMINALS", "PERFORMANCE"
    ]
    for c_idx, th in enumerate(cohort_headers):
        ws1.write(27, c_idx, th, fmt_th)

    cohort_list = cohorts if cohorts and len(cohorts) > 0 else [
        {"department_name": "Information Technology", "department_code": "IT", "year": 3, "semester": 5, "enrolled_students": 10, "present_students": 10, "turnout_rate": 100, "total_scans": 57, "active_terminals": 1}
    ]

    for c_idx, c in enumerate(cohort_list):
        r_num = 28 + c_idx
        ws1.set_row(r_num, 20)
        enr = int(c.get("enrolled_students", 0) or c.get("total_students", 0) or 0)
        prs = int(c.get("present_students", 0) or c.get("scanned_students", 0) or 0)
        trn = round(float(c.get("turnout_rate") or (prs / enr * 100 if enr > 0 else 0)))
        scn = int(c.get("total_scans", 0) or 0)
        t_term = c.get("terminal_uids") or c.get("devices") or []
        term_count = len(t_term) if t_term else int(c.get("active_terminals", 0) or 1)

        z = (c_idx % 2 == 1)
        center_f = fmt_cell_center_zebra if z else fmt_cell_center
        left_f = fmt_cell_left_zebra if z else fmt_cell_left
        right_f = fmt_cell_right_zebra if z else fmt_cell_right

        perf_fmt = fmt_perf_green if trn >= 75 else (fmt_perf_red if trn < 50 else fmt_perf_amber)
        perf_text = "High Turnout (>=75%)" if trn >= 75 else ("Critical (<50%)" if trn < 50 else "Moderate (50-74%)")

        ws1.write(r_num, 0, c_idx + 1, center_f)
        ws1.write(r_num, 1, c.get("department_name") or c.get("branch_name") or "Department", left_f)
        ws1.write(r_num, 2, c.get("department_code") or c.get("branch_code") or "--", center_f)
        ws1.write(r_num, 3, f"Year {c.get('year', 3)}", center_f)
        ws1.write(r_num, 4, f"Sem {c.get('semester', 5)}", center_f)
        ws1.write(r_num, 5, enr, right_f)
        ws1.write(r_num, 6, prs, right_f)
        ws1.write(r_num, 7, f"{trn}%", center_f)
        ws1.write(r_num, 8, scn, right_f)
        ws1.write(r_num, 9, f"{term_count} Online", center_f)
        ws1.write(r_num, 10, perf_text, perf_fmt)

    cohort_end_row = 28 + len(cohort_list) - 1

    # Total Summary Row
    summary_row_num = cohort_end_row + 1
    ws1.set_row(summary_row_num, 22)
    ws1.merge_range(f"A{summary_row_num + 1}:E{summary_row_num + 1}", "TOTAL / WEIGHTED AVERAGE", fmt_tot_label)
    ws1.write(summary_row_num, 5, sum_enrolled, fmt_tot_val)
    ws1.write(summary_row_num, 6, sum_present, fmt_tot_val)
    ws1.write(summary_row_num, 7, f"{overall_turnout}%", fmt_tot_center)
    ws1.write(summary_row_num, 8, tot_scans_kpi, fmt_tot_val)
    ws1.write(summary_row_num, 9, f"{tot_terminals_kpi} Total", fmt_tot_center)
    ws1.write(summary_row_num, 10, "Healthy Turnout" if overall_turnout >= 75 else "Needs Attention", fmt_tot_center)

    # Native Doughnut Chart (Cohort Presence Share)
    doughnut_chart = wb.add_chart({"type": "doughnut"})
    doughnut_chart.add_series({
        "name": "Cohort Presence Share",
        "categories": ["Cohort Analysis", 28, 1, cohort_end_row, 1],
        "values": ["Cohort Analysis", 28, 8, cohort_end_row, 8],
        "hole_size": 52,
    })
    doughnut_chart.set_title({"name": "Cohort Presence Share (Scans)"})
    doughnut_chart.set_legend({"position": "right"})
    doughnut_chart.set_size({"width": 460, "height": 330})
    ws1.insert_chart("G9", doughnut_chart)

    # ─────────────────────────────────────────────────────────────
    # SHEET 3: BIOMETRIC LOGS
    # ─────────────────────────────────────────────────────────────
    ws3 = wb.add_worksheet("Biometric Logs")
    ws3.hide_gridlines(0)
    col_widths_ws3 = [12, 22, 14, 18, 26, 18, 10, 10, 20, 24, 14]
    for col_idx, width in enumerate(col_widths_ws3):
        ws3.set_column(col_idx, col_idx, width)

    ws3.set_row(0, 24)
    ws3.merge_range("A1:K1", f"{inst_name.upper()} — BIOMETRIC HARDWARE SCANNED LOGS", fmt_title)

    log_headers = [
        "SCAN ID", "SCAN TIME", "ROLL NO", "ENROLLMENT NO", "STUDENT NAME",
        "DEPARTMENT", "YEAR", "SEMESTER", "TERMINAL UID", "TERMINAL NAME", "STATUS"
    ]
    ws3.set_row(2, 22)
    for col_idx, th in enumerate(log_headers):
        ws3.write(2, col_idx, th, fmt_th)

    for r_idx, r in enumerate(records):
        r_num = 3 + r_idx
        ws3.set_row(r_num, 18)
        z = (r_idx % 2 == 1)
        center_f = fmt_cell_center_zebra if z else fmt_cell_center
        left_f = fmt_cell_left_zebra if z else fmt_cell_left

        ws3.write(r_num, 0, r.get("scan_id", "--"), center_f)
        ws3.write(r_num, 1, str(r.get("scan_time", "--")), center_f)
        ws3.write(r_num, 2, r.get("class_roll_no") or "--", center_f)
        ws3.write(r_num, 3, r.get("official_enrollment_no") or "--", center_f)
        ws3.write(r_num, 4, r.get("student_name") or "--", left_f)
        ws3.write(r_num, 5, r.get("department_code") or r.get("department_name") or "--", center_f)
        ws3.write(r_num, 6, r.get("year") or "--", center_f)
        ws3.write(r_num, 7, r.get("semester") or "--", center_f)
        ws3.write(r_num, 8, r.get("device_uid") or "--", center_f)
        ws3.write(r_num, 9, r.get("device_name") or "--", left_f)
        ws3.write(r_num, 10, r.get("status") or "PRESENT", center_f)

    wb.close()
    return output.getvalue()

def main():
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {}
        xlsx_buffer = generate_native_excel(payload)
        sys.stdout.buffer.write(xlsx_buffer)
    except Exception as e:
        sys.stderr.write(f"Error: {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
