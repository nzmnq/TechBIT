#!/usr/bin/env python3
"""
Generates UV solder mask stencils positioned strictly on the TOP HALF of an A4 sheet (210 x 297 mm),
leaving the bottom half (> 140 mm) completely empty so transparency film can be saved or cut in half (A5).

Page 1: 2 copies of FULL PLATE (151 x 102 mm), rotated 90° (102 x 151 mm) side-by-side in top half.
Page 2: 2 copies of SINGLE BOARD (66 x 50 mm) side-by-side in top half.
Page 3: 4 copies of SINGLE BOARD (66 x 50 mm) in 2x2 grid in top half.
"""

import os, re, subprocess, tempfile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRINT_DIR = os.path.join(DIR, "print")
os.makedirs(PRINT_DIR, exist_ok=True)
PCB = os.path.join(DIR, "kicad", "Wheel_Sensor_Amplifier.kicad_pcb")
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT_PDF = os.path.join(PRINT_DIR, "SolderMask_UV_Top_Half_A4.pdf")

PAGE_W, PAGE_H = 210.0, 297.0
PLATE_W, PLATE_H = 151.0, 102.0
BW, BH = 66.0, 50.0

GAP_X, GAP_Y = 3.0, 1.0
MX = (PLATE_W - 2 * BW - GAP_X) / 2     # 8.0 mm
MY = (PLATE_H - 2 * BH - GAP_Y) / 2     # 0.5 mm
BOARDS = [(MX + c * (BW + GAP_X), MY + r * (BH + GAP_Y)) for r in range(2) for c in range(2)]

def extract_single_board_mask(tmp):
    out_svg = os.path.join(tmp, "mask.svg")
    subprocess.run([KICAD_CLI, "pcb", "export", "svg", "--layers", "B.Mask,Edge.Cuts",
                    "--black-and-white", "--mode-single", "--fit-page-to-board",
                    "--exclude-drawing-sheet", "--drill-shape-opt", "0", "-o", out_svg, PCB],
                   check=True, capture_output=True)
    s = open(out_svg, encoding="utf-8").read()
    s = s[s.index("<svg"):]
    s = re.sub(r"<text\b.*?</text>", "", s, flags=re.S)
    s = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", s, flags=re.S)
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    inner = s[s.index(">", s.index("<svg")) + 1: s.rindex("</svg>")]
    return vb, inner

def build_plate_svg(vb, inner, x0, y0, idx):
    # Plate rotated 90 degrees: width = PLATE_H (102mm), height = PLATE_W (151mm)
    sw = 0.25
    pw, ph = PLATE_H, PLATE_W  # 102 x 151
    
    parts = []
    # Title
    parts.append(f'<text x="{x0 + pw/2}" y="{y0 - 1.8}" class="t" text-anchor="middle">Копія #{idx} · Пластина 151×102 мм</text>')
    # Frame outer
    parts.append(f'<rect x="{x0 - sw/2}" y="{y0 - sw/2}" width="{pw + sw}" height="{ph + sw}" fill="none" stroke="#000" stroke-width="{sw}"/>')
    
    # Corner marks
    for cx, cy, dx, dy in [(x0, y0, -1, -1), (x0 + pw, y0, 1, -1),
                           (x0, y0 + ph, -1, 1), (x0 + pw, y0 + ph, 1, 1)]:
        parts.append(f'<path d="M{cx + dx*1.5} {cy} h{dx*4} M{cx} {cy + dy*1.5} v{dy*4}" stroke="#000" stroke-width="0.25"/>')
        
    # Content rotated 90 degrees inside frame
    # Transform: translate(x0 + pw, y0) rotate(90)
    g_boards = []
    for bx, by in BOARDS:
        g_boards.append(f'<svg x="{bx}" y="{by}" width="{BW}" height="{BH}" viewBox="{vb}" preserveAspectRatio="none" overflow="visible">{inner}</svg>')
    
    parts.append(f'<g transform="translate({x0 + pw} {y0}) rotate(90)">{"".join(g_boards)}</g>')
    return "".join(parts)

def build_single_board_svg(vb, inner, x0, y0, idx):
    sw = 0.25
    parts = []
    parts.append(f'<text x="{x0 + 2}" y="{y0 - 2.2}" class="t">Трафарет #{idx} · Плата 66×50 мм</text>')
    parts.append(f'<rect x="{x0 - sw/2}" y="{y0 - sw/2}" width="{BW + sw}" height="{BH + sw}" fill="none" stroke="#000" stroke-width="{sw}"/>')
    # Corner marks
    for cx, cy, dx, dy in [(x0, y0, -1, -1), (x0 + BW, y0, 1, -1),
                           (x0, y0 + BH, -1, 1), (x0 + BW, y0 + BH, 1, 1)]:
        parts.append(f'<path d="M{cx + dx*1.5} {cy} h{dx*4} M{cx} {cy + dy*1.5} v{dy*4}" stroke="#000" stroke-width="0.25"/>')
        
    parts.append(f'<svg x="{x0}" y="{y0}" width="{BW}" height="{BH}" viewBox="{vb}" preserveAspectRatio="none" overflow="visible">{inner}</svg>')
    return "".join(parts)

def rulers(y_r):
    parts = []
    x0 = 30.0
    parts.append(f'<path d="M{x0} {y_r} h150" stroke="#000" stroke-width="0.2"/>')
    for i in range(151):
        h = 4 if i % 10 == 0 else (2.5 if i % 5 == 0 else 1.5)
        parts.append(f'<path d="M{x0+i} {y_r} v{h}" stroke="#000" stroke-width="0.15"/>')
        if i % 10 == 0:
            parts.append(f'<text x="{x0+i}" y="{y_r+7.0}" class="n" text-anchor="middle">{i}</text>')
    parts.append(f'<text x="{x0+75}" y="{y_r-1.8}" class="t" text-anchor="middle">Контроль масштабу: рівно 150 мм</text>')
    return "".join(parts)

def cut_line(y_cut=148.5, label="Лінія середини А4 (148.5 мм) — нижня половина повністю чиста"):
    return (f'<line x1="5" y1="{y_cut}" x2="205" y2="{y_cut}" stroke="#888" stroke-width="0.3" stroke-dasharray="3,3"/>'
            f'<text x="105" y="{y_cut + 4.5}" class="n" fill="#666" text-anchor="middle">✂ {label}</text>')

def make_page(body_svg):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PAGE_W}mm" height="{PAGE_H}mm" '
            f'viewBox="0 0 {PAGE_W} {PAGE_H}" class="page">'
            f'{body_svg}</svg>')

def main():
    with tempfile.TemporaryDirectory() as tmp:
        vb, inner = extract_single_board_mask(tmp)
        pages_html = []
        
        # --- PAGE 1: 2 copies of SINGLE BOARD (66x50 mm, side-by-side in top half) ---
        # Width: 66 + 66 + 12(gap) = 144 mm -> center: x0 = (210 - 144) / 2 = 33.0 mm
        # Y = 22 mm to 72 mm. Everything fits in top 90 mm!
        p1 = []
        p1.append('<text x="12" y="10" class="h">UV-маска: 2 примірники ПЛАТИ 66×50 мм (верхня половина)</text>')
        p1.append('<text x="12" y="15" class="t">Склади обидва трафарети один на один для 100% захисту від УФ-променів</text>')
        p1.append(build_single_board_svg(vb, inner, x0=33.0, y0=24.0, idx=1))
        p1.append(build_single_board_svg(vb, inner, x0=111.0, y0=24.0, idx=2))
        p1.append(rulers(y_r=88.0))
        p1.append(cut_line(y_cut=110.0, label="Лінія відрізу — нижні 187 мм аркуша повністю чисті для майбутнього друку"))
        pages_html.append(make_page("".join(p1)))

        # --- PAGE 2: 4 copies of SINGLE BOARD (66x50 mm, 2x2 grid in top half) ---
        # 2 cols x 66mm = 132mm + 8mm gap = 140mm -> x0 = 35.0 mm
        # 2 rows x 50mm = 100mm + 6mm gap = 106mm -> y0 = 18.0 mm to 124.0 mm
        p2 = []
        p2.append('<text x="12" y="9" class="h">UV-маска: 4 примірники плати 66×50 мм (2×2 на верхній половині)</text>')
        p2.append(build_single_board_svg(vb, inner, x0=35.0, y0=18.0, idx=1))
        p2.append(build_single_board_svg(vb, inner, x0=109.0, y0=18.0, idx=2))
        p2.append(build_single_board_svg(vb, inner, x0=35.0, y0=74.0, idx=3))
        p2.append(build_single_board_svg(vb, inner, x0=109.0, y0=74.0, idx=4))
        p2.append(rulers(y_r=133.0))
        p2.append(cut_line(y_cut=148.5, label="Середина А4 (148.5 мм) — рівно половина аркуша, нижня частина чиста"))
        pages_html.append(make_page("".join(p2)))

        # --- PAGE 3: 2 copies of FULL 151x102 PLATE (rotated 90°, side-by-side in top half) ---
        # Plate dimensions rotated: W = 102 mm, H = 151 mm
        # Page width: 210 mm -> two plates: 102 + 2(gap) + 102 = 206 mm. Margin = 2 mm left/right.
        p3 = []
        p3.append(build_plate_svg(vb, inner, x0=2.0, y0=5.0, idx=1))
        p3.append(build_plate_svg(vb, inner, x0=106.0, y0=5.0, idx=2))
        p3.append(cut_line(y_cut=160.0, label="Низ аркуша вільний (можна відрізати та зберегти залишок плівки)"))
        pages_html.append(make_page("".join(p3)))
        
        css = ("@page{size:210mm 297mm;margin:0}html,body{margin:0;padding:0}"
               "svg.page{display:block;width:210mm;height:297mm;page-break-after:always}"
               "svg.page:last-child{page-break-after:auto}"
               ".h{font:bold 3.2px Arial,Helvetica,sans-serif}.t{font:2.2px Arial,Helvetica,sans-serif}"
               ".n{font:2.0px Arial,Helvetica,sans-serif}")
        html = f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{''.join(pages_html)}</body></html>"
        
        hp = os.path.join(tmp, "top_half.html")
        with open(hp, "w", encoding="utf-8") as f:
            f.write(html)
            
        raw_pdf = os.path.join(tmp, "raw.pdf")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        "--no-margins", f"--print-to-pdf={raw_pdf}", "file://" + hp],
                       check=True, capture_output=True)
                       
        r = PdfReader(raw_pdf)
        w = PdfWriter()
        A4W, A4H = 210 / 25.4 * 72, 297 / 25.4 * 72
        for p in r.pages:
            top = float(p.mediabox.top)
            box = RectangleObject([0, top - A4H, A4W, top])
            p.mediabox = box
            p.cropbox = box
            w.add_page(p)
        w.write(OUT_PDF)
        
    print("Successfully generated:", OUT_PDF)

if __name__ == "__main__":
    main()
