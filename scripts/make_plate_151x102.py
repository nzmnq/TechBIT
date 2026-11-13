#!/usr/bin/env python3
"""
Toner-transfer print file for a 151 x 102 mm copper-clad plate,
optimised for Konica Minolta PagePro 1350W (A4, no borderless, 4 mm unprintable edge).

* 4 boards (66 x 50 mm, 2 x 2) per plate - the maximum that fits 151 x 102 mm.
* 2 plate layouts per A4 page, everything kept >= 10 mm from paper edges.
* Exact A4 page (210 x 297 mm), 1:1 vector, with 150 mm / 100 mm calibration rulers
  and a printed 151 x 102 mm plate frame for alignment and scale checking.

Usage:
    python3 scripts/make_plate_151x102.py                     # 100 %
    python3 scripts/make_plate_151x102.py --sx 100.4 --sy 99.7  # printer scale correction, %
"""
import argparse, os, re, subprocess, tempfile

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PCB = os.path.join(DIR, "kicad", "Wheel_Sensor_Amplifier.kicad_pcb")
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PAGE_W, PAGE_H = 210.0, 297.0
PLATE_W, PLATE_H = 151.0, 102.0
BW, BH = 66.0, 50.0

# Boards inside the plate (top view, mm from plate top-left corner)
GAP_X, GAP_Y = 3.0, 1.0                       # saw/cut kerf between boards
MX = (PLATE_W - 2 * BW - GAP_X) / 2           # 8.0 mm left/right
MY = (PLATE_H - 2 * BH - GAP_Y) / 2           # 0.5 mm top/bottom
BOARDS = [(MX + c * (BW + GAP_X), MY + r * (BH + GAP_Y)) for r in range(2) for c in range(2)]

PLATE_X = (PAGE_W - PLATE_W) / 2              # 29.5 mm
PLATE_Y = [24.0, 142.0]                       # two plates per A4

KINDS = {
    #  key     layers                mirror whole plate   title
    "cu":    ("B.Cu,Edge.Cuts",    False, "МІДЬ — низ (B.Cu), НЕ дзеркально → на мідь, потім травити"),
    "top":   ("F.SilkS,Edge.Cuts", True,  "ВЕРХ — шовкографія, ДЗЕРКАЛЬНО → на сторону деталей"),
    "bsilk": ("B.SilkS,Edge.Cuts", False, "НИЗ — підписи SMD → на мідь ПІСЛЯ травлення"),
    "mask":  ("B.Mask,Edge.Cuts",  False, "UV-ПАЯЛЬНА МАСКА — плівка ТОНЕРОМ ВНИЗ до міді (чорне = НЕ застигає)"),
    "mask_m":("B.Mask,Edge.Cuts",  True,  "UV-ПАЯЛЬНА МАСКА (ДЗЕРКАЛЬНО) — якщо класти тонером ВГОРУ"),
}

MASK_PAGES = [
    ("UV-фотошаблон паяльної маски (тонером ВНИЗ до міді): 2 пластини × 4 плати", ["mask", "mask"]),
    ("UV-фотошаблон паяльної маски (ДЗЕРКАЛЬНО, тонером ВГОРУ): 2 пластини × 4 плати", ["mask_m", "mask_m"]),
]

PAGES = [
    ("Мідь для травлення: 2 пластини × 4 плати", ["cu", "cu"]),
    ("Верхня шовкографія (дзеркально): 2 пластини × 4 плати", ["top", "top"]),
    ("Нижні підписи SMD: 2 пластини × 4 плати", ["bsilk", "bsilk"]),
    ("Комплект на 1 пластину: мідь + верхня шовкографія", ["cu", "top"]),
    ("UV-фотошаблон паяльної маски (тонером ВНИЗ до міді): 2 пластини × 4 плати", ["mask", "mask"]),
]


def board_svg(kind, tmp):
    layers = KINDS[kind][0]
    out = os.path.join(tmp, f"{kind}.svg")
    subprocess.run([KICAD_CLI, "pcb", "export", "svg", "--layers", layers, "--black-and-white",
                    "--mode-single", "--fit-page-to-board", "--exclude-drawing-sheet",
                    "--drill-shape-opt", "0" if kind.startswith("mask") else "2", "-o", out, PCB], check=True, capture_output=True)
    s = open(out, encoding="utf-8").read()
    s = s[s.index("<svg"):]
    s = re.sub(r"<text\b.*?</text>", "", s, flags=re.S)
    s = re.sub(r"<title>.*?</title>|<desc>.*?</desc>", "", s, flags=re.S)
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    inner = s[s.index(">", s.index("<svg")) + 1: s.rindex("</svg>")]
    return vb, inner


def plate(x0, y0, kind, art, idx):
    vb, inner = art[kind]
    _, mirror, title = KINDS[kind]
    o = [f'<text x="{x0 + 2}" y="{y0 - 2.2}" class="t">Пластина {idx} · {PLATE_W:g}×{PLATE_H:g} мм · {title}</text>']
    # plate frame: stroke drawn OUTSIDE the plate, inner edge = exact plate size
    sw = 0.25
    o.append(f'<rect x="{x0 - sw/2}" y="{y0 - sw/2}" width="{PLATE_W + sw}" height="{PLATE_H + sw}" '
             f'fill="none" stroke="#000" stroke-width="{sw}"/>')
    for cx, cy, dx, dy in [(x0, y0, -1, -1), (x0 + PLATE_W, y0, 1, -1),
                           (x0, y0 + PLATE_H, -1, 1), (x0 + PLATE_W, y0 + PLATE_H, 1, 1)]:
        o.append(f'<path d="M{cx + dx*1.5} {cy} h{dx*5} M{cx} {cy + dy*1.5} v{dy*5}" stroke="#000" stroke-width="0.25"/>')
    g = []
    for bx, by in BOARDS:
        g.append(f'<svg x="{x0 + bx}" y="{y0 + by}" width="{BW}" height="{BH}" viewBox="{vb}" '
                 f'preserveAspectRatio="none" overflow="visible">{inner}</svg>')
    if mirror:  # mirror the WHOLE plate around its vertical centre line
        o.append(f'<g transform="translate({2*x0 + PLATE_W} 0) scale(-1 1)">' + "".join(g) + "</g>")
    else:
        o.append("".join(g))
    return "".join(o)


def rulers():
    o = []
    # horizontal 150 mm
    x0, y0 = PLATE_X, 256.0
    o.append(f'<path d="M{x0} {y0} h150" stroke="#000" stroke-width="0.2"/>')
    for i in range(151):
        h = 5 if i % 10 == 0 else (3.5 if i % 5 == 0 else 2)
        o.append(f'<path d="M{x0+i} {y0} v{h}" stroke="#000" stroke-width="0.15"/>')
        if i % 10 == 0:
            o.append(f'<text x="{x0+i}" y="{y0+8.5}" class="n" text-anchor="middle">{i}</text>')
    o.append(f'<text x="{x0+75}" y="{y0-2}" class="t" text-anchor="middle">Контроль масштабу: має бути рівно 150 мм</text>')
    # vertical 100 mm next to plate 1
    x1, y1 = 21.0, PLATE_Y[0]
    o.append(f'<path d="M{x1} {y1} v100" stroke="#000" stroke-width="0.2"/>')
    for i in range(101):
        w = 5 if i % 10 == 0 else (3.5 if i % 5 == 0 else 2)
        o.append(f'<path d="M{x1} {y1+i} h-{w}" stroke="#000" stroke-width="0.15"/>')
        if i % 10 == 0:
            o.append(f'<text x="{x1-6}" y="{y1+i+0.9}" class="n" text-anchor="end">{i}</text>')
    o.append(f'<text x="9" y="{y1+106}" class="n">↑ 100 мм</text>')
    return "".join(o)


def page_svg(title, kinds, art, sx, sy):
    body = [f'<text x="12" y="13" class="h">Wheel Sensor Amplifier · {title}</text>',
            f'<text x="12" y="18" class="t">Konica Minolta PagePro 1350W · A4 · Масштаб 100% / «Фактичний розмір» '
            f'(НЕ «Підігнати») · корекція X={sx*100:.2f}% Y={sy*100:.2f}%</text>']
    for i, (k, py) in enumerate(zip(kinds, PLATE_Y)):
        body.append(plate(PLATE_X, py, k, art, i + 1))
    body.append(rulers())
    body.append('<text x="12" y="276" class="t">Перевірка після друку: внутрішній розмір рамки = 151 × 102 мм, '
                'лінійки = 150 мм і 100 мм. Якщо ні — перезапусти скрипт з --sx/--sy.</text>')
    body.append('<text x="12" y="281" class="t">Верх (дзеркально) переноситься на пластину, перевернуту ліво↔право '
                '(як сторінку книжки) — тоді отвори верху й низу збігаються.</text>')
    cx, cy = PAGE_W / 2, PAGE_H / 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{PAGE_W}mm" height="{PAGE_H}mm" '
            f'viewBox="0 0 {PAGE_W} {PAGE_H}" class="page">'
            f'<g transform="translate({cx} {cy}) scale({sx} {sy}) translate({-cx} {-cy})">'
            + "".join(body) + "</g></svg>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sx", type=float, default=100.0, help="horizontal scale correction, %")
    ap.add_argument("--sy", type=float, default=100.0, help="vertical scale correction, %")
    ap.add_argument("--mask", action="store_true", help="build UV solder-mask film instead")
    ap.add_argument("-o", default=None)
    a = ap.parse_args()
    pages = MASK_PAGES if a.mask else PAGES
    if a.o is None:
        print_dir = os.path.join(DIR, "print")
        os.makedirs(print_dir, exist_ok=True)
        a.o = os.path.join(print_dir, "SolderMask_UV_Film_Plate_151x102_A4.pdf" if a.mask
                           else "Plate_151x102_PagePro1350W_A4.pdf")
    sx, sy = a.sx / 100.0, a.sy / 100.0
    with tempfile.TemporaryDirectory() as tmp:
        art = {k: board_svg(k, tmp) for k in set(x for _, ks in pages for x in ks)}
        css = ("@page{size:210mm 297mm;margin:0}html,body{margin:0;padding:0}"
               "svg.page{display:block;width:210mm;height:297mm;page-break-after:always}"
               "svg.page:last-child{page-break-after:auto}"
               ".h{font:bold 3.6px Arial,Helvetica,sans-serif}.t{font:2.4px Arial,Helvetica,sans-serif}"
               ".n{font:2.2px Arial,Helvetica,sans-serif}")
        html = ("<!doctype html><html><head><meta charset='utf-8'><style>" + css + "</style></head><body>"
                + "".join(page_svg(t, k, art, sx, sy) for t, k in pages) + "</body></html>")
        hp = os.path.join(tmp, "plate.html")
        open(hp, "w", encoding="utf-8").write(html)
        raw = os.path.join(tmp, "raw.pdf")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        "--no-margins", f"--print-to-pdf={raw}", "file://" + hp],
                       check=True, capture_output=True)
        # force an exact ISO A4 media box (595.276 x 841.890 pt) so drivers never rescale
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import RectangleObject
        r, w = PdfReader(raw), PdfWriter()
        A4W, A4H = 210 / 25.4 * 72, 297 / 25.4 * 72
        for p in r.pages:
            top = float(p.mediabox.top)
            box = RectangleObject([0, top - A4H, A4W, top])
            p.mediabox = box
            p.cropbox = box
            w.add_page(p)
        w.write(a.o)
    print("Saved:", a.o)


if __name__ == "__main__":
    main()
