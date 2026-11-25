#!/usr/bin/env python3
"""
Generates the KiCad 10 project for the TechBIT ESP32-S3 Master Hub (S3_Master_Hub):
  - kicad/S3_Master_Hub.kicad_pcb          (71.0 x 96.0 mm, single-layer B.Cu only)
  - kicad/S3_Master_Hub_Panel_A4.kicad_pcb (2x3 = 6 boards on A4 portrait)
  - kicad/S3_Master_Hub.kicad_pro
  - kicad/S3_Master_Hub.kicad_sch

Optimized for home LUT (toner transfer) + UV solder mask on 151 x 102 mm plates
(2 boards per 151 x 102 mm copper-clad plate). Zero vias, zero jumpers, zero F.Cu traces.
"""

import json
import math
import os
import uuid

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT_DIR, "kicad")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.join(ROOT_DIR, "3dmodels"), exist_ok=True)


def uid():
    return str(uuid.uuid4())


# Board dimensions: 71.0 mm x 96.0 mm
# Fits 2 boards side-by-side per 151 x 102 mm plate, or 2 x 3 = 6 boards on A4 Portrait.
BW = 71.0
BH = 96.0

NETS = [
    (0, ""),
    (1, "GND"),
    (2, "+12V_RAW"),
    (3, "+5V_BUCK"),
    (4, "+3V3"),
    (5, "CAN_TX"),
    (6, "CAN_RX"),
    (7, "CAN_L"),
    (8, "CAN_H"),
    (9, "CAN_TERM_MID"),
    (10, "TFT_CS"),
    (11, "TFT_RES"),
    (12, "TFT_DC"),
    (13, "TFT_MOSI"),
    (14, "TFT_SCK"),
    (15, "TFT_LED"),
    (16, "SD_CS"),
    (17, "SD_MOSI"),
    (18, "SD_MISO"),
    (19, "SD_SCK"),
]
NET_MAP = {name: num for num, name in NETS}


def pad_global(fx, fy, rot_deg, dx, dy):
    rad = math.radians(rot_deg)
    gx = fx + dx * math.cos(rad) + dy * math.sin(rad)
    gy = fy - dx * math.sin(rad) + dy * math.cos(rad)
    return (round(gx, 4), round(gy, 4))


def make_board_elements(ox, oy, ref_suffix="", net_offset=0, net_suffix=""):
    lines = []
    pad_coords = {}

    # Board outline on Edge.Cuts
    lines.append(
        f'  (gr_rect (start {ox:.3f} {oy:.3f}) (end {ox+BW:.3f} {oy+BH:.3f}) '
        f'(stroke (width 0.2) (type default)) (fill none) (layer "Edge.Cuts") (uuid "{uid()}"))'
    )

    # Top Silkscreen (F.SilkS): clean, non-overlapping, all >= 0.80 mm height
    # Tuple format: (text, x, y, rot, size, justify)
    top_silk_labels = [
        # Board Title
        ("TechBIT S3 MASTER HUB", 11.5, 9.0, 0, 0.90, ""),
        # J1: Vehicle 12V + CAN (wire entry UP)
        ("J1 CAR/CAN", 55.62, 1.8, 0, 0.85, ""),
        ("CANH", 48.00, 3.8, 0, 0.80, ""),
        ("CANL", 53.08, 3.8, 0, 0.80, ""),
        ("GND", 58.16, 3.8, 0, 0.80, ""),
        ("12V", 63.24, 3.8, 0, 0.80, ""),
        # MOD2: SN65HVD230 CAN Transceiver
        ("MOD2 SN65HVD230", 30.85, 10.7, 0, 0.80, ""),
        ("3V3", 24.50, 17.5, 90, 0.80, ""),
        ("GND", 27.04, 17.5, 90, 0.80, ""),
        ("TX", 29.58, 17.2, 90, 0.80, ""),
        ("RX", 32.12, 17.2, 90, 0.80, ""),
        ("L", 34.66, 17.0, 90, 0.80, ""),
        ("H", 37.20, 17.0, 90, 0.80, ""),
        # JP1: 120R CAN Termination Jumper
        ("JP1", 42.00, 11.8, 0, 0.80, ""),
        ("120R", 42.00, 19.8, 0, 0.80, ""),
        # MOD1: MP1584EN 12V/24V -> 5V Buck (22.1 x 16.8 mm, 8 pins)
        ("IN+ 12V", 6.86, 18.2, 0, 0.80, ""),
        ("IN- GND", 17.53, 18.2, 0, 0.80, ""),
        ("MOD1 MP1584EN", 12.20, 29.00, 0, 0.80, ""),
        ("DC-DC 5V 3A", 12.20, 31.60, 0, 0.80, ""),
        ("OUT+ 5V", 6.86, 42.2, 0, 0.80, ""),
        ("OUT- GND", 17.53, 42.2, 0, 0.80, ""),
        # C2: 10uF 3.3V decoupling
        ("+", 21.80, 48.0, 0, 0.90, ""),
        ("C2 10uF", 18.25, 51.9, 0, 0.80, ""),
        # C1: 100uF 5V bulk
        ("+", 16.00, 84.9, 0, 0.90, ""),
        ("C1 100uF", 16.00, 93.3, 0, 0.80, ""),
        # J2: 1.28" Red GC9A01 TFT SPI Display (8-pin)
        ("J2 TFT_GC9A01", 10.80, 61.5, 0, 0.85, "left"),
        ("3V3", 10.80, 64.48, 0, 0.80, "left"),
        ("GND", 10.80, 67.02, 0, 0.80, "left"),
        ("CS", 10.80, 69.56, 0, 0.80, "left"),
        ("RES", 10.80, 72.10, 0, 0.80, "left"),
        ("A0/DC", 10.80, 74.64, 0, 0.80, "left"),
        ("SDA", 10.80, 77.18, 0, 0.80, "left"),
        ("SCK", 10.80, 79.72, 0, 0.80, "left"),
        ("LED", 10.80, 82.26, 0, 0.80, "left"),
        # J3: MicroSD SPI Slot on 1.28" Red Module (4-pin)
        ("J3 MICRO_SD", 61.50, 43.0, 0, 0.85, ""),
        ("SD_CS", 63.80, 46.70, 0, 0.80, "left"),
        ("MOSI", 63.80, 49.24, 0, 0.80, "left"),
        ("MISO", 63.80, 51.78, 0, 0.80, "left"),
        ("SCK", 63.80, 54.32, 0, 0.80, "left"),
        # U1: ESP32-S3-DevKitC-1 N16R8 center annotations & active pin callouts
        ("WIFI ANTENNA UP", 40.20, 27.5, 0, 0.85, ""),
        ("U1 ESP32-S3", 40.20, 57.5, 0, 1.05, ""),
        ("DevKitC-1 N16R8", 40.20, 60.5, 0, 0.85, ""),
        ("USB-C DOWN", 40.20, 90.0, 0, 0.85, ""),
        # U1 Left header active pin callouts (x=30.0 left-justified)
        ("3V3", 30.00, 34.00, 0, 0.80, "left"),
        ("3V3", 30.00, 36.54, 0, 0.80, "left"),
        ("TX4", 30.00, 41.62, 0, 0.80, "left"),
        ("RX5", 30.00, 44.16, 0, 0.80, "left"),
        ("CS9", 30.00, 69.56, 0, 0.80, "left"),
        ("RS10", 30.00, 72.10, 0, 0.80, "left"),
        ("DC11", 30.00, 74.64, 0, 0.80, "left"),
        ("MO12", 30.00, 77.18, 0, 0.80, "left"),
        ("CK13", 30.00, 79.72, 0, 0.80, "left"),
        ("BL14", 30.00, 82.26, 0, 0.80, "left"),
        ("5V", 30.00, 84.80, 0, 0.80, "left"),
        ("GND", 30.00, 87.34, 0, 0.80, "left"),
        # U1 Right header active pin callouts (x=50.4 right-justified)
        ("GND", 50.40, 34.00, 0, 0.80, "right"),
        ("CS42", 50.40, 46.70, 0, 0.80, "right"),
        ("MO41", 50.40, 49.24, 0, 0.80, "right"),
        ("MI40", 50.40, 51.78, 0, 0.80, "right"),
        ("CK39", 50.40, 54.32, 0, 0.80, "right"),
        ("GND", 50.40, 84.80, 0, 0.80, "right"),
        ("GND", 50.40, 87.34, 0, 0.80, "right"),
    ]
    for ltxt, tx, ty, lrot, sz, just in top_silk_labels:
        rot_str = f" {lrot}" if lrot else ""
        just_str = f" (justify {just})" if just else ""
        lines.append(
            f'  (gr_text "{ltxt}" (at {ox+tx:.2f} {oy+ty:.2f}{rot_str}) (layer "F.SilkS") (uuid "{uid()}") '
            f'(effects (font (size {sz:.2f} {sz:.2f}) (thickness 0.14)){just_str}))'
        )

    # Bottom Silkscreen (B.SilkS) mirrored labels for SMD components (kept strictly off copper pads/traces)
    bot_silk_labels = [
        ("R1 120R", 46.50, 20.80, 0, 0.80),
        ("C3 100nF", 15.50, 57.50, 0, 0.80),
    ]
    for ltxt, tx, ty, lrot, sz in bot_silk_labels:
        lines.append(
            f'  (gr_text "{ltxt}" (at {ox+tx:.2f} {oy+ty:.2f}) (layer "B.SilkS") (uuid "{uid()}") '
            f'(effects (font (size {sz:.2f} {sz:.2f}) (thickness 0.14)) (justify mirror)))'
        )

    # Component outline boxes on F.SilkS (strictly clear of copper pad apertures)
    silk_boxes = [
        # J1 KF301-4P outline
        (45.30, 5.60, 65.90, 13.50),
        # MOD2 SN65HVD230 body outline above pins
        (23.10, 8.30, 38.60, 13.10),
        # JP1 1x02 jumper shroud outline
        (40.70, 13.20, 43.30, 18.34),
        # MOD1 MP1584EN inner body box between IN/OUT pads
        (4.80, 23.00, 19.60, 37.50),
        # U1 ESP32-S3-DevKitC-1 inner body box between L/R pin columns
        (29.10, 24.00, 51.30, 92.20),
        # J2 1x08 TFT header outline
        (7.10, 63.00, 9.90, 83.74),
        # J3 1x04 MicroSD header outline
        (60.10, 45.20, 62.90, 55.80),
    ]
    for x1, y1, x2, y2 in silk_boxes:
        lines.append(
            f'  (gr_rect (start {ox+x1:.2f} {oy+y1:.2f}) (end {ox+x2:.2f} {oy+y2:.2f}) '
            f'(stroke (width 0.15) (type solid)) (fill none) (layer "F.SilkS") (uuid "{uid()}"))'
        )

    def add_fp(lib_name, ref, val, layer, lx, ly, rot, pads, models, ref_offset=(0, -3.2), val_offset=(0, 3.2)):
        fx, fy = ox + lx, oy + ly
        r_full = ref + ref_suffix
        fab_layer = "F.Fab" if layer == "F.Cu" else "B.Fab"
        mirror_str = " (justify mirror)" if layer == "B.Cu" else ""
        lines.append(f'  (footprint "{lib_name}"')
        lines.append(f'    (layer "{layer}")')
        lines.append(f'    (uuid "{uid()}")')
        lines.append(f'    (at {fx:.4f} {fy:.4f} {rot})')
        lines.append(
            f'    (fp_text reference "{r_full}" (at {ref_offset[0]:.2f} {ref_offset[1]:.2f} {rot}) '
            f'(layer "{fab_layer}") hide (uuid "{uid()}") (effects (font (size 0.8 0.8) (thickness 0.12)){mirror_str}))'
        )
        lines.append(
            f'    (fp_text value "{val}" (at {val_offset[0]:.2f} {val_offset[1]:.2f} {rot}) '
            f'(layer "{fab_layer}") hide (uuid "{uid()}") (effects (font (size 0.8 0.8) (thickness 0.12)){mirror_str}))'
        )
        for pnum, ptype, pshape, dx, dy, sx, sy, drill, net_name in pads:
            gx, gy = pad_global(fx, fy, rot, dx, dy)
            pad_coords[(ref, str(pnum))] = (gx, gy)
            net_id = (NET_MAP[net_name] + net_offset) if net_name else 0
            if ptype == "thru_hole":
                p_layers = '"*.Cu" "*.Mask"'
                drill_str = f" (drill {drill:.2f})"
            else:
                p_layers = '"B.Cu" "B.Mask" "B.Paste"' if layer == "B.Cu" else '"F.Cu" "F.Mask" "F.Paste"'
                drill_str = ""
            rr = " (roundrect_rratio 0.25)" if pshape == "roundrect" else ""
            net_str = f' (net {net_id} "{net_name}{net_suffix}")' if net_name else ""
            lines.append(
                f'    (pad "{pnum}" {ptype} {pshape} (at {dx:.4f} {dy:.4f} {rot}) '
                f'(size {sx:.2f} {sy:.2f}){drill_str} (layers {p_layers}){rr}{net_str} (uuid "{uid()}"))'
            )
        for mpath, moff, mrot in models:
            ox_m, oy_m, oz_m = moff
            rx_m, ry_m, rz_m = mrot
            lines.append(f'    (model "{mpath}"')
            lines.append(f"      (offset (xyz {ox_m:.3f} {oy_m:.3f} {oz_m:.3f}))")
            lines.append("      (scale (xyz 1 1 1))")
            lines.append(f"      (rotate (xyz {rx_m:.1f} {ry_m:.1f} {rz_m:.1f}))")
            lines.append("    )")
        lines.append("  )")

    # 1. U1: ESP32-S3-DevKitC-1 N16R8 (2x22 2.54mm, 25.40mm spacing, Wi-Fi UP, Dual USB-C DOWN)
    left_nets = [
        "+3V3",      # L1: 3V3
        "+3V3",      # L2: 3V3
        "",          # L3: RST
        "CAN_TX",    # L4: GPIO4
        "CAN_RX",    # L5: GPIO5
        "", "", "", "", "", "", "", "", "",  # L6..L14: GPIO6,7,15,16,17,18,8,3,46
        "TFT_CS",    # L15: GPIO9
        "TFT_RES",   # L16: GPIO10
        "TFT_DC",    # L17: GPIO11
        "TFT_MOSI",  # L18: GPIO12
        "TFT_SCK",   # L19: GPIO13
        "TFT_LED",   # L20: GPIO14
        "+5V_BUCK",  # L21: 5V
        "GND",       # L22: GND
    ]
    right_nets = [
        "GND",       # R1: GND
        "", "", "", "",  # R2..R5: TX/43, RX/44, GPIO1, GPIO2
        "SD_CS",     # R6: GPIO42
        "SD_MOSI",   # R7: GPIO41
        "SD_MISO",   # R8: GPIO40
        "SD_SCK",    # R9: GPIO39
        "", "", "", "", "", "", "", "", "", "", "",  # R10..R20: GPIO38,37,36,35,0,45,48,47,21,20,19
        "GND",       # R21: GND
        "GND",       # R22: GND
    ]
    u1_pads = []
    for idx, net in enumerate(left_nets):
        shape = "roundrect" if idx == 0 else "circle"
        u1_pads.append((f"L{idx+1}", "thru_hole", shape, 0.0, idx * 2.54, 1.9, 1.9, 0.9, net))
    for idx, net in enumerate(right_nets):
        u1_pads.append((f"R{idx+1}", "thru_hole", "circle", 25.40, idx * 2.54, 1.9, 1.9, 0.9, net))

    add_fp(
        "Module:ESP32-S3-DevKitC-1",
        "U1", "ESP32-S3-DevKitC-1", "F.Cu", 27.50, 34.00, 0,
        u1_pads,
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x22_P2.54mm_Vertical.step", (0, 0, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x22_P2.54mm_Vertical.step", (25.40, 0, 0), (0, 0, 0)),
            ("${KIPRJMOD}/../3dmodels/ESP32_S3_DevKitC_1.wrl", (0, 0, 0), (0, 0, 0)),
        ],
        ref_offset=(12.70, -5.0), val_offset=(12.70, 58.0),
    )

    # 2. J1: KF301-4P (5.08mm) Vehicle 12V + CAN Bus (wire entry UP toward y=0)
    add_fp(
        "TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal",
        "J1", "KF301-4P", "F.Cu", 63.24, 9.50, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.6, 2.6, 1.3, "+12V_RAW"),
            ("2", "thru_hole", "circle", 5.08, 0.0, 2.6, 2.6, 1.3, "GND"),
            ("3", "thru_hole", "circle", 10.16, 0.0, 2.6, 2.6, 1.3, "CAN_L"),
            ("4", "thru_hole", "circle", 15.24, 0.0, 2.6, 2.6, 1.3, "CAN_H"),
        ],
        [("${KICAD10_3DMODEL_DIR}/TerminalBlock_Phoenix.3dshapes/TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(7.62, -4.0), val_offset=(7.62, 4.5),
    )

    # 3. MOD1: MP1584EN DC-DC Buck Converter (D-SUN 22.1 x 16.8 mm, 8 holes, 4.5-28V -> 5.0V 3A)
    add_fp(
        "Module:MP1584EN_Buck",
        "MOD1", "MP1584EN_5V", "F.Cu", 18.80, 21.00, 270,
        [
            ("1a", "thru_hole", "roundrect", 0.000, 0.000, 2.0, 2.0, 1.0, "GND"),
            ("1b", "thru_hole", "circle", 0.000, 2.540, 2.0, 2.0, 1.0, "GND"),
            ("2b", "thru_hole", "circle", 0.000, 10.668, 2.0, 2.0, 1.0, "+12V_RAW"),
            ("2a", "thru_hole", "circle", 0.000, 13.208, 2.0, 2.0, 1.0, "+12V_RAW"),
            ("3a", "thru_hole", "circle", 18.542, 0.000, 2.0, 2.0, 1.0, "GND"),
            ("3b", "thru_hole", "circle", 18.542, 2.540, 2.0, 2.0, 1.0, "GND"),
            ("4b", "thru_hole", "circle", 18.542, 10.668, 2.0, 2.0, 1.0, "+5V_BUCK"),
            ("4a", "thru_hole", "circle", 18.542, 13.208, 2.0, 2.0, 1.0, "+5V_BUCK"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0.000, 0.000, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0.000, -2.540, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0.000, -10.668, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0.000, -13.208, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (18.542, 0.000, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (18.542, -2.540, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (18.542, -10.668, 0), (0, 0, 0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (18.542, -13.208, 0), (0, 0, 0)),
            ("${KIPRJMOD}/../3dmodels/MP1584EN_Buck.wrl", (0, 0, 0), (0, 0, 0)),
        ],
        ref_offset=(9.27, 6.60), val_offset=(9.27, 9.20),
    )

    # 4. MOD2: SN65HVD230 CAN Transceiver (1x06 header)
    add_fp(
        "Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical",
        "MOD2", "SN65HVD230_CAN", "F.Cu", 24.50, 14.50, 90,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, "+3V3"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, "GND"),
            ("3", "thru_hole", "circle", 0.0, 5.08, 1.9, 1.9, 0.9, "CAN_TX"),
            ("4", "thru_hole", "circle", 0.0, 7.62, 1.9, 1.9, 0.9, "CAN_RX"),
            ("5", "thru_hole", "circle", 0.0, 10.16, 1.9, 1.9, 0.9, "CAN_L"),
            ("6", "thru_hole", "circle", 0.0, 12.70, 1.9, 1.9, 0.9, "CAN_H"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x06_P2.54mm_Vertical.step", (0, 0, 0), (0, 0, 0)),
            ("${KIPRJMOD}/../3dmodels/SN65HVD230_Module.wrl", (0, 0, 0), (0, 0, 0)),
        ],
        ref_offset=(2.2, 6.35), val_offset=(-2.5, 6.35),
    )

    # 5. JP1: 120R CAN Termination Jumper (PinHeader 1x02)
    add_fp(
        "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical",
        "JP1", "CAN_120R", "F.Cu", 42.00, 14.50, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, "CAN_H"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, "CAN_TERM_MID"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x02_P2.54mm_Vertical.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(0, -2.5), val_offset=(0, 5.0),
    )

    # 6. R1: 120R 1206 SMD Termination Resistor on B.Cu
    # Placed at (42.00, 20.80) rot 270 -> Pad 1 UP at 19.3375 (0.60 mm clearance from JP1.2), Pad 2 DOWN at 22.2625
    add_fp(
        "Resistor_SMD:R_1206_3216Metric",
        "R1", "120R", "B.Cu", 42.00, 20.80, 270,
        [
            ("1", "smd", "roundrect", -1.4625, 0.0, 1.5, 1.8, 0, "CAN_TERM_MID"),
            ("2", "smd", "roundrect", 1.4625, 0.0, 1.5, 1.8, 0, "CAN_L"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_1206_3216Metric.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(0, -2.5), val_offset=(0, 2.5),
    )

    # 7. J2: TFT_GC9A01 (1x08 Vertical PinHeader) for 1.28" Red GC9A01 Display
    add_fp(
        "Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical",
        "J2", "TFT_GC9A01", "F.Cu", 8.50, 64.48, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, "+3V3"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, "GND"),
            ("3", "thru_hole", "circle", 0.0, 5.08, 1.9, 1.9, 0.9, "TFT_CS"),
            ("4", "thru_hole", "circle", 0.0, 7.62, 1.9, 1.9, 0.9, "TFT_RES"),
            ("5", "thru_hole", "circle", 0.0, 10.16, 1.9, 1.9, 0.9, "TFT_DC"),
            ("6", "thru_hole", "circle", 0.0, 12.70, 1.9, 1.9, 0.9, "TFT_MOSI"),
            ("7", "thru_hole", "circle", 0.0, 15.24, 1.9, 1.9, 0.9, "TFT_SCK"),
            ("8", "thru_hole", "circle", 0.0, 17.78, 1.9, 1.9, 0.9, "TFT_LED"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x08_P2.54mm_Vertical.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(0, -3.0), val_offset=(0, 20.5),
    )

    # 8. J3: MICRO_SD (1x04 Vertical PinHeader) for 1.28" Red Module MicroSD Slot
    add_fp(
        "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical",
        "J3", "MICRO_SD", "F.Cu", 61.50, 46.70, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, "SD_CS"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, "SD_MOSI"),
            ("3", "thru_hole", "circle", 0.0, 5.08, 1.9, 1.9, 0.9, "SD_MISO"),
            ("4", "thru_hole", "circle", 0.0, 7.62, 1.9, 1.9, 0.9, "SD_SCK"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x04_P2.54mm_Vertical.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(0, -3.0), val_offset=(0, 10.5),
    )

    # 9. C1: 100uF Radial Electrolytic Cap on 5V rail
    add_fp(
        "Capacitor_THT:CP_Radial_D5.0mm_P2.50mm",
        "C1", "100uF", "F.Cu", 16.00, 87.50, 270,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.1, 2.1, 0.9, "+5V_BUCK"),
            ("2", "thru_hole", "circle", 2.5, 0.0, 2.1, 2.1, 0.9, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_THT.3dshapes/CP_Radial_D5.0mm_P2.50mm.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(1.25, -3.5), val_offset=(1.25, 3.5),
    )

    # 10. C2: 10uF Radial Electrolytic Cap on 3.3V rail (clear below MP1584EN)
    add_fp(
        "Capacitor_THT:CP_Radial_D5.0mm_P2.50mm",
        "C2", "10uF", "F.Cu", 19.50, 48.00, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.1, 2.1, 0.9, "+3V3"),
            ("2", "thru_hole", "circle", 2.5, 0.0, 2.1, 2.1, 0.9, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_THT.3dshapes/CP_Radial_D5.0mm_P2.50mm.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(1.25, -3.5), val_offset=(1.25, 3.5),
    )

    # 11. C3: 100nF 1206 SMD Ceramic Decoupling Cap on B.Cu
    add_fp(
        "Capacitor_SMD:C_1206_3216Metric",
        "C3", "100nF", "B.Cu", 13.00, 60.50, 0,
        [
            ("1", "smd", "roundrect", -1.475, 0.0, 1.5, 1.8, 0, "GND"),
            ("2", "smd", "roundrect", 1.475, 0.0, 1.5, 1.8, 0, "+3V3"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_1206_3216Metric.step", (0, 0, 0), (0, 0, 0))],
        ref_offset=(0, -2.5), val_offset=(0, 2.5),
    )

    def add_path(pts, net_name, width=1.0):
        net_id = (NET_MAP[net_name] + net_offset) if net_name else 0
        for i in range(len(pts) - 1):
            x1, y1 = pts[i]
            x2, y2 = pts[i + 1]
            if abs(x1 - x2) < 1e-4 and abs(y1 - y2) < 1e-4:
                continue
            lines.append(
                f'  (segment (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f}) '
                f'(width {width:.2f}) (layer "B.Cu") (net {net_id}) (uuid "{uid()}"))'
            )

    def P(ref, pin):
        return pad_coords[(ref, str(pin))]

    def L(x, y):
        return (round(ox + x, 4), round(oy + y, 4))

    # --- 100% SINGLE-LAYER ROUTING ON B.Cu (zero vias, zero crossings, zero copper pour) ---

    # +12V_RAW (1.4 mm): J1.1 -> top edge -> left edge -> MOD1.2a -> MOD1.2b (IN+)
    add_path([P("J1", 1), L(63.24, 3.00), L(3.00, 3.00), L(3.00, 21.00), P("MOD1", "2a"), P("MOD1", "2b")], "+12V_RAW", 1.4)

    # +5V_BUCK (1.2 mm): MOD1.4b -> MOD1.4a (OUT+) -> left edge -> C1.1 & U1.L21
    add_path([P("MOD1", "4b"), P("MOD1", "4a"), L(3.00, 39.542), L(3.00, 84.80), L(16.00, 84.80), P("U1", "L21")], "+5V_BUCK", 1.2)
    add_path([L(16.00, 84.80), P("C1", 1)], "+5V_BUCK", 1.2)

    # +3V3 (1.1 mm): J2.1 -> C3.2 -> C2.1 -> U1.L2 -> U1.L1 -> MOD2.1
    add_path([P("J2", 1), L(14.475, 64.48), P("C3", 2)], "+3V3", 1.0)
    add_path([P("C3", 2), L(19.50, 60.50), P("C2", 1), L(22.00, 48.00), L(22.00, 36.54), P("U1", "L2"), P("U1", "L1")], "+3V3", 1.1)
    add_path([P("U1", "L1"), L(24.50, 34.00), P("MOD2", 1)], "+3V3", 1.1)

    # CAN_TX & CAN_RX (0.9 mm): MOD2 -> U1.L4 / U1.L5
    add_path([P("MOD2", 3), L(29.58, 19.00), L(30.50, 19.92), L(30.50, 41.62), P("U1", "L4")], "CAN_TX", 0.9)
    add_path([P("MOD2", 4), L(32.12, 19.00), L(33.00, 19.88), L(33.00, 44.16), P("U1", "L5")], "CAN_RX", 0.9)

    # CAN_H (1.0 mm): MOD2.6 -> JP1.1 -> J1.4
    add_path([P("MOD2", 6), P("JP1", 1), L(42.00, 12.00), L(48.00, 12.00), P("J1", 4)], "CAN_H", 1.0)

    # CAN_TERM_MID (1.0 mm): JP1.2 -> R1.1
    add_path([P("JP1", 2), P("R1", 1)], "CAN_TERM_MID", 1.0)

    # CAN_L (1.0 mm): MOD2.5 -> R1.2 & J1.3
    add_path([P("MOD2", 5), L(34.66, 18.00), L(36.00, 19.34), L(36.00, 25.00), L(53.08, 25.00), P("J1", 3)], "CAN_L", 1.0)
    add_path([L(42.00, 25.00), P("R1", 2)], "CAN_L", 1.0)

    # TFT_GC9A01 SPI bus (0.9 mm): J2.3..J2.8 straight horizontal to U1.L15..U1.L20
    for j_pin, u_pin, net_name in [
        (3, "L15", "TFT_CS"),
        (4, "L16", "TFT_RES"),
        (5, "L17", "TFT_DC"),
        (6, "L18", "TFT_MOSI"),
        (7, "L19", "TFT_SCK"),
        (8, "L20", "TFT_LED"),
    ]:
        add_path([P("J2", j_pin), P("U1", u_pin)], net_name, 0.9)

    # MICRO_SD SPI bus (0.9 mm): U1.R6..U1.R9 straight horizontal to J3.1..J3.4
    for u_pin, j_pin, net_name in [
        ("R6", 1, "SD_CS"),
        ("R7", 2, "SD_MOSI"),
        ("R8", 3, "SD_MISO"),
        ("R9", 4, "SD_SCK"),
    ]:
        add_path([P("U1", u_pin), P("J3", j_pin)], net_name, 0.9)

    # GND network (1.0..1.4 mm): planar tree connecting all 16 GND pads without crossing
    add_path([P("J2", 2), L(5.80, 67.02), L(5.80, 60.50), P("C3", 1)], "GND", 1.0)
    add_path([P("C3", 1), L(11.525, 51.50), L(17.00, 51.50), P("C2", 2)], "GND", 1.1)
    add_path([P("C2", 2), L(17.00, 43.00), L(16.260, 43.00), P("MOD1", "3b"), P("MOD1", "3a"), P("MOD1", "1a"), P("MOD1", "1b")], "GND", 1.2)
    add_path([P("MOD1", "1b"), L(16.260, 6.00), L(27.04, 6.00), P("MOD2", 2)], "GND", 1.2)
    add_path([L(27.04, 6.00), L(58.16, 6.00), P("J1", 2)], "GND", 1.3)
    add_path([P("J1", 2), L(58.16, 15.00), L(58.16, 28.00), L(52.90, 28.00), P("U1", "R1")], "GND", 1.2)
    add_path(
        [
            L(58.16, 15.00),
            L(67.00, 15.00),
            L(67.00, 91.50),
            L(16.00, 91.50),
            P("C1", 2),
        ],
        "GND",
        1.4,
    )
    add_path([L(27.50, 91.50), P("U1", "L22")], "GND", 1.2)
    add_path([L(52.90, 91.50), P("U1", "R22"), P("U1", "R21")], "GND", 1.2)

    return lines


def pcb_header():
    h = [
        "(kicad_pcb",
        "  (version 20240108)",
        '  (generator "pcbnew")',
        '  (generator_version "10.0")',
        "  (general (thickness 1.6) (legacy_teardrops no))",
        '  (paper "A4" portrait)',
        "  (layers",
        '    (0 "F.Cu" signal)',
        '    (31 "B.Cu" signal)',
        '    (32 "B.Adhes" user "B.Adhesive")',
        '    (33 "F.Adhes" user "F.Adhesive")',
        '    (34 "B.Paste" user)',
        '    (35 "F.Paste" user)',
        '    (36 "B.SilkS" user "B.Silkscreen")',
        '    (37 "F.SilkS" user "F.Silkscreen")',
        '    (38 "B.Mask" user)',
        '    (39 "F.Mask" user)',
        '    (40 "Dwgs.User" user "User.Drawings")',
        '    (41 "Cmts.User" user "User.Comments")',
        '    (44 "Edge.Cuts" user)',
        '    (46 "B.CrtYd" user "B.Courtyard")',
        '    (47 "F.CrtYd" user "F.Courtyard")',
        '    (48 "B.Fab" user)',
        '    (49 "F.Fab" user)',
        "  )",
        "  (setup (pad_to_mask_clearance 0.15))",
    ]
    for nid, nname in NETS:
        h.append(f'  (net {nid} "{nname}")')
    return h


def write_pro_file(pro_path, sch_filename, sch_name):
    # Match Wheel_Sensor_Amplifier.kicad_pro DRC/design settings strictly
    ref_pro = os.path.join(OUT_DIR, "Wheel_Sensor_Amplifier.kicad_pro")
    if os.path.exists(ref_pro):
        with open(ref_pro, encoding="utf-8") as f:
            pro_data = json.load(f)
    else:
        pro_data = {
            "board": {"design_settings": {"defaults": {"board_outline_line_width": 0.2}}},
            "meta": {"version": 3},
            "schematic": {"drawing": {"default_line_thickness": 6.0}},
        }
    pro_data.setdefault("meta", {})["filename"] = os.path.basename(pro_path)
    # Footprints are intentionally embedded with LUT-enlarged pads and custom module names
    rs = pro_data.setdefault("board", {}).setdefault("design_settings", {}).setdefault("rule_severities", {})
    rs["lib_footprint_issues"] = "ignore"
    rs["lib_footprint_mismatch"] = "ignore"
    if "schematic" in pro_data and "top_level_sheets" in pro_data["schematic"]:
        pro_data["schematic"]["top_level_sheets"] = [
            {
                "filename": sch_filename,
                "name": sch_name,
                "uuid": "00000000-0000-0000-0000-000000000000",
            }
        ]
    with open(pro_path, "w", encoding="utf-8") as f:
        json.dump(pro_data, f, indent=2)


def main():
    # 1. Single Board PCB centered on A4 portrait (210 x 297 mm)
    single_pcb_path = os.path.join(OUT_DIR, "S3_Master_Hub.kicad_pcb")
    ox_single = (210.0 - BW) / 2.0   # 69.50 mm
    oy_single = (297.0 - BH) / 2.0   # 100.50 mm
    with open(single_pcb_path, "w", encoding="utf-8") as f:
        f.write("\n".join(pcb_header() + make_board_elements(ox_single, oy_single) + [")"]) + "\n")

    # 2. 6-Board (2x3) A4 Portrait Panel PCB (210 x 297 mm)
    # 2 cols * 71.0 = 142.0 mm + 4.0 mm gap = 146.0 mm -> x0 = 32.0 mm
    # 3 rows * 96.0 = 288.0 mm + 2 * 2.0 mm gaps = 292.0 mm -> y0 = 2.5 mm
    panel_pcb_path = os.path.join(OUT_DIR, "S3_Master_Hub_Panel_A4.kicad_pcb")
    net_count = len(NETS) - 1
    panel_hdr = pcb_header()[: -len(NETS)] + ['  (net 0 "")']
    panel_body = []
    for row in range(3):
        for col in range(2):
            idx = row * 2 + col + 1
            noff = (idx - 1) * net_count
            for nid, nname in NETS[1:]:
                panel_hdr.append(f'  (net {nid + noff} "{nname}_{idx}")')
            bx = 32.0 + col * (BW + 4.0)
            by = 2.5 + row * (BH + 2.0)
            panel_body.extend(
                make_board_elements(bx, by, ref_suffix=f"_{idx}", net_offset=noff, net_suffix=f"_{idx}")
            )
    with open(panel_pcb_path, "w", encoding="utf-8") as f:
        f.write("\n".join(panel_hdr + panel_body + [")"]) + "\n")

    # 3. KiCad Project Files (.kicad_pro)
    write_pro_file(
        os.path.join(OUT_DIR, "S3_Master_Hub.kicad_pro"),
        "S3_Master_Hub.kicad_sch",
        "S3_Master_Hub",
    )
    write_pro_file(
        os.path.join(OUT_DIR, "S3_Master_Hub_Panel_A4.kicad_pro"),
        "S3_Master_Hub.kicad_sch",
        "S3_Master_Hub",
    )

    # 4. KiCad Schematic (.kicad_sch) with complete BOM, pinout & netlist documentation
    sch_text = (
        "COMPLETE SINGLE-LAYER (B.Cu) TECHBIT ESP32-S3 MASTER HUB (71.0 x 96.0 mm)\\n\\n"
        "TOP SIDE (F.Cu - THT & Modules):\\n"
        "- U1: ESP32-S3-DevKitC-1 N16R8 (2x22 2.54mm PinSockets, Wi-Fi Antenna UP, Dual USB-C DOWN)\\n"
        "  Left L1..L22: L1/L2=3V3, L3=RST, L4=GPIO4(CAN_TX), L5=GPIO5(CAN_RX),\\n"
        "               L15=GPIO9(TFT_CS), L16=GPIO10(TFT_RES), L17=GPIO11(TFT_DC),\\n"
        "               L18=GPIO12(TFT_MOSI), L19=GPIO13(TFT_SCK), L20=GPIO14(TFT_LED), L21=5V, L22=GND\\n"
        "  Right R1..R22: R1=GND, R6=GPIO42(SD_CS), R7=GPIO41(SD_MOSI), R8=GPIO40(SD_MISO),\\n"
        "                 R9=GPIO39(SD_SCK), R21=GND, R22=GND\\n"
        "- MOD1: MP1584EN DC-DC Buck Converter (D-SUN 22.1x16.8mm, 8 holes, 4.5-28V -> 5.0V 3A; IN+=12V, IN-=GND, OUT+=5V, OUT-=GND)\\n"
        "- MOD2: SN65HVD230 CAN Transceiver 3.3V (1=3V3, 2=GND, 3=CAN_TX, 4=CAN_RX, 5=CAN_L, 6=CAN_H)\\n"
        "- J1: KF301-4P (5.08mm) Vehicle 12V + CAN Bus (1=+12V_RAW, 2=GND, 3=CAN_L, 4=CAN_H; entry UP)\\n"
        "- JP1: 1x02 (2.54mm) CAN 120R Termination Jumper (Pin1=CAN_H, Pin2=CAN_TERM_MID -> R1 -> CAN_L)\\n"
        "- J2: 1x08 (2.54mm) 1.28in Red GC9A01 TFT SPI (1=3V3, 2=GND, 3=CS, 4=RES, 5=DC/A0, 6=MOSI/SDA, 7=SCK, 8=LED)\\n"
        "- J3: 1x04 (2.54mm) 1.28in Red Module MicroSD SPI (1=SD_CS, 2=SD_MOSI, 3=SD_MISO, 4=SD_SCK)\\n"
        "- C1: 100uF Radial Electrolytic (D5.0/P2.5) +5V_BUCK Bulk Filter (+ on Pin1)\\n"
        "- C2: 10uF Radial Electrolytic (D5.0/P2.5) +3V3 Filter (+ on Pin1)\\n\\n"
        "BOTTOM SIDE (B.Cu - SMD on Copper Layer):\\n"
        "- R1: 120R (1206) CAN Bus Termination Resistor (JP1 Pin2 CAN_TERM_MID <-> CAN_L)\\n"
        "- C3: 100nF (1206) +3V3 High-Frequency Decoupling Capacitor (near J2 TFT)"
    )
    sch_content = f"""(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (generator_version "10.0")
  (uuid "{uid()}")
  (paper "A4")
  (title_block
    (title "TechBIT ESP32-S3 Master Hub (CAN + 1.28in GC9A01 TFT + MicroSD)")
    (date "2026-11-25")
    (rev "1.0-LUT-1Layer")
    (company "TechBIT")
  )
  (lib_symbols)
  (text "{sch_text}"
    (exclude_from_sim no)
    (at 20.0 30.0 0)
    (effects (font (size 2.0 2.0) (thickness 0.3)) (justify left top))
    (uuid "{uid()}")
  )
)
"""
    with open(os.path.join(OUT_DIR, "S3_Master_Hub.kicad_sch"), "w", encoding="utf-8") as f:
        f.write(sch_content)

    print("Generated S3_Master_Hub KiCad project (single + 2x3 panel + schematic + pro).")


if __name__ == "__main__":
    main()
