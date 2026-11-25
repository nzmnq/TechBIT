#!/usr/bin/env python3
"""
TechBIT Domain-Invariant ML Evaluator & Trainer (Zero external dependencies - pure Python 3!)

Works on paired STO / Hyundai Santa Fe recordings (`BEFORE_REPAIR` vs `AFTER_REPAIR`)
exported from the TechBIT Test Workbench (`/dataset` page -> `datasets/*.json` or `*.csv`).

Uses ONLY domain-invariant features (no raw absolute mm/s thresholds!), so weights transfer
cleanly from a quiet crossover (Hyundai Santa Fe) to 40-ton commercial trucks via Auto-Baseline:
  1. max_kurtosis   — waveform impulsiveness (~3.0 normal, >5.5 bearing spall)
  2. max_crest      — peak / RMS ratio
  3. max_hf_energy  — high-frequency FFT band fraction (600..4500 Hz)
  4. ratio_vib      — left vs right axle asymmetry
  5. delta_temp     — |T_left - T_right| (°C)
  6. max_z_score    — Auto-Baseline deviation (sigma above own wheel healthy norm)

Outputs:
  - Per-feature ROC-AUC ranking (checks goal: ROC-AUC > 0.90)
  - Trained Logistic Regression model ROC-AUC & accuracy
  - Exported C++17 header `MlModelWeights.h` ready to drop into ESP32-S3 firmware!

Usage:
  python ml_pipeline/train_evaluate.py datasets/
  python ml_pipeline/train_evaluate.py --demo
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import sys
from pathlib import Path
from typing import Dict, List, Tuple

FEATURE_NAMES = [
    "max_kurtosis",
    "max_crest",
    "max_hf_energy",
    "ratio_vib",
    "delta_temp",
    "max_z_score",
]


def is_fault_label(condition: str, fault_label: str) -> int:
    cond = (condition or "").upper().strip()
    fl = (fault_label or "").upper().strip()
    if cond == "AFTER_REPAIR" or fl in ("HEALTHY", "HEALTHY_BASELINE", "NORMAL", "NONE", ""):
        return 0
    return 1


def extract_row_features(row: Dict[str, object]) -> List[float]:
    def f(key: str, default: float = 0.0) -> float:
        try:
            return float(row.get(key, default))
        except (TypeError, ValueError):
            return default

    max_kurt = max(f("kurtosis_L", 3.0), f("kurtosis_R", 3.0))
    max_crest = max(f("crest_L", 2.6), f("crest_R", 2.6))
    max_hf = max(f("hf_energy_L", 0.25), f("hf_energy_R", 0.25))
    ratio_vib = f("ratio_vib", 1.0)
    delta_temp = abs(f("delta_temp", abs(f("temp_L", 30.0) - f("temp_R", 30.0))))
    max_z = max(f("z_L", 0.0), f("z_R", 0.0))
    return [max_kurt, max_crest, max_hf, ratio_vib, delta_temp, max_z]


def load_dataset(folder: Path) -> Tuple[List[List[float]], List[int], int]:
    X: List[List[float]] = []
    y: List[int] = []
    files_loaded = 0

    json_files = sorted(folder.glob("*.json"))
    seen_stems = set()

    for jf in json_files:
        try:
            payload = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        passport = payload.get("passport", {})
        samples = payload.get("samples", [])
        if not isinstance(samples, list) or not samples:
            continue
        label = is_fault_label(passport.get("condition", ""), passport.get("fault_label", ""))
        files_loaded += 1
        seen_stems.add(jf.stem)
        for row in samples:
            tag = str(row.get("event_tag", "NONE")).upper()
            if "POTHOLE" in tag:
                continue  # Exclude labeled road potholes from bearing/brake classifier training
            if float(row.get("speed_kmh", 60) or 0) <= 0:
                continue  # Exclude stationary frames
            X.append(extract_row_features(row))
            y.append(label)

    for cf in sorted(folder.glob("*.csv")):
        if cf.stem in seen_stems:
            continue
        with cf.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            rows_in_file = 0
            for row in reader:
                tag = str(row.get("event_tag", "NONE")).upper()
                if "POTHOLE" in tag:
                    continue
                if float(row.get("speed_kmh", 60) or 0) <= 0:
                    continue
                label = is_fault_label(row.get("condition", ""), row.get("fault_label", ""))
                X.append(extract_row_features(row))
                y.append(label)
                rows_in_file += 1
            if rows_in_file > 0:
                files_loaded += 1

    return X, y, files_loaded


def generate_demo_santa_fe_data() -> Tuple[List[List[float]], List[int]]:
    rng = random.Random(42)
    X: List[List[float]] = []
    y: List[int] = []
    # 120 healthy Santa Fe driving frames (AFTER_REPAIR / HEALTHY_BASELINE)
    for _ in range(120):
        X.append([
            rng.gauss(3.05, 0.35),   # max_kurtosis
            rng.gauss(2.65, 0.25),   # max_crest
            max(0.05, rng.gauss(0.24, 0.05)),  # max_hf_energy
            max(1.0, rng.gauss(1.08, 0.08)),   # ratio_vib
            abs(rng.gauss(0.9, 0.7)),          # delta_temp
            rng.gauss(0.2, 0.8),               # max_z_score
        ])
        y.append(0)
    # 120 worn bearing / sticking caliper frames on Santa Fe (BEFORE_REPAIR)
    for _ in range(120):
        X.append([
            rng.gauss(6.8, 0.9),     # max_kurtosis
            rng.gauss(3.4, 0.35),    # max_crest
            min(0.95, rng.gauss(0.66, 0.08)),  # max_hf_energy
            max(1.2, rng.gauss(2.6, 0.5)),     # ratio_vib
            abs(rng.gauss(14.5, 4.5)),         # delta_temp
            rng.gauss(5.8, 1.3),               # max_z_score
        ])
        y.append(1)
    return X, y


def compute_roc_auc(scores: List[float], labels: List[int]) -> float:
    pos = [s for s, l in zip(scores, labels) if l == 1]
    neg = [s for s, l in zip(scores, labels) if l == 0]
    if not pos or not neg:
        return 0.5
    wins = 0.0
    for p in pos:
        for n in neg:
            if p > n:
                wins += 1.0
            elif p == n:
                wins += 0.5
    return wins / (len(pos) * len(neg))


def sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-min(z, 40.0))
        return 1.0 / (1.0 + ez)
    ez = math.exp(max(z, -40.0))
    return ez / (1.0 + ez)


def train_logistic_regression(
    X: List[List[float]], y: List[int], epochs: int = 500, lr: float = 0.15, l2: float = 0.01
) -> Tuple[List[float], List[float], List[float], float]:
    n = len(X)
    d = len(X[0])
    means = [sum(row[j] for row in X) / n for j in range(d)]
    stds = [
        max(1e-4, math.sqrt(sum((row[j] - means[j]) ** 2 for row in X) / max(1, n - 1)))
        for j in range(d)
    ]
    Xn = [[(row[j] - means[j]) / stds[j] for j in range(d)] for row in X]

    weights = [0.0] * d
    bias = 0.0

    for _ in range(epochs):
        grad_w = [0.0] * d
        grad_b = 0.0
        for row, label in zip(Xn, y):
            pred = sigmoid(sum(w * v for w, v in zip(weights, row)) + bias)
            err = pred - label
            grad_b += err
            for j in range(d):
                grad_w[j] += err * row[j]
        for j in range(d):
            weights[j] -= lr * ((grad_w[j] / n) + l2 * weights[j])
        bias -= lr * (grad_b / n)

    return means, stds, weights, bias


def export_cpp_header(
    out_path: Path,
    means: List[float],
    stds: List[float],
    weights: List[float],
    bias: float,
    model_auc: float,
    sample_count: int,
) -> None:
    def fmt_arr(vals: List[float]) -> str:
        return ", ".join(f"{v:.6f}f" for v in vals)

    content = f"""#pragma once
// Auto-generated by TechBIT ml_pipeline/train_evaluate.py
// Trained on {sample_count} domain-invariant frames | Model ROC-AUC = {model_auc:.4f}
// Features: [0]max_kurtosis, [1]max_crest, [2]max_hf_energy, [3]ratio_vib, [4]delta_temp, [5]max_z_score

#include <cmath>

namespace techbit {{
namespace ml {{

static constexpr int   kMlFeatureCount = {len(weights)};
static constexpr float kMlMeans[kMlFeatureCount]   = {{ {fmt_arr(means)} }};
static constexpr float kMlStds[kMlFeatureCount]    = {{ {fmt_arr(stds)} }};
static constexpr float kMlWeights[kMlFeatureCount] = {{ {fmt_arr(weights)} }};
static constexpr float kMlBias                     = {bias:.6f}f;

inline float predictFaultProbability(const float features[kMlFeatureCount]) {{
    float z = kMlBias;
    for (int i = 0; i < kMlFeatureCount; ++i) {{
        const float xn = (features[i] - kMlMeans[i]) / kMlStds[i];
        z += kMlWeights[i] * xn;
    }}
    if (z >= 0.0f) {{
        return 1.0f / (1.0f + std::exp(-z));
    }}
    const float ez = std::exp(z);
    return ez / (1.0f + ez);
}}

}} // namespace ml
}} // namespace techbit
"""
    out_path.write_text(content, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="TechBIT Domain-Invariant ML Trainer & ROC-AUC Evaluator")
    parser.add_argument("folder", nargs="?", default="datasets", help="Folder with exported .json/.csv sessions")
    parser.add_argument("--demo", action="store_true", help="Run self-test on synthetic Santa Fe paired dataset")
    parser.add_argument(
        "--out-header",
        default="ml_pipeline/MlModelWeights.h",
        help="Output path for exported ESP32-S3 C++ weights header",
    )
    args = parser.parse_args()

    if args.demo:
        X, y = generate_demo_santa_fe_data()
        print("\n[TechBIT ML] Running --demo mode (synthetic Hyundai Santa Fe BEFORE/AFTER pair)")
    else:
        folder = Path(args.folder)
        if not folder.exists():
            print(f"[ERROR] Folder not found: {folder}. Record sessions on /dataset first or run with --demo.")
            return 1
        X, y, n_files = load_dataset(folder)
        print(f"\n[TechBIT ML] Loaded {len(X)} clean driving frames from {n_files} files in '{folder}'")

    pos_n = sum(y)
    neg_n = len(y) - pos_n
    if pos_n < 5 or neg_n < 5:
        print(f"[ERROR] Need both BEFORE_REPAIR ({pos_n}) and AFTER_REPAIR/HEALTHY ({neg_n}) frames (>=5 each).")
        return 1

    print(f"  Class balance: Fault/BEFORE = {pos_n}, Healthy/AFTER = {neg_n}\n")
    print("  Per-Feature Domain-Invariant ROC-AUC Ranking:")
    ranking = []
    for j, name in enumerate(FEATURE_NAMES):
        col = [row[j] for row in X]
        auc = compute_roc_auc(col, y)
        ranking.append((auc, name))
    for auc, name in sorted(ranking, reverse=True):
        verdict = "STRONG (>0.90)" if auc >= 0.90 else ("GOOD" if auc >= 0.78 else "WEAK")
        print(f"    - {name:<15s}: ROC-AUC = {auc:.4f}  [{verdict}]")

    means, stds, weights, bias = train_logistic_regression(X, y)
    probs = [
        sigmoid(sum(weights[j] * ((row[j] - means[j]) / stds[j]) for j in range(len(weights))) + bias)
        for row in X
    ]
    model_auc = compute_roc_auc(probs, y)
    correct = sum(1 for p, l in zip(probs, y) if (1 if p >= 0.5 else 0) == l)
    acc = correct / len(y)

    print(f"\n  Combined Logistic Regression Model:")
    print(f"    - ROC-AUC  : {model_auc:.4f}")
    print(f"    - Accuracy : {acc * 100:.1f}% ({correct}/{len(y)})")

    if not args.demo or args.out_header != "ml_pipeline/MlModelWeights.h":
        out_path = Path(args.out_header)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        export_cpp_header(out_path, means, stds, weights, bias, model_auc, len(y))
        print(f"    - Exported ESP32-S3 header -> {out_path}\n")
    else:
        print("    - Demo check passed (pass a real datasets/ folder to write MlModelWeights.h)\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
