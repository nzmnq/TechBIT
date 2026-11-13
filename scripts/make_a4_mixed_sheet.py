#!/usr/bin/env python3
"""
Builds one A4 (210 x 297 mm) print sheet with 5 complete toner-transfer sets
for Wheel_Sensor_Amplifier (board 66 x 50 mm), 1:1 scale, vector PDF.

Columns (one row = one complete board):
  1) TOP silkscreen  - F.SilkS + holes, MIRRORED (iron onto component side)
  2) BOTTOM copper   - B.Cu + holes, as-is (iron onto copper, then etch)
  3) BOTTOM markings - B.SilkS (SMD labels) + holes, as-is (iron onto the
                       copper side after etching, for easier SMD soldering)

Optional second page: silkscreen only (top + bottom markings, no copper).
"""
import os, re, subprocess, tempfile

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRINT_DIR = os.path.join(DIR, "print")
os.makedirs(PRINT_DIR, exist_ok=True)
PCB = os.path.join(DIR, "kicad", "Wheel_Sensor_Amplifier.kicad_pcb")
OUT = os.path.join(PRINT_DIR, "A4_Mixed_Top_Bottom_Copper_5sets.pdf")
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

BW, BH = 66.0, 50.0
X0, GAP_X = 4.0, 2.0          # 4 + 3*66 + 2*2 = 206 mm  (4 mm side margins)
Y0, PITCH_Y = 14.0, 57.0      # 14 + 4*57 + 50 = 292 mm  (5 mm bottom margin)

LAYERS = {
    "top":  ("F.SilkS,Edge.Cuts", True),
    "cu":   ("B.Cu,Edge.Cuts", False),
    "bsilk": ("B.SilkS,Edge.Cuts", False),
}

TITLES = {
    "top":  "ВЕРХ (дзеркально) — на сторону деталей",
    "cu":   "НИЗ — МІДЬ (травлення)",
    "bsilk": "НИЗ — маркування SMD (після травлення)",
}


def export_svg(kind, tmp):
    layers, mirror = LAYERS[kind]
    out = os.path.join(tmp, f"{kind}.svg")
    cmd = [KICAD_CLI, "pcb", "export", "svg", "--layers", layers,
           "--black-and-white", "--mode-single", "--fit-page-to-board",
           "--exclude-drawing-sheet", "--drill-shape-opt", "2", "-o", out, PCB]
    if mirror:
        cmd.insert(4, "--mirror")
    subprocess.run(cmd, check=True, capture_output=True)
    svg = open(out, encoding="utf-8").read()
    svg = svg[svg.index("<svg"):]                                  # drop xml/doctype
    svg = re.sub(r"<text\b.*?</text>", "", svg, flags=re.S)        # drop invisible search text
    svg = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", svg, flags=re.S)
    # force exact physical size of the board
    svg = re.sub(r'width="[\d.]+mm" height="[\d.]+mm"',
                 f'width="{BW}mm" height="{BH}mm" preserveAspectRatio="none"', svg, count=1)
    return svg


def tile(svg, x, y, label):
    return (f'<div class="lbl" style="left:{x}mm;top:{y-3.6:.2f}mm">{label}</div>'
            f'<div class="tile" style="left:{x}mm;top:{y}mm">{svg}</div>')


def page(header, columns, svgs):
    parts = [f'<div class="page"><div class="hdr">{header}</div>'
             f'<div class="scale"><div class="bar"></div><span>контроль масштабу: 50 мм</span></div>']
    for r in range(5):
        y = Y0 + r * PITCH_Y
        for c, kind in enumerate(columns):
            x = X0 + c * (BW + GAP_X)
            parts.append(tile(svgs[kind], x, y, f"#{r+1} · {TITLES[kind]}"))
    parts.append("</div>")
    return "".join(parts)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        svgs = {k: export_svg(k, tmp) for k in LAYERS}
        css = """
        @page { size: 210mm 297mm; margin: 0; }
        html, body { margin: 0; padding: 0; }
        .page { position: relative; width: 210mm; height: 297mm; overflow: hidden;
                page-break-after: always; font-family: Arial, Helvetica, sans-serif; }
        .page:last-child { page-break-after: auto; }
        .tile { position: absolute; width: 66mm; height: 50mm; }
        .tile svg { display: block; width: 66mm; height: 50mm; overflow: visible; }
        .lbl { position: absolute; font-size: 2.3mm; line-height: 3mm; white-space: nowrap; }
        .hdr { position: absolute; left: 4mm; top: 4mm; font-size: 3mm; font-weight: bold; }
        .scale { position: absolute; right: 4mm; top: 4mm; font-size: 2.3mm; text-align: right; }
        .scale .bar { width: 50mm; height: 1.2mm; border: 0.25mm solid #000; border-top: none;
                      margin-left: auto; box-sizing: border-box; }
        """
        html = ("<!doctype html><html><head><meta charset='utf-8'><style>" + css +
                "</style></head><body>" +
                page("Wheel Sensor Amplifier — 5 комплектів (1 ряд = 1 плата). Друк 100%, без масштабування!",
                     ["top", "cu", "bsilk"], svgs) +
                page("Wheel Sensor Amplifier — тільки маркування: верх (дзеркально) + низ SMD. Друк 100%!",
                     ["top", "bsilk", "top"], svgs) +
                "</body></html>")
        html_path = os.path.join(tmp, "sheet.html")
        open(html_path, "w", encoding="utf-8").write(html)
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        "--no-margins", f"--print-to-pdf={OUT}", "file://" + html_path],
                       check=True, capture_output=True)
    print("Saved:", OUT)


if __name__ == "__main__":
    main()
