import os, math, uuid, subprocess, json

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT_DIR, "kicad")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(os.path.join(ROOT_DIR, "3dmodels"), exist_ok=True)

def uid():
    return str(uuid.uuid4())

# Board dimensions: 66.0 mm x 50.0 mm
# Fits 3 columns x 5 rows = 15 boards on A4 Portrait (210 x 297 mm)!
BW = 66.0
BH = 50.0

NETS = [
    (0, ""),
    (1, "GND"),
    (2, "+12V_RAW"),
    (3, "+5V_BUCK"),
    (4, "+3V3"),
    (5, "PIEZO_IN"),
    (6, "NODE_C1_R1"),
    (7, "SUM_NODE"),
    (8, "VREF_1V65"),
    (9, "AMP_OUT1"),
    (10, "ADC_SIGNAL"),
    (11, "U1B_OUT"),
    (12, "I2C_SCL"),
    (13, "I2C_SDA"),
    (14, "CAN_TX"),
    (15, "CAN_RX"),
    (16, "CAN_L"),
    (17, "CAN_H"),
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
    lines.append(f'  (gr_rect (start {ox:.3f} {oy:.3f}) (end {ox+BW:.3f} {oy+BH:.3f}) (stroke (width 0.2) (type default)) (fill none) (layer "Edge.Cuts") (uuid "{uid()}"))')

    # Clean, non-overlapping Top Silkscreen (F.SilkS) labels with both Reference and Value
    top_silk_labels = [
        # J1 Piezo Connector
        ("J1 PIEZO", 4.5, 17.0, 0, 0.85),
        ("PIEZO+", 4.5, 18.8, 0, 0.75),
        ("GND", 4.5, 32.3, 0, 0.75),
        # R1, R5, R2, R3, C5
        ("R1 10k", 12.8, 13.0, 0, 0.8),
        ("R5 100R", 24.3, 8.8, 0, 0.8),
        ("R2 100k", 25.1, 30.1, 0, 0.8),
        ("R3 100k", 17.5, 35.1, 0, 0.8),
        ("C5 10uF", 20.0, 46.2, 0, 0.8),
        ("+", 23.6, 43.0, 0, 0.85),
        # U1 MCP6002-I/P (vertical inside DIP-8 body)
        ("U1 MCP6002", 21.31, 24.35, 90, 0.8),
        # MOD2 SN65HVD230 CAN (horizontal above pins)
        ("MOD2 SN65HVD230", 48.35, 3.0, 0, 0.8),
        # U2 ESP32-C3 SuperMini (inside empty center body)
        ("U2 ESP32-C3", 40.38, 15.5, 0, 0.9),
        ("SuperMini", 40.38, 18.0, 0, 0.8),
        ("USB-C DOWN", 40.38, 28.5, 0, 0.75),
        # MOD1 Mini360 5V (inside empty center body)
        ("MOD1 Mini360", 34.5, 39.2, 0, 0.8),
        ("DC-DC 5V", 34.5, 41.5, 0, 0.8),
        # J3 Side Temp Sensor Connector
        ("J3 SHT40", 61.5, 15.2, 0, 0.8),
        ("SCL", 62.4, 19.0, 0, 0.75),
        ("SDA", 62.4, 21.5, 0, 0.75),
        ("GND", 62.4, 24.0, 0, 0.75),
        ("3V3", 62.4, 26.5, 0, 0.75),
        # J2 Vehicle 12V + CAN Connector
        ("J2 CAR/CAN", 53.1, 36.2, 0, 0.85),
        ("12V", 45.50, 38.3, 0, 0.75),
        ("GND", 50.58, 38.3, 0, 0.75),
        ("CANL", 55.66, 38.3, 0, 0.7),
        ("CANH", 60.74, 38.3, 0, 0.7),
    ]
    for ltxt, tx, ty, lrot, sz in top_silk_labels:
        rot_str = f" {lrot}" if lrot else ""
        lines.append(f'  (gr_text "{ltxt}" (at {ox+tx:.2f} {oy+ty:.2f}{rot_str}) (layer "F.SilkS") (uuid "{uid()}") (effects (font (size {sz:.2f} {sz:.2f}) (thickness 0.15))))')

    # Clean, non-overlapping Bottom Silkscreen (B.SilkS) labels for SMD components
    bot_silk_labels = [
        ("C3 100nF", 8.25, 4.0, 0, 0.75),
        ("D1 BAT54S", 7.8, 18.4, 0, 0.75),
        ("C1 1nF", 9.0, 25.4, 0, 0.75),
        ("C2 330pF", 16.8, 9.3, 0, 0.75),
        ("R4 4.7M", 21.9, 16.0, 0, 0.75),
        ("C4 100nF", 32.5, 7.2, 0, 0.75),
    ]
    for ltxt, tx, ty, lrot, sz in bot_silk_labels:
        lines.append(f'  (gr_text "{ltxt}" (at {ox+tx:.2f} {oy+ty:.2f}) (layer "B.SilkS") (uuid "{uid()}") (effects (font (size {sz:.2f} {sz:.2f}) (thickness 0.15)) (justify mirror)))')

    # Component outline boxes on F.SilkS (kept strictly outside copper pad apertures)
    silk_boxes = [
        # J1 outline
        (1.2, 20.2, 7.8, 31.0),
        # R1 body between pads
        (11.6, 17.2, 14.0, 21.3),
        # R5 body between pads
        (22.2, 10.3, 26.4, 12.7),
        # U1 DIP-8 inner body box
        (19.2, 19.3, 23.4, 29.3),
        # R2 body between pads
        (23.0, 31.3, 27.2, 33.7),
        # R3 body between pads
        (15.4, 36.3, 19.6, 38.7),
        # MOD2 header upper body box
        (40.5, 1.5, 56.2, 4.8),
        # U2 ESP32-C3 inner body box
        (34.5, 10.0, 46.2, 30.2),
        # MOD1 Mini360 inner body box
        (29.2, 35.5, 39.7, 45.0),
        # J3 Side-entry shroud box (protruding to right edge)
        (59.0, 16.8, 65.8, 28.7),
        # J2 4-pin terminal block box
        (42.8, 39.5, 63.4, 47.4),
    ]
    for x1, y1, x2, y2 in silk_boxes:
        lines.append(f'  (gr_rect (start {ox+x1:.2f} {oy+y1:.2f}) (end {ox+x2:.2f} {oy+y2:.2f}) (stroke (width 0.15) (type solid)) (fill none) (layer "F.SilkS") (uuid "{uid()}"))')

    def add_fp(lib_name, ref, val, layer, lx, ly, rot, pads, models, ref_offset=(0, -3.2), val_offset=(0, 3.2)):
        fx, fy = ox + lx, oy + ly
        r_full = ref + ref_suffix
        fab_layer = "F.Fab" if layer == "F.Cu" else "B.Fab"
        mirror_str = " (justify mirror)" if layer == "B.Cu" else ""
        lines.append(f'  (footprint "{lib_name}"')
        lines.append(f'    (layer "{layer}")')
        lines.append(f'    (uuid "{uid()}")')
        lines.append(f'    (at {fx:.4f} {fy:.4f} {rot})')
        lines.append(f'    (fp_text reference "{r_full}" (at {ref_offset[0]:.2f} {ref_offset[1]:.2f} {rot}) (layer "{fab_layer}") hide (uuid "{uid()}") (effects (font (size 0.8 0.8) (thickness 0.12)){mirror_str}))')
        lines.append(f'    (fp_text value "{val}" (at {val_offset[0]:.2f} {val_offset[1]:.2f} {rot}) (layer "{fab_layer}") hide (uuid "{uid()}") (effects (font (size 0.8 0.8) (thickness 0.12)){mirror_str}))')
        for pnum, ptype, pshape, dx, dy, sx, sy, drill, net_name in pads:
            gx, gy = pad_global(fx, fy, rot, dx, dy)
            pad_coords[(ref, str(pnum))] = (gx, gy)
            net_id = (NET_MAP[net_name] + net_offset) if net_name else 0
            if ptype == "thru_hole":
                p_layers = '"*.Cu" "*.Mask"'
                drill_str = f' (drill {drill:.2f})'
            else:
                p_layers = '"B.Cu" "B.Mask" "B.Paste"' if layer == "B.Cu" else '"F.Cu" "F.Mask" "F.Paste"'
                drill_str = ''
            rr = ' (roundrect_rratio 0.25)' if pshape == "roundrect" else ''
            net_str = f' (net {net_id} "{net_name}{net_suffix}")' if net_name else ''
            lines.append(f'    (pad "{pnum}" {ptype} {pshape} (at {dx:.4f} {dy:.4f} {rot}) (size {sx:.2f} {sy:.2f}){drill_str} (layers {p_layers}){rr}{net_str} (uuid "{uid()}"))')
        for mpath, moff, mrot in models:
            ox_m, oy_m, oz_m = moff
            rx_m, ry_m, rz_m = mrot
            lines.append(f'    (model "{mpath}"')
            lines.append(f'      (offset (xyz {ox_m:.3f} {oy_m:.3f} {oz_m:.3f}))')
            lines.append(f'      (scale (xyz 1 1 1))')
            lines.append(f'      (rotate (xyz {rx_m:.1f} {ry_m:.1f} {rz_m:.1f}))')
            lines.append(f'    )')
        lines.append('  )')

    # 1. J1: PIEZO_SENSOR (KF301-2P 5.08mm) on F.Cu at (4.5, 23.08), rot 270
    add_fp(
        "TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal",
        "J1", "PIEZO_IN", "F.Cu", 4.5, 23.08, 270,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.6, 2.6, 1.3, "PIEZO_IN"),
            ("2", "thru_hole", "circle", 5.08, 0.0, 2.6, 2.6, 1.3, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/TerminalBlock_Phoenix.3dshapes/TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(-3.2, -0.5), val_offset=(8.2, -0.5)
    )

    # 2. C1: 1nF 0805 SMD on B.Cu at (9.0, 23.08), rot 0
    add_fp(
        "Capacitor_SMD:C_0805_2012Metric",
        "C1", "1nF", "B.Cu", 9.0, 23.08, 0,
        [
            ("1", "smd", "roundrect", -0.95, 0.0, 1.4, 1.6, 0, "PIEZO_IN"),
            ("2", "smd", "roundrect", 0.95, 0.0, 1.4, 1.6, 0, "NODE_C1_R1"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0805_2012Metric.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.2), val_offset=(0, 2.2)
    )

    # 3. R1: 10k THT Axial P7.62mm on F.Cu at (12.8, 15.46), rot 270
    add_fp(
        "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
        "R1", "10k", "F.Cu", 12.8, 15.46, 270,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.2, 2.2, 0.9, "SUM_NODE"),
            ("2", "thru_hole", "circle", 7.62, 0.0, 2.2, 2.2, 0.9, "NODE_C1_R1"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(3.81, -2.2), val_offset=(3.81, 2.2)
    )

    # 4. D1: BAT54S SOT-23 on B.Cu at (9.0, 15.46), rot 0
    add_fp(
        "Package_TO_SOT_SMD:SOT-23",
        "D1", "BAT54S", "B.Cu", 9.0, 15.46, 0,
        [
            ("1", "smd", "roundrect", -0.9375, 0.95, 1.5, 0.85, 0, "GND"),
            ("2", "smd", "roundrect", -0.9375, -0.95, 1.5, 0.85, 0, "+3V3"),
            ("3", "smd", "roundrect", 0.9375, 0.0, 1.5, 0.85, 0, "SUM_NODE"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Package_TO_SOT_SMD.3dshapes/SOT-23.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.4), val_offset=(0, 2.4)
    )

    # 5. C3: 100nF 1206 Decoupling SMD on B.Cu at (9.0, 9.5), rot 90
    add_fp(
        "Capacitor_SMD:C_1206_3216Metric",
        "C3", "100nF", "B.Cu", 9.0, 9.5, 90,
        [
            ("1", "smd", "roundrect", -1.475, 0.0, 1.5, 1.8, 0, "+3V3"),
            ("2", "smd", "roundrect", 1.475, 0.0, 1.5, 1.8, 0, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_1206_3216Metric.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.5), val_offset=(0, 2.5)
    )

    # 6. C2: 1nF 0805 Feedback Cap on B.Cu at (16.8, 11.5), rot 0
    add_fp(
        "Capacitor_SMD:C_0805_2012Metric",
        "C2", "330pF", "B.Cu", 16.8, 11.5, 0,
        [
            ("1", "smd", "roundrect", -0.95, 0.0, 1.4, 1.6, 0, "SUM_NODE"),
            ("2", "smd", "roundrect", 0.95, 0.0, 1.4, 1.6, 0, "AMP_OUT1"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_0805_2012Metric.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.2), val_offset=(0, 2.2)
    )

    # 7. R4: 4.7M 1206 Feedback Resistor on B.Cu at (16.8, 16.0), rot 0
    add_fp(
        "Resistor_SMD:R_1206_3216Metric",
        "R4", "4.7M", "B.Cu", 16.8, 16.0, 0,
        [
            ("1", "smd", "roundrect", -1.4625, 0.0, 1.5, 1.8, 0, "SUM_NODE"),
            ("2", "smd", "roundrect", 1.4625, 0.0, 1.5, 1.8, 0, "AMP_OUT1"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_1206_3216Metric.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.2), val_offset=(0, 2.2)
    )

    # 8. U1: MCP6002-I/P in DIP-8 Socket on F.Cu at (17.5, 20.54), rot 0
    add_fp(
        "Package_DIP:DIP-8_W7.62mm_Socket",
        "U1", "MCP6002-I/P", "F.Cu", 17.5, 20.54, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.1, 2.1, 0.9, "AMP_OUT1"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 2.1, 2.1, 0.9, "SUM_NODE"),
            ("3", "thru_hole", "circle", 0.0, 5.08, 2.1, 2.1, 0.9, "VREF_1V65"),
            ("4", "thru_hole", "circle", 0.0, 7.62, 2.1, 2.1, 0.9, "GND"),
            ("5", "thru_hole", "circle", 7.62, 7.62, 2.1, 2.1, 0.9, "VREF_1V65"),
            ("6", "thru_hole", "circle", 7.62, 5.08, 2.1, 2.1, 0.9, "U1B_OUT"),
            ("7", "thru_hole", "circle", 7.62, 2.54, 2.1, 2.1, 0.9, "U1B_OUT"),
            ("8", "thru_hole", "circle", 7.62, 0.0, 2.1, 2.1, 0.9, "+3V3"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Package_DIP.3dshapes/DIP-8_W7.62mm_Socket.step", (0,0,0), (0,0,0)),
            ("${KICAD10_3DMODEL_DIR}/Package_DIP.3dshapes/DIP-8_W7.62mm.step", (0,0,2.5), (0,0,0)),
        ],
        ref_offset=(3.81, -4.0), val_offset=(3.81, 9.8)
    )

    # 9. R5: 100R Output Filter Resistor THT P7.62mm on F.Cu at (20.5, 11.5), rot 0
    add_fp(
        "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
        "R5", "100R", "F.Cu", 20.5, 11.5, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.2, 2.2, 0.9, "AMP_OUT1"),
            ("2", "thru_hole", "circle", 7.62, 0.0, 2.2, 2.2, 0.9, "ADC_SIGNAL"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(3.81, -2.2), val_offset=(3.81, 2.2)
    )

    # 10. C4: 100nF 1206 Anti-aliasing Cap on B.Cu at (28.12, 7.2), rot 90
    add_fp(
        "Capacitor_SMD:C_1206_3216Metric",
        "C4", "100nF", "B.Cu", 28.12, 7.2, 90,
        [
            ("1", "smd", "roundrect", -1.475, 0.0, 1.5, 1.8, 0, "ADC_SIGNAL"),
            ("2", "smd", "roundrect", 1.475, 0.0, 1.5, 1.8, 0, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_SMD.3dshapes/C_1206_3216Metric.step", (0,0,0), (0,0,0))],
        ref_offset=(0, -2.8), val_offset=(0, 2.8)
    )

    # 11. R2: 100k VREF High Divider THT P7.62mm on F.Cu at (21.31, 32.5), rot 0
    add_fp(
        "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
        "R2", "100k", "F.Cu", 21.31, 32.5, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.2, 2.2, 0.9, "VREF_1V65"),
            ("2", "thru_hole", "circle", 7.62, 0.0, 2.2, 2.2, 0.9, "+3V3"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(3.81, -2.2), val_offset=(3.81, 2.2)
    )

    # 12. R3: 100k VREF Low Divider THT P7.62mm on F.Cu at (21.31, 37.5), rot 180
    add_fp(
        "Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
        "R3", "100k", "F.Cu", 21.31, 37.5, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.2, 2.2, 0.9, "VREF_1V65"),
            ("2", "thru_hole", "circle", 7.62, 0.0, 2.2, 2.2, 0.9, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Resistor_THT.3dshapes/R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(3.81, -2.2), val_offset=(3.81, 2.2)
    )

    # 13. C5: 10uF Radial Electrolytic Cap on F.Cu at (21.31, 43.0), rot 180
    add_fp(
        "Capacitor_THT:CP_Radial_D5.0mm_P2.50mm",
        "C5", "10uF", "F.Cu", 21.31, 43.0, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.1, 2.1, 0.9, "VREF_1V65"),
            ("2", "thru_hole", "circle", 2.5, 0.0, 2.1, 2.1, 0.9, "GND"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Capacitor_THT.3dshapes/CP_Radial_D5.0mm_P2.50mm.step", (0,0,0), (0,0,0))],
        ref_offset=(1.25, -3.5), val_offset=(1.25, 3.5)
    )

    # 14. U2: ESP32-C3 SuperMini on F.Cu at (48.0, 29.0), rot 180
    add_fp(
        "Module:ESP32-C3_SuperMini",
        "U2", "ESP32-C3_SuperMini", "F.Cu", 48.0, 29.0, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, ""),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, ""),
            ("3", "thru_hole", "circle", 0.0, 5.08, 1.9, 1.9, 0.9, ""),
            ("4", "thru_hole", "circle", 0.0, 7.62, 1.9, 1.9, 0.9, "I2C_SDA"),
            ("5", "thru_hole", "circle", 0.0, 10.16, 1.9, 1.9, 0.9, "I2C_SCL"),
            ("6", "thru_hole", "circle", 0.0, 12.70, 1.9, 1.9, 0.9, ""),
            ("7", "thru_hole", "circle", 0.0, 15.24, 1.9, 1.9, 0.9, "CAN_RX"),
            ("8", "thru_hole", "circle", 0.0, 17.78, 1.9, 1.9, 0.9, "CAN_TX"),
            ("9", "thru_hole", "circle", 15.24, 17.78, 1.9, 1.9, 0.9, ""),
            ("10", "thru_hole", "circle", 15.24, 15.24, 1.9, 1.9, 0.9, ""),
            ("11", "thru_hole", "circle", 15.24, 12.70, 1.9, 1.9, 0.9, "ADC_SIGNAL"),
            ("12", "thru_hole", "circle", 15.24, 10.16, 1.9, 1.9, 0.9, ""),
            ("13", "thru_hole", "circle", 15.24, 7.62, 1.9, 1.9, 0.9, ""),
            ("14", "thru_hole", "circle", 15.24, 5.08, 1.9, 1.9, 0.9, "+3V3"),
            ("15", "thru_hole", "circle", 15.24, 2.54, 1.9, 1.9, 0.9, "GND"),
            ("16", "thru_hole", "circle", 15.24, 0.0, 1.9, 1.9, 0.9, "+5V_BUCK"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x08_P2.54mm_Vertical.step", (0,0,0), (0,0,0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinSocket_2.54mm.3dshapes/PinSocket_1x08_P2.54mm_Vertical.step", (15.24,0,0), (0,0,0)),
            ("${KIPRJMOD}/../3dmodels/ESP32_C3_SuperMini.wrl", (0,0,0), (0,0,0)),
        ],
        ref_offset=(7.62, 8.89), val_offset=(7.62, 12.0)
    )

    # 15. MOD2: SN65HVD230-mini CAN Transceiver (1x06 2.54mm header) on F.Cu at (42.0, 6.5), rot 90
    add_fp(
        "Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical",
        "MOD2", "SN65HVD230_CAN", "F.Cu", 42.0, 6.5, 90,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 1.9, 1.9, 0.9, "+3V3"),
            ("2", "thru_hole", "circle", 0.0, 2.54, 1.9, 1.9, 0.9, "GND"),
            ("3", "thru_hole", "circle", 0.0, 5.08, 1.9, 1.9, 0.9, "CAN_TX"),
            ("4", "thru_hole", "circle", 0.0, 7.62, 1.9, 1.9, 0.9, "CAN_RX"),
            ("5", "thru_hole", "circle", 0.0, 10.16, 1.9, 1.9, 0.9, "CAN_L"),
            ("6", "thru_hole", "circle", 0.0, 12.70, 1.9, 1.9, 0.9, "CAN_H"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x06_P2.54mm_Vertical.step", (0,0,0), (0,0,0)),
            ("${KIPRJMOD}/../3dmodels/SN65HVD230_Module.wrl", (0,0,0), (0,0,0)),
        ],
        ref_offset=(2.2, 6.35), val_offset=(-2.5, 6.35)
    )

    # 16. J3: Right-Angle Side-Entry Waterproof Temp Sensor Connector (JST_XH_S4B-XH-A_1x04_P2.50mm_Horizontal) on F.Cu at (57.2, 26.5), rot 90
    # At rot=90:
    #   Pad 1 (+3V3): (57.2, 26.5)
    #   Pad 2 (GND): (57.2, 24.0)
    #   Pad 3 (I2C_SDA): (57.2, 21.5)
    #   Pad 4 (I2C_SCL): (57.2, 19.0)
    # Horizontal shroud extends from x=57.2 to x=66.51 (protruding past the right PCB edge x=66.0 for epoxy potting!)
    add_fp(
        "Connector_JST:JST_XH_S4B-XH-A_1x04_P2.50mm_Horizontal",
        "J3", "GY-SHT40_SIDE", "F.Cu", 57.2, 26.5, 90,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.2, 1.85, 0.95, "+3V3"),
            ("2", "thru_hole", "oval", 2.5, 0.0, 2.2, 1.85, 0.95, "GND"),
            ("3", "thru_hole", "oval", 5.0, 0.0, 2.2, 1.85, 0.95, "I2C_SDA"),
            ("4", "thru_hole", "oval", 7.5, 0.0, 2.2, 1.85, 0.95, "I2C_SCL"),
        ],
        [("${KICAD10_3DMODEL_DIR}/Connector_JST.3dshapes/JST_XH_S4B-XH-A_1x04_P2.50mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(3.75, -2.8), val_offset=(3.75, 4.5)
    )

    # 17. MOD1: Mini360 DC-DC Buck Converter on F.Cu at (41.47, 44.12), rot 180
    add_fp(
        "Module:Mini360_Buck",
        "MOD1", "Mini360_5V", "F.Cu", 41.47, 44.12, 180,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.3, 2.3, 1.0, "GND"),
            ("2", "thru_hole", "circle", 0.0, 7.62, 2.3, 2.3, 1.0, "+12V_RAW"),
            ("3", "thru_hole", "circle", 13.97, 0.0, 2.3, 2.3, 1.0, "GND"),
            ("4", "thru_hole", "circle", 13.97, 7.62, 2.3, 2.3, 1.0, "+5V_BUCK"),
        ],
        [
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0,0,0), (0,0,0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (0,-7.62,0), (0,0,0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (13.97,0,0), (0,0,0)),
            ("${KICAD10_3DMODEL_DIR}/Connector_PinHeader_2.54mm.3dshapes/PinHeader_1x01_P2.54mm_Vertical.step", (13.97,-7.62,0), (0,0,0)),
            ("${KIPRJMOD}/../3dmodels/Mini360_Buck.wrl", (0,0,0), (0,0,0)),
        ],
        ref_offset=(6.98, 3.81), val_offset=(6.98, 6.0)
    )

    # 18. J2: CAR_12V_CAN (KF301-4P 5.08mm) on F.Cu at (45.5, 43.5), rot 0
    add_fp(
        "TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal",
        "J2", "12V_GND_CAN", "F.Cu", 45.5, 43.5, 0,
        [
            ("1", "thru_hole", "roundrect", 0.0, 0.0, 2.6, 2.6, 1.3, "+12V_RAW"),
            ("2", "thru_hole", "circle", 5.08, 0.0, 2.6, 2.6, 1.3, "GND"),
            ("3", "thru_hole", "circle", 10.16, 0.0, 2.6, 2.6, 1.3, "CAN_L"),
            ("4", "thru_hole", "circle", 15.24, 0.0, 2.6, 2.6, 1.3, "CAN_H"),
        ],
        [("${KICAD10_3DMODEL_DIR}/TerminalBlock_Phoenix.3dshapes/TerminalBlock_Phoenix_MKDS-1,5-4-5.08_1x04_P5.08mm_Horizontal.step", (0,0,0), (0,0,0))],
        ref_offset=(9.5, -3.5), val_offset=(7.62, 5.0)
    )

    def add_path(pts, net_name, width=1.0):
        net_id = (NET_MAP[net_name] + net_offset) if net_name else 0
        for i in range(len(pts) - 1):
            x1, y1 = pts[i]
            x2, y2 = pts[i+1]
            if abs(x1 - x2) < 1e-4 and abs(y1 - y2) < 1e-4:
                continue
            lines.append(f'  (segment (start {x1:.4f} {y1:.4f}) (end {x2:.4f} {y2:.4f}) (width {width:.2f}) (layer "B.Cu") (net {net_id}) (uuid "{uid()}"))')

    def P(ref, pin):
        return pad_coords[(ref, str(pin))]

    def L(x, y):
        return (round(ox + x, 4), round(oy + y, 4))

    # --- ROUTING ON B.Cu (100% single-layer, zero crossings, no ground fill) ---
    add_path([P("J1",1), P("C1",1)], "PIEZO_IN", 1.2)
    add_path([P("C1",2), P("R1",2)], "NODE_C1_R1", 1.0)

    add_path([P("D1",3), P("R1",1)], "SUM_NODE", 1.0)
    add_path([P("R1",1), L(15.3375, 15.46), P("R4",1)], "SUM_NODE", 1.0)
    add_path([P("R4",1), L(15.3375, 23.08), P("U1",2)], "SUM_NODE", 1.0)
    add_path([L(15.3375, 15.46), L(15.3375, 11.5), P("C2",1)], "SUM_NODE", 1.0)

    add_path([P("U1",1), L(18.2625, 20.54), P("R4",2)], "AMP_OUT1", 1.0)
    add_path([P("R4",2), L(18.2625, 11.5), P("C2",2)], "AMP_OUT1", 1.0)
    add_path([L(18.2625, 11.5), P("R5",1)], "AMP_OUT1", 1.0)

    add_path([P("R5",2), P("C4",1)], "ADC_SIGNAL", 1.0)
    add_path([P("R5",2), L(28.12, 16.30), P("U2",11)], "ADC_SIGNAL", 1.0)

    add_path([P("U1",6), P("U1",7)], "U1B_OUT", 1.0)

    add_path([P("U1",3), L(21.31, 25.62), L(21.31, 28.16), P("U1",5)], "VREF_1V65", 1.0)
    add_path([L(21.31, 28.16), P("R2",1), P("R3",1), P("C5",1)], "VREF_1V65", 1.0)

    add_path([P("U1",8), L(25.12, 5.5), L(12.0, 5.5), L(12.0, 10.975), P("C3",1)], "+3V3", 1.0)
    add_path([P("C3",1), L(8.0625, 10.975), P("D1",2)], "+3V3", 0.9)
    add_path([P("U1",8), L(28.93, 20.54), L(28.93, 23.92), P("U2",14)], "+3V3", 1.1)
    add_path([L(28.93, 23.92), P("R2",2)], "+3V3", 1.1)
    add_path([P("U2",14), L(41.5, 23.92), L(41.5, 6.5), P("MOD2",1)], "+3V3", 1.1)
    add_path([L(41.5, 23.92), L(41.5, 31.5), L(57.2, 31.5), P("J3",1)], "+3V3", 1.1)

    add_path([P("MOD1",4), L(32.76, 36.50), P("U2",16)], "+5V_BUCK", 1.2)
    add_path([P("J2",1), L(45.50, 36.50), P("MOD1",2)], "+12V_RAW", 1.4)

    add_path([P("MOD2",3), L(47.08, 11.22), P("U2",8)], "CAN_TX", 0.9)
    add_path([P("MOD2",4), L(50.5, 6.5), L(50.5, 13.76), P("U2",7)], "CAN_RX", 0.9)

    add_path([P("U2",4), L(54.5, 21.38), L(54.5, 21.5), P("J3",3)], "I2C_SDA", 0.9)
    add_path([P("U2",5), L(54.5, 18.84), L(54.5, 19.0), P("J3",4)], "I2C_SCL", 0.9)

    add_path([P("MOD2",5), L(52.16, 9.0), L(61.2, 9.0), L(61.2, 38.5), L(55.66, 38.5), P("J2",3)], "CAN_L", 1.0)
    add_path([P("MOD2",6), L(62.9, 6.5), L(62.9, 40.5), L(60.74, 40.5), P("J2",4)], "CAN_H", 1.0)

    add_path([L(4.5, 2.5), L(4.5, 8.025), P("C3",2)], "GND", 1.2)
    add_path([L(4.5, 8.025), L(4.5, 16.41), P("D1",1)], "GND", 1.2)
    add_path([L(4.5, 16.41), L(1.8, 16.41), L(1.8, 28.16), P("J1",2)], "GND", 1.2)
    add_path([P("J1",2), L(13.69, 28.16), P("U1",4)], "GND", 1.2)
    add_path([L(13.69, 28.16), P("R3",2)], "GND", 1.2)
    add_path([P("R3",2), L(13.69, 43.0), P("C5",2)], "GND", 1.2)
    add_path([P("C5",2), L(18.81, 47.5), L(27.50, 47.5), P("MOD1",3)], "GND", 1.2)
    add_path([L(4.5, 2.5), L(28.12, 2.5), P("C4",2)], "GND", 1.2)
    add_path([L(28.12, 2.5), L(44.54, 2.5), P("MOD2",2)], "GND", 1.2)
    add_path([L(44.54, 2.5), L(64.5, 2.5), L(64.5, 47.5), L(50.58, 47.5), P("J2",2)], "GND", 1.2)
    add_path([P("J2",2), L(50.58, 35.0), L(59.4, 35.0), L(59.4, 24.0), P("J3",2)], "GND", 1.1)
    add_path([L(50.58, 47.5), L(41.47, 47.5), P("MOD1",1)], "GND", 1.4)
    add_path([L(41.47, 47.5), L(27.50, 47.5)], "GND", 1.4)
    add_path([P("MOD1",1), L(36.5, 44.12), L(36.5, 26.46), P("U2",15)], "GND", 1.2)

    return lines

def pcb_header():
    h = [
        '(kicad_pcb',
        '  (version 20240108)',
        '  (generator "pcbnew")',
        '  (generator_version "10.0")',
        '  (general (thickness 1.6) (legacy_teardrops no))',
        '  (paper "A4" portrait)',
        '  (layers',
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
        '  )',
        '  (setup (pad_to_mask_clearance 0.15))',
    ]
    for nid, nname in NETS:
        h.append(f'  (net {nid} "{nname}")')
    return h

# 1. Write Single Board PCB
single_pcb_path = os.path.join(OUT_DIR, "Wheel_Sensor_Amplifier.kicad_pcb")
with open(single_pcb_path, "w") as f:
    f.write("\n".join(pcb_header() + make_board_elements(72.0, 123.5) + [")"]) + "\n")

# 2. Write 15-Board (3x5) A4 Portrait Panel PCB (210 x 297 mm)
# 3 cols * 66.0 = 198.0 mm + 2 * 2.0 mm gaps = 202.0 mm -> x0 = 4.0 mm
# 5 rows * 50.0 = 250.0 mm + 4 * 4.0 mm gaps = 266.0 mm -> y0 = 15.5 mm
panel_pcb_path = os.path.join(OUT_DIR, "Wheel_Sensor_Amplifier_Panel_A4.kicad_pcb")
panel_hdr = pcb_header()[:-18] + ['  (net 0 "")']
panel_body = []
for row in range(5):
    for col in range(3):
        idx = row * 3 + col + 1
        noff = (idx - 1) * 17
        for nid, nname in NETS[1:]:
            panel_hdr.append(f'  (net {nid + noff} "{nname}_{idx}")')
        bx = 4.0 + col * (BW + 2.0)
        by = 15.5 + row * (BH + 4.0)
        panel_body.extend(make_board_elements(bx, by, ref_suffix=f"_{idx}", net_offset=noff, net_suffix=f"_{idx}"))

with open(panel_pcb_path, "w") as f:
    f.write("\n".join(panel_hdr + panel_body + [")"]) + "\n")

# 3. Write KiCad Project (.kicad_pro) only if not already present
pro_path = os.path.join(OUT_DIR, "Wheel_Sensor_Amplifier.kicad_pro")
if not os.path.exists(pro_path):
    pro_data = {
        "board": {"design_settings": {"defaults": {"board_outline_line_width": 0.2}}},
        "meta": {"filename": "Wheel_Sensor_Amplifier.kicad_pro", "version": 1},
        "schematic": {"drawing": {"default_line_thickness": 6.0}}
    }
    with open(pro_path, "w") as f:
        json.dump(pro_data, f, indent=2)

# 4. Write KiCad Schematic (.kicad_sch) with complete BOM & netlist documentation
sch_content = f"""(kicad_sch
  (version 20231120)
  (generator "eeschema")
  (generator_version "10.0")
  (uuid "{uid()}")
  (paper "A4")
  (title_block
    (title "Wheel Piezo Charge Amplifier + ESP32-C3 + CAN + GY-SHT40 Waterproof Temp Sensor")
    (date "2026-11-07")
    (rev "3.0-LUT-1Layer")
    (company "Wheel Telemetry Module")
  )
  (lib_symbols)
  (text "COMPLETE SINGLE-LAYER (B.Cu) WHEEL TELEMETRY MODULE\\n\\nTOP SIDE (F.Cu - THT & Modules):\\n- U2: ESP32-C3 SuperMini (Pin 16=5V, Pin 15=GND, Pin 14=3V3, Pin 11=GPIO2/ADC, Pin 8=GPIO21/CAN_TX, Pin 7=GPIO20/CAN_RX, Pin 5=GPIO9/SCL, Pin 4=GPIO8/SDA)\\n- U1: MCP6002-I/P Dual Rail-to-Rail Op-Amp in DIP-8 Socket\\n- MOD1: Mini360 DC-DC Buck Converter (12V -> 5.0V)\\n- MOD2: SN65HVD230 CAN Bus Transceiver Module (3.3V)\\n- J1: KF301-2P (5.08mm) Piezo Sensor Input (Pin 1=PIEZO+, Pin 2=GND)\\n- J2: KF301-4P (5.08mm) Vehicle Bus (Pin 1=+12V, Pin 2=GND, Pin 3=CAN_L, Pin 4=CAN_H)\\n- J3: JST-XH 4P (B4B-XH-A) Waterproof Temp Sensor GY-SHT40 (Pin 1=3V3, Pin 2=GND, Pin 3=SDA, Pin 4=SCL)\\n- R1: 10k THT | R2: 100k THT | R3: 100k THT | R5: 100R THT | C5: 10uF Electrolytic THT\\n\\nBOTTOM SIDE (B.Cu - SMD on Copper Layer):\\n- D1: BAT54S (SOT-23) Dual Series Schottky Clamp Diode\\n- C1: 1nF (0805) Input Coupling Capacitor\\n- C2: 330pF NP0 (0805) Feedback Capacitor, gain K=3\\n- R4: 4.7M (1206) Charge Integrator Bleed Resistor\\n- C3: 100nF (1206) Op-Amp VDD Decoupling Capacitor\\n- C4: 100nF (1206) ADC Anti-Aliasing Low-Pass Filter Capacitor"
    (exclude_from_sim no)
    (at 25.4 45.0 0)
    (effects (font (size 2.2 2.2) (thickness 0.3)) (justify left top))
    (uuid "{uid()}")
  )
)
"""
with open(os.path.join(OUT_DIR, "Wheel_Sensor_Amplifier.kicad_sch"), "w") as f:
    f.write(sch_content)

print("Generated Single PCB, 15x A4 Panel PCB, Schematic, and Project successfully.")
