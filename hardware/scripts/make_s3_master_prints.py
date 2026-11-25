#!/usr/bin/env python3
"""
Generates all 1:1 LUT/UV fabrication PDFs, the multi-page Assembly Guide PDF,
and 3D/top-silkscreen PNG renders for TechBIT ESP32-S3 Master Hub (S3_Master_Hub).

Outputs in hardware/print/:
  1. S3_Master_Plate_151x102_PagePro1350W_A4.pdf
  2. S3_Master_SolderMask_UV_Film_Plate_151x102_A4.pdf
  3. S3_Master_SolderMask_UV_Top_Half_A4.pdf
  4. S3_Master_LUT_Single_A4.pdf
  5. S3_Master_Assembly_Guide_A4.pdf

Outputs in hardware/renders/:
  1. s3_master_3d_iso.png
  2. s3_master_3d_top.png
  3. s3_master_3d_bottom.png
  4. s3_master_top_silkscreen_readable.png

Usage:
    python3 hardware/scripts/make_s3_master_prints.py
    python3 hardware/scripts/make_s3_master_prints.py --sx 100.4 --sy 99.7
"""

import argparse
import os
import re
import subprocess
import tempfile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PCB = os.path.join(DIR, "kicad", "S3_Master_Hub.kicad_pcb")
PRINT_DIR = os.path.join(DIR, "print")
RENDER_DIR = os.path.join(DIR, "renders")
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PAGE_W, PAGE_H = 210.0, 297.0
PLATE_W, PLATE_H = 151.0, 102.0
BW, BH = 71.0, 96.0

# 2 boards side-by-side on 151 x 102 mm plate:
# 3.0 + 71.0 + 3.0 + 71.0 + 3.0 = 151.0 mm, 3.0 + 96.0 + 3.0 = 102.0 mm
GAP_X = 3.0
MX = (PLATE_W - 2 * BW - GAP_X) / 2.0  # 3.0 mm
MY = (PLATE_H - BH) / 2.0              # 3.0 mm
PLATE_BOARDS = [(MX + c * (BW + GAP_X), MY) for c in range(2)]

PLATE_X = (PAGE_W - PLATE_W) / 2.0     # 29.5 mm
PLATE_Y = [24.0, 142.0]                # 2 plates per A4 sheet

KINDS = {
    "cu":     ("B.Cu,Edge.Cuts",             False, "МІДЬ — низ (B.Cu), НЕ дзеркально → на мідь, потім травити"),
    "top":    ("F.SilkS,Edge.Cuts",          True,  "ВЕРХ — шовкографія, ДЗЕРКАЛЬНО → на сторону деталей"),
    "bsilk":  ("B.SilkS,Edge.Cuts",          False, "НИЗ — підписи SMD → на мідь ПІСЛЯ травлення"),
    "mask":   ("B.Mask,Edge.Cuts",           False, "UV-ПАЯЛЬНА МАСКА — плівка ТОНЕРОМ ВНИЗ до міді (чорне = НЕ застигає)"),
    "mask_m": ("B.Mask,Edge.Cuts",           True,  "UV-ПАЯЛЬНА МАСКА (ДЗЕРКАЛЬНО) — якщо класти тонером ВГОРУ"),
    "top_r":  ("F.SilkS,Edge.Cuts",          False, "ВЕРХ — читабельний вигляд (F.SilkS)"),
    "bot_r":  ("B.Cu,B.SilkS,Edge.Cuts",     True,  "НИЗ — мідь + SMD (дзеркально, як при пайці знизу)"),
}

PLATE_PAGES = [
    ("Мідь для травлення: 2 пластини × 2 плати", ["cu", "cu"]),
    ("Верхня шовкографія (дзеркально): 2 пластини × 2 плати", ["top", "top"]),
    ("Нижні підписи SMD: 2 пластини × 2 плати", ["bsilk", "bsilk"]),
    ("Комплект на 1 пластину: мідь + верхня шовкографія", ["cu", "top"]),
    ("UV-фотошаблон паяльної маски (тонером ВНИЗ до міді): 2 пластини × 2 плати", ["mask", "mask"]),
]

MASK_PLATE_PAGES = [
    ("UV-маска (тонером ВНИЗ до міді): 2 пластини × 2 плати", ["mask", "mask"]),
    ("UV-маска (ДЗЕРКАЛЬНО, тонером ВГОРУ): 2 пластини × 2 плати", ["mask_m", "mask_m"]),
]


def export_board_svg(kind, tmp, mirror_override=None):
    layers, mirror, _ = KINDS[kind]
    if mirror_override is not None:
        mirror = mirror_override
    out = os.path.join(tmp, f"{kind}_{'m' if mirror else 'n'}.svg")
    cmd = [
        KICAD_CLI, "pcb", "export", "svg",
        "--layers", layers,
        "--black-and-white",
        "--mode-single",
        "--fit-page-to-board",
        "--exclude-drawing-sheet",
        "--drill-shape-opt", "0" if kind.startswith("mask") else "2",
        "-o", out, PCB,
    ]
    if mirror:
        cmd.insert(4, "--mirror")
    subprocess.run(cmd, check=True, capture_output=True)
    s = open(out, encoding="utf-8").read()
    s = s[s.index("<svg"):]
    s = re.sub(r"<text\b.*?</text>", "", s, flags=re.S)
    s = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", s, flags=re.S)
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    inner = s[s.index(">", s.index("<svg")) + 1: s.rindex("</svg>")]
    return vb, inner


def html_to_a4_pdf(html_str, out_pdf, tmp, name):
    hp = os.path.join(tmp, f"{name}.html")
    raw = os.path.join(tmp, f"{name}_raw.pdf")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(html_str)
    subprocess.run(
        [
            CHROME, "--headless=new", "--disable-gpu",
            "--no-pdf-header-footer", "--no-margins",
            f"--print-to-pdf={raw}", "file://" + hp,
        ],
        check=True, capture_output=True,
    )
    reader = PdfReader(raw)
    writer = PdfWriter()
    a4_w = PAGE_W / 25.4 * 72.0
    a4_h = PAGE_H / 25.4 * 72.0
    for page in reader.pages:
        top = float(page.mediabox.top)
        box = RectangleObject([0, top - a4_h, a4_w, top])
        page.mediabox = box
        page.cropbox = box
        writer.add_page(page)
    with open(out_pdf, "wb") as f:
        writer.write(f)
    print("Saved:", out_pdf)


def corner_marks(x, y, w, h, length=4.0):
    o = []
    for cx, cy, dx, dy in [
        (x, y, -1, -1), (x + w, y, 1, -1),
        (x, y + h, -1, 1), (x + w, y + h, 1, 1),
    ]:
        o.append(
            f'<path d="M{cx + dx*1.5} {cy} h{dx*length} M{cx} {cy + dy*1.5} v{dy*length}" '
            f'stroke="#000" stroke-width="0.25"/>'
        )
    return "".join(o)


def plate_svg_block(x0, y0, kind, art, idx):
    vb, inner = art[kind]
    _, mirror, title = KINDS[kind]
    sw = 0.25
    o = [
        f'<text x="{x0 + 2}" y="{y0 - 2.2}" class="t">Пластина {idx} · {PLATE_W:g}×{PLATE_H:g} мм · {title}</text>',
        f'<rect x="{x0 - sw/2}" y="{y0 - sw/2}" width="{PLATE_W + sw}" height="{PLATE_H + sw}" '
        f'fill="none" stroke="#000" stroke-width="{sw}"/>',
        corner_marks(x0, y0, PLATE_W, PLATE_H, length=5.0),
    ]
    boards = []
    for bx, by in PLATE_BOARDS:
        boards.append(
            f'<svg x="{x0 + bx}" y="{y0 + by}" width="{BW}" height="{BH}" viewBox="{vb}" '
            f'preserveAspectRatio="none" overflow="visible">{inner}</svg>'
        )
    if mirror:
        o.append(f'<g transform="translate({2*x0 + PLATE_W} 0) scale(-1 1)">{"".join(boards)}</g>')
    else:
        o.append("".join(boards))
    return "".join(o)


def ruler_h(x0, y0, length=150):
    o = [f'<path d="M{x0} {y0} h{length}" stroke="#000" stroke-width="0.2"/>']
    for i in range(length + 1):
        h = 5 if i % 10 == 0 else (3.5 if i % 5 == 0 else 2)
        o.append(f'<path d="M{x0+i} {y0} v{h}" stroke="#000" stroke-width="0.15"/>')
        if i % 10 == 0:
            o.append(f'<text x="{x0+i}" y="{y0+8.5}" class="n" text-anchor="middle">{i}</text>')
    o.append(f'<text x="{x0+length/2}" y="{y0-2}" class="t" text-anchor="middle">Контроль масштабу: має бути рівно {length} мм</text>')
    return "".join(o)


def ruler_v(x1, y1, length=100):
    o = [f'<path d="M{x1} {y1} v{length}" stroke="#000" stroke-width="0.2"/>']
    for i in range(length + 1):
        w = 5 if i % 10 == 0 else (3.5 if i % 5 == 0 else 2)
        o.append(f'<path d="M{x1} {y1+i} h-{w}" stroke="#000" stroke-width="0.15"/>')
        if i % 10 == 0:
            o.append(f'<text x="{x1-6}" y="{y1+i+0.9}" class="n" text-anchor="end">{i}</text>')
    o.append(f'<text x="{x1-12}" y="{y1+length+6}" class="n">↑ {length} мм</text>')
    return "".join(o)


def wrap_page_svg(body, sx=1.0, sy=1.0):
    cx, cy = PAGE_W / 2.0, PAGE_H / 2.0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{PAGE_W}mm" height="{PAGE_H}mm" '
        f'viewBox="0 0 {PAGE_W} {PAGE_H}" class="page">'
        f'<g transform="translate({cx} {cy}) scale({sx} {sy}) translate({-cx} {-cy})">{body}</g></svg>'
    )


COMMON_SVG_CSS = (
    "@page{size:210mm 297mm;margin:0}html,body{margin:0;padding:0}"
    "svg.page{display:block;width:210mm;height:297mm;page-break-after:always}"
    "svg.page:last-child{page-break-after:auto}"
    ".h{font:bold 3.5px Arial,Helvetica,sans-serif}"
    ".t{font:2.35px Arial,Helvetica,sans-serif}"
    ".n{font:2.1px Arial,Helvetica,sans-serif}"
)


def build_plate_pdfs(tmp, sx, sy):
    # Export non-mirrored SVGs and apply exact SVG mirror around plate center where needed
    needed = {"cu", "top", "bsilk", "mask", "mask_m"}
    art = {k: export_board_svg(k, tmp, mirror_override=False) for k in needed}

    def render_pages(pages, out_pdf, name):
        svgs = []
        for title, kinds in pages:
            body = [
                f'<text x="12" y="13" class="h">TechBIT ESP32-S3 Master Hub · {title}</text>',
                f'<text x="12" y="18" class="t">Konica Minolta PagePro 1350W · A4 · Масштаб 100% / «Фактичний розмір» '
                f'(НЕ «Підігнати») · корекція X={sx*100:.2f}% Y={sy*100:.2f}%</text>',
            ]
            for idx, (k, py) in enumerate(zip(kinds, PLATE_Y), start=1):
                body.append(plate_svg_block(PLATE_X, py, k, art, idx))
            body.append(ruler_h(PLATE_X, 256.0, 150))
            body.append(ruler_v(21.0, PLATE_Y[0], 100))
            body.append(
                '<text x="12" y="276" class="t">Перевірка після друку: внутрішній розмір рамки = 151 × 102 мм, '
                'кожна плата = 71 × 96 мм, лінійки = 150 мм і 100 мм.</text>'
            )
            body.append(
                '<text x="12" y="281" class="t">Верх (дзеркально) переноситься на пластину, перевернуту ліво↔право '
                '(як сторінку книжки) — тоді отвори верху й низу збігаються.</text>'
            )
            svgs.append(wrap_page_svg("".join(body), sx=sx, sy=sy))
        html = f"<!doctype html><html><head><meta charset='utf-8'><style>{COMMON_SVG_CSS}</style></head><body>{''.join(svgs)}</body></html>"
        html_to_a4_pdf(html, out_pdf, tmp, name)

    render_pages(
        PLATE_PAGES,
        os.path.join(PRINT_DIR, "S3_Master_Plate_151x102_PagePro1350W_A4.pdf"),
        "s3_plate",
    )
    render_pages(
        MASK_PLATE_PAGES,
        os.path.join(PRINT_DIR, "S3_Master_SolderMask_UV_Film_Plate_151x102_A4.pdf"),
        "s3_mask_plate",
    )


def single_board_tile(x0, y0, vb, inner, title, mirror=False):
    sw = 0.25
    o = [
        f'<text x="{x0 + 1.5}" y="{y0 - 2.2}" class="t">{title}</text>',
        f'<rect x="{x0 - sw/2}" y="{y0 - sw/2}" width="{BW + sw}" height="{BH + sw}" fill="none" stroke="#000" stroke-width="{sw}"/>',
        corner_marks(x0, y0, BW, BH, length=4.0),
    ]
    svg_el = (
        f'<svg x="{x0}" y="{y0}" width="{BW}" height="{BH}" viewBox="{vb}" '
        f'preserveAspectRatio="none" overflow="visible">{inner}</svg>'
    )
    if mirror:
        o.append(f'<g transform="translate({2*x0 + BW} 0) scale(-1 1)">{svg_el}</g>')
    else:
        o.append(svg_el)
    return "".join(o)


def build_top_half_uv_pdf(tmp, sx, sy):
    vb, inner = export_board_svg("mask", tmp, mirror_override=False)
    # 2 copies of 71 x 96 mm side-by-side in top half (< 148.5 mm):
    # 28 + 71 + 12 + 71 + 28 = 210 mm
    p = [
        '<text x="12" y="10" class="h">TechBIT S3 Master Hub · UV-маска: 2 копії 71×96 мм (верхня половина A4)</text>',
        '<text x="12" y="15" class="t">Плівка тонером ВНИЗ до міді (чорні площадки не застигають). Склади 2 копії для максимальної оптичної щільності.</text>',
        single_board_tile(28.0, 22.0, vb, inner, "Трафарет #1 · Плата 71×96 мм"),
        single_board_tile(111.0, 22.0, vb, inner, "Трафарет #2 · Плата 71×96 мм"),
        ruler_h(30.0, 127.0, 150),
        '<line x1="5" y1="143.0" x2="205" y2="143.0" stroke="#777" stroke-width="0.3" stroke-dasharray="3,3"/>',
        '<text x="105" y="147.2" class="n" fill="#555" text-anchor="middle">✂ Лінія відрізу (143 мм) — нижня половина A4 повністю чиста для повторного друку</text>',
    ]
    html = (
        f"<!doctype html><html><head><meta charset='utf-8'><style>{COMMON_SVG_CSS}</style></head>"
        f"<body>{wrap_page_svg(''.join(p), sx=sx, sy=sy)}</body></html>"
    )
    html_to_a4_pdf(html, os.path.join(PRINT_DIR, "S3_Master_SolderMask_UV_Top_Half_A4.pdf"), tmp, "s3_top_half")


def build_lut_single_pdf(tmp, sx, sy):
    vb_cu, in_cu = export_board_svg("cu", tmp, mirror_override=False)
    vb_top, in_top = export_board_svg("top", tmp, mirror_override=False)
    vb_bs, in_bs = export_board_svg("bsilk", tmp, mirror_override=False)
    vb_mk, in_mk = export_board_svg("mask", tmp, mirror_override=False)

    # 2x2 grid of 71 x 96 mm on A4 (210 x 297 mm)
    # x = 27.0, 112.0 (gap 14 mm); y = 26.0, 138.0 (gap 16 mm, bottom = 234 mm)
    p = [
        '<text x="12" y="11" class="h">TechBIT ESP32-S3 Master Hub (71×96 мм) — Повний комплект для 1 плати (A4, 1:1)</text>',
        '<text x="12" y="16" class="t">Друк строго 100% / «Фактичний розмір»! Комплект: мідь B.Cu + верх F.SilkS (дзерк.) + низ B.SilkS + UV-маска.</text>',
        single_board_tile(27.0, 26.0, vb_cu, in_cu, "1) МІДЬ B.Cu (на мідь, травити)", mirror=False),
        single_board_tile(112.0, 26.0, vb_top, in_top, "2) ВЕРХ F.SilkS (ДЗЕРКАЛЬНО → на верх)", mirror=True),
        single_board_tile(27.0, 138.0, vb_bs, in_bs, "3) НИЗ B.SilkS (SMD-підписи після травлення)", mirror=False),
        single_board_tile(112.0, 138.0, vb_mk, in_mk, "4) UV-МАСКА B.Mask (тонером ВНИЗ до міді)", mirror=False),
        ruler_h(30.0, 248.0, 150),
        '<text x="27" y="268" class="t">• Перевірка розмірів: зовнішня рамка кожної плати = рівно 71.0 × 96.0 мм, лінійка = 150.0 мм.</text>',
        '<text x="27" y="273" class="t">• Свердління: Ø0.9 мм (U1, MOD2, JP1, C1, C2 — 56 отв.), Ø0.95 мм (J2A/J2B/J3 JST-XH 4P — 12 отв.), Ø1.0 мм (MOD1 — 8 отв.), Ø1.3 мм (J1 — 4 отв.).</text>',
        '<text x="27" y="278" class="t">• SMD знизу: R1 (120R, 1206) термінатор CAN і C3 (100nF, 1206) фільтр живлення +3V3 біля J2A.</text>',
    ]
    html = (
        f"<!doctype html><html><head><meta charset='utf-8'><style>{COMMON_SVG_CSS}</style></head>"
        f"<body>{wrap_page_svg(''.join(p), sx=sx, sy=sy)}</body></html>"
    )
    html_to_a4_pdf(html, os.path.join(PRINT_DIR, "S3_Master_LUT_Single_A4.pdf"), tmp, "s3_lut_single")


def build_assembly_guide_pdf(tmp):
    vb_top, in_top = export_board_svg("top_r", tmp, mirror_override=False)
    vb_bot, in_bot = export_board_svg("bot_r", tmp, mirror_override=True)

    css = """
    @page { size: 210mm 297mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .page { width: 210mm; height: 297mm; padding: 11mm 12mm; page-break-after: always; position: relative; overflow: hidden; }
    .page:last-child { page-break-after: auto; }
    h1 { font-size: 13.5pt; margin: 0 0 2.5mm 0; border-bottom: 0.4mm solid #222; padding-bottom: 1.2mm; }
    h2 { font-size: 9.8pt; margin: 2.6mm 0 1.2mm 0; color: #1a365d; }
    .sub { font-size: 8.6pt; color: #333; margin-bottom: 3.5mm; line-height: 1.35; }
    .board-box { display: flex; justify-content: center; align-items: center; margin: 2mm 0 3.5mm 0; }
    .note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; font-size: 8.4pt; line-height: 1.35; }
    .card { border: 0.25mm solid #bbb; border-radius: 1.5mm; padding: 2.5mm 3mm; background: #fafafa; }
    .card b { color: #000; }
    table { width: 100%; border-collapse: collapse; font-size: 7.4pt; margin-bottom: 2.0mm; line-height: 1.22; }
    th, td { border: 0.2mm solid #999; padding: 0.9mm 1.5mm; text-align: left; vertical-align: top; }
    th { background: #eef2f7; font-weight: bold; }
    code { font-family: Menlo, Consolas, monospace; font-size: 7.2pt; background: #f0f0f0; padding: 0.15mm 0.7mm; border-radius: 0.5mm; }
    .foot { position: absolute; bottom: 7mm; left: 12mm; right: 12mm; font-size: 7.5pt; color: #555; border-top: 0.2mm solid #ddd; padding-top: 1.5mm; display: flex; justify-content: space-between; }
    """

    # Scale board SVG cleanly to 132 x 178.5 mm (~1.86x) so all labels & bottom notes fit comfortably on A4
    disp_w, disp_h = 132.0, 132.0 * (BH / BW)  # 132.0 x 178.5 mm

    page1 = f"""
    <div class="page">
      <h1>TechBIT ESP32-S3 Master Hub — Монтажна карта (Сторона 1: ВЕРХ / F.Cu)</h1>
      <div class="sub">
        Плата <b>71.0 × 96.0 мм</b>, одностороння мідь <b>B.Cu</b> (без перемичок та переходів). Масштаб схеми нижче збільшено у <b>1.86×</b> для легкого читання всіх написів.
      </div>
      <div class="board-box">
        <svg width="{disp_w:.1f}mm" height="{disp_h:.1f}mm" viewBox="{vb_top}" style="border:0.2mm solid #ddd;">{in_top}</svg>
      </div>
      <div class="note-grid">
        <div class="card">
          <b>1. Ключова орієнтація модулів:</b><br>
          • <b>U1 (ESP32-S3-DevKitC-1 N16R8):</b> 2×22 гнізда, <b>Wi-Fi антена ВГОРУ</b>, подвійний <b>USB-C ДОНИЗУ</b>.<br>
          • <b>J1 (KF301-4P 5.08 мм):</b> клеми входом проводів <b>ВГОРУ</b> (до краю плати).<br>
          • <b>MOD1 (MP1584EN 4.5–28V→5V):</b> попередньо підкрутити підстроювач рівно на <b>5.00 В</b> до впаювання!
        </div>
        <div class="card">
          <b>2. Полярність та джампер шини CAN:</b><br>
          • <b>C1 (100 µF, 5V)</b> і <b>C2 (10 µF, 3.3V):</b> довгий вивід (+) у квадратну площадку з позначкою <code>+</code>.<br>
          • <b>JP1 (120R):</b> встановити перемичку, якщо Master Hub є <b>кінцевим вузлом</b> шини CAN (вмикає SMD-резистор <code>R1 120 Ω</code> між CAN_H та CAN_L).
        </div>
      </div>
      <div class="foot"><span>TechBIT Hardware · S3_Master_Hub</span><span>Сторінка 1 / 3 · Верхній монтаж</span></div>
    </div>
    """

    page2 = f"""
    <div class="page">
      <h1>TechBIT ESP32-S3 Master Hub — Сторона 2: НИЗ (B.Cu мідь + SMD-компоненти)</h1>
      <div class="sub">
        Вигляд <b>знизу (дзеркально відносно верху)</b> — саме так виглядає зворотний бік текстоліту під час перевірки доріжок і пайки SMD-елементів <b>R1</b> та <b>C3</b>.
      </div>
      <div class="board-box">
        <svg width="{disp_w:.1f}mm" height="{disp_h:.1f}mm" viewBox="{vb_bot}" style="border:0.2mm solid #ddd;">{in_bot}</svg>
      </div>
      <div class="note-grid">
        <div class="card">
          <b>SMD-компоненти на B.Cu (типорозмір 1206):</b><br>
          • <b>R1 — 120 Ω (1206):</b> термінатор шини CAN, підключений між <code>JP1.2 (CAN_TERM_MID)</code> та шиною <code>CAN_L</code>.<br>
          • <b>C3 — 100 nF (1206):</b> високочастотний фільтр по лінії <code>+3V3 ↔ GND</code> безпосередньо біля роз'єму дисплея <code>J2A</code>.
        </div>
        <div class="card">
          <b>Контроль травлення та маски перед пайкою:</b><br>
          • Ширина сигнальних доріжок: <b>0.9–1.0 мм</b>, силових шин <code>+12V_RAW / +5V_BUCK / GND</code>: <b>1.2–1.4 мм</b>.<br>
          • Усі просвіти між доріжками ≥ <b>0.60 мм</b> (між виводами SPI дисплея/SD — <b>1.64 мм</b>).<br>
          • Перевірити мультиметром відсутність КЗ між <code>+12V</code>, <code>+5V</code>, <code>+3V3</code> та <code>GND</code>.
        </div>
      </div>
      <div class="foot"><span>TechBIT Hardware · S3_Master_Hub</span><span>Сторінка 2 / 3 · Нижні доріжки та SMD</span></div>
    </div>
    """

    page3 = """
    <div class="page">
      <h1>TechBIT ESP32-S3 Master Hub — BOM, свердління та таблиця підключення</h1>

      <h2>1. Перелік компонентів (BOM)</h2>
      <table>
        <tr><th>Поз.</th><th>Компонент / Модуль</th><th>Номінал / Корпус</th><th>Сторона</th><th>Призначення</th></tr>
        <tr><td><b>U1</b></td><td>ESP32-S3-DevKitC-1 N16R8</td><td>2×22 PinSocket 2.54 мм (25.4 мм)</td><td>F.Cu (Верх)</td><td>Головний контролер кабіни (Wi-Fi UP, USB-C DOWN)</td></tr>
        <tr><td><b>MOD1</b></td><td>MP1584EN DC-DC Buck</td><td>D-SUN 22.1×16.8 мм, 8 пінів (4.5–28V → 5.0V 3A)</td><td>F.Cu (Верх)</td><td>Понижувальний стабілізатор живлення +5V</td></tr>
        <tr><td><b>MOD2</b></td><td>SN65HVD230 CAN</td><td>PinHeader 1×06 2.54 мм</td><td>F.Cu (Верх)</td><td>Трансивер шини CAN 3.3V (GPIO4 TX / GPIO5 RX)</td></tr>
        <tr><td><b>J1</b></td><td>Клемник живлення та CAN</td><td>KF301-4P (5.08 мм, кутовий)</td><td>F.Cu (Верх)</td><td>Бортмережа +12V, GND, CAN_L, CAN_H (вхід ВГОРУ)</td></tr>
        <tr><td><b>JP1</b></td><td>Перемичка термінатора</td><td>PinHeader 1×02 2.54 мм + джампер</td><td>F.Cu (Верх)</td><td>Підключає 120 Ω між CAN_H та CAN_L</td></tr>
        <tr><td><b>J2A</b></td><td>Роз'єм дисплея TFT (1..4)</td><td>JST-XH S4B-XH-A (4-pin, кутовий 2.5 мм)</td><td>F.Cu (Верх)</td><td>1.28" червоний GC9A01 SPI: живлення 3.3V, GND, CS, RES (лівий край)</td></tr>
        <tr><td><b>J2B</b></td><td>Роз'єм дисплея TFT (5..8)</td><td>JST-XH S4B-XH-A (4-pin, кутовий 2.5 мм)</td><td>F.Cu (Верх)</td><td>1.28" червоний GC9A01 SPI: DC/A0, SDA/MOSI, SCK, LED (поруч із J2A)</td></tr>
        <tr><td><b>J3</b></td><td>Роз'єм MicroSD</td><td>JST-XH S4B-XH-A (4-pin, кутовий 2.5 мм)</td><td>F.Cu (Верх)</td><td>Слот MicroSD на модулі 1.28" (4 піни SPI, одразу під J2B)</td></tr>
        <tr><td><b>C1</b></td><td>Електролітичний конд.</td><td>100 µF / ≥10V (D5.0, P2.5 мм)</td><td>F.Cu (Верх)</td><td>Фільтр живлення +5V_BUCK</td></tr>
        <tr><td><b>C2</b></td><td>Електролітичний конд.</td><td>10 µF / ≥6.3V (D5.0, P2.5 мм)</td><td>F.Cu (Верх)</td><td>Фільтр живлення +3V3</td></tr>
        <tr><td><b>R1</b></td><td>SMD резистор</td><td>120 Ω (1206)</td><td>B.Cu (Низ)</td><td>Термінатор CAN (активується джампером JP1)</td></tr>
        <tr><td><b>C3</b></td><td>SMD керамічний конд.</td><td>100 nF (1206)</td><td>B.Cu (Низ)</td><td>Блокування +3V3 біля J2A TFT</td></tr>
      </table>

      <h2>2. Карта свердління отворів (всього 80 отворів на 1 плату)</h2>
      <table>
        <tr><th>Діаметр</th><th>К-сть</th><th>Компоненти</th></tr>
        <tr><td><b>0.9 мм</b></td><td>56</td><td>U1 (44), MOD2 (6), JP1 (2), C1 (2), C2 (2)</td></tr>
        <tr><td><b>0.95 мм</b></td><td>12</td><td>J2A (4), J2B (4), J3 (4) — бокові роз'єми JST-XH 4P</td></tr>
        <tr><td><b>1.0 мм</b></td><td>8</td><td>MOD1 MP1584EN (8 силових отворів: 4 пари IN+/IN-/OUT+/OUT-)</td></tr>
        <tr><td><b>1.3 мм</b></td><td>4</td><td>J1 KF301-4P (силові клеми 12V / GND / CAN_L / CAN_H)</td></tr>
      </table>

      <h2>3. Попровідна схема підключення 1.28" червоного модуля GC9A01 + MicroSD (3× JST-XH 4P)</h2>
      <table>
        <tr><th>Плата (Pin)</th><th>Сигнал (Net)</th><th>ESP32-S3 Pin / GPIO</th><th>Червоний модуль 1.28" GC9A01+SD</th><th>Примітка</th></tr>
        <tr><td><code>J2A.1</code></td><td><code>+3V3</code></td><td>L1, L2 (3V3)</td><td><b>VCC / 3V3</b> (8-pin TFT)</td><td>Живлення логіки та дисплея 3.3V</td></tr>
        <tr><td><code>J2A.2</code></td><td><code>GND</code></td><td>L22, R1, R21, R22 (GND)</td><td><b>GND</b> (8-pin TFT)</td><td>Загальна земля (живить і TFT, і SD на модулі)</td></tr>
        <tr><td><code>J2A.3</code></td><td><code>TFT_CS</code></td><td>L6 (GPIO6)</td><td><b>CS</b></td><td>Chip Select дисплея GC9A01</td></tr>
        <tr><td><code>J2A.4</code></td><td><code>TFT_RES</code></td><td>L7 (GPIO7)</td><td><b>RES / RST</b></td><td>Апаратний Reset дисплея</td></tr>
        <tr><td><code>J2B.1</code></td><td><code>TFT_DC</code></td><td>L8 (GPIO15)</td><td><b>DC / A0</b></td><td>Вибір Дані / Команда</td></tr>
        <tr><td><code>J2B.2</code></td><td><code>TFT_MOSI</code></td><td>L9 (GPIO16)</td><td><b>SDA / MOSI</b></td><td>SPI Data (на червоних платах часто підписано SDA)</td></tr>
        <tr><td><code>J2B.3</code></td><td><code>TFT_SCK</code></td><td>L10 (GPIO17)</td><td><b>SCK / SCL</b></td><td>SPI Clock дисплея</td></tr>
        <tr><td><code>J2B.4</code></td><td><code>TFT_LED</code></td><td>L11 (GPIO18)</td><td><b>LED / BLK</b></td><td>Керування підсвіткою (PWM / 3.3V)</td></tr>
        <tr><td><code>J3.1</code></td><td><code>SD_CS</code></td><td>L15 (GPIO9)</td><td><b>SD_CS</b> (4-pin SD)</td><td>Chip Select карти MicroSD</td></tr>
        <tr><td><code>J3.2</code></td><td><code>SD_MOSI</code></td><td>L16 (GPIO10)</td><td><b>MOSI</b> (4-pin SD)</td><td>Окрема шина SPI для MicroSD</td></tr>
        <tr><td><code>J3.3</code></td><td><code>SD_MISO</code></td><td>L17 (GPIO11)</td><td><b>MISO</b> (4-pin SD)</td><td>Читання даних з MicroSD</td></tr>
        <tr><td><code>J3.4</code></td><td><code>SD_SCK</code></td><td>L18 (GPIO12)</td><td><b>SCK</b> (4-pin SD)</td><td>Тактування SPI для MicroSD</td></tr>
      </table>

      <h2>4. Підключення шини CAN та живлення автомобіля (J1 + MOD2 + JP1)</h2>
      <table>
        <tr><th>Клема / Пін</th><th>Сигнал</th><th>Зв'язок на платі</th><th>Призначення</th></tr>
        <tr><td><code>J1.1</code></td><td><code>+12V_RAW</code></td><td>MOD1 IN+ (2a/2b)</td><td>Живлення 12V/24V (4.5–28V макс. для MP1584EN)</td></tr>
        <tr><td><code>J1.2</code></td><td><code>GND</code></td><td>Загальна шина GND</td><td>Мінус бортмережі та екран/земля CAN</td></tr>
        <tr><td><code>J1.3</code></td><td><code>CAN_L</code></td><td>MOD2 Pin 5, R1 Pin 2</td><td>Диференційна лінія CAN Low</td></tr>
        <tr><td><code>J1.4</code></td><td><code>CAN_H</code></td><td>MOD2 Pin 6, JP1 Pin 1</td><td>Диференційна лінія CAN High (TX=GPIO4/L4, RX=GPIO5/L5)</td></tr>
      </table>

      <div class="foot"><span>TechBIT Hardware · S3_Master_Hub</span><span>Сторінка 3 / 3 · Специфікація та розпіновка</span></div>
    </div>
    """

    html = f"<!doctype html><html><head><meta charset='utf-8'><style>{css}</style></head><body>{page1}{page2}{page3}</body></html>"
    html_to_a4_pdf(html, os.path.join(PRINT_DIR, "S3_Master_Assembly_Guide_A4.pdf"), tmp, "s3_assembly_guide")


def build_renders(tmp):
    # 1-3: 3D Renders via kicad-cli (transparent PNG background matching board_3d_*.png)
    renders = [
        ("s3_master_3d_iso.png",    ["--side", "top", "--perspective", "--zoom", "0.95", "--rotate", "-45,0,28"]),
        ("s3_master_3d_top.png",    ["--side", "top", "--zoom", "0.80"]),
        ("s3_master_3d_bottom.png", ["--side", "bottom", "--zoom", "0.80"]),
    ]
    for fname, extra in renders:
        out_png = os.path.join(RENDER_DIR, fname)
        cmd = [
            KICAD_CLI, "pcb", "render",
            "--quality", "high",
            "--width", "1600", "--height", "1200",
            "--background", "transparent",
            *extra, "-o", out_png, PCB,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print("Rendered:", out_png)

    # 4: Clean high-res readable Top Silkscreen PNG (matching Preview_Top_Silkscreen_Readable.png)
    vb, inner = export_board_svg("top_r", tmp, mirror_override=False)
    html_png = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<style>html,body{margin:0;padding:0;width:1200px;height:1600px;background:#fff;"
        "display:flex;align-items:center;justify-content:center;}"
        "svg{width:1100px;height:1487px;display:block;overflow:visible;}</style>"
        f"</head><body><svg viewBox='{vb}'>{inner}</svg></body></html>"
    )
    hp = os.path.join(tmp, "silk_preview.html")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(html_png)
    out_silk = os.path.join(RENDER_DIR, "s3_master_top_silkscreen_readable.png")
    subprocess.run(
        [
            CHROME, "--headless=new", "--disable-gpu",
            "--hide-scrollbars", "--window-size=1200,1600",
            "--force-device-scale-factor=1",
            f"--screenshot={out_silk}", "file://" + hp,
        ],
        check=True, capture_output=True,
    )
    print("Rendered:", out_silk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sx", type=float, default=100.0, help="horizontal scale correction, %")
    ap.add_argument("--sy", type=float, default=100.0, help="vertical scale correction, %")
    ap.add_argument("--skip-renders", action="store_true", help="skip 3D renders")
    args = ap.parse_args()

    os.makedirs(PRINT_DIR, exist_ok=True)
    os.makedirs(RENDER_DIR, exist_ok=True)

    sx, sy = args.sx / 100.0, args.sy / 100.0
    with tempfile.TemporaryDirectory() as tmp:
        build_plate_pdfs(tmp, sx, sy)
        build_top_half_uv_pdf(tmp, sx, sy)
        build_lut_single_pdf(tmp, sx, sy)
        build_assembly_guide_pdf(tmp)
        if not args.skip_renders:
            build_renders(tmp)


if __name__ == "__main__":
    main()
