#!/usr/bin/env python3
"""
TechBIT Wheel Diagnostics — TinyML Classifier Trainer (NumPy MLP)
==================================================================
Trains a compact 3-layer Multi-Layer Perceptron (10 -> 16 -> 12 -> 4)
to classify wheel telemetry frames into:
  0: NORMAL          (Smooth road, healthy wheel)
  1: BAD_ROAD        (Rough road / cobblestones affecting all wheels)
  2: POTHOLE_IMPACT  (Sharp transient impact: pothole, speed bump, bridge joint)
  3: ANOMALY_FAULT   (Bearing wear or sticking brake pad/caliper on specific wheel)

Exports standardized scaler + weights directly to:
  ../lib/TechBitML/ml_model_weights.h

Usage:
  python train_classifier.py                # Train on physics-derived dataset
  python train_classifier.py --csv log.csv  # Train/fine-tune on recorded road CSV
"""

import argparse
import os
import sys
import numpy as np


FEATURE_NAMES = [
    "log_norm_rms",       # log1p(rms_mv / baseline_rms_mv)
    "peer_ratio",         # rms_mv / median(all_active_wheels_rms)
    "axle_ratio",         # rms_mv / opposite_wheel_on_same_axle_rms
    "crest_factor",       # peak_mv / rms_mv
    "kurtosis",           # waveform kurtosis (approx 3 = gaussian, >6 = impact)
    "band_low_ratio",     # 80..600 Hz spectral energy ratio
    "band_mid_ratio",     # 600..2500 Hz spectral energy ratio
    "band_high_ratio",    # 2500..8000 Hz spectral energy ratio
    "centroid_norm",      # spectral_centroid_hz / 5000.0
    "tonality_ratio",     # max_bin_mag / mean_bin_mag (narrowband peak concentration)
]

CLASS_NAMES = [
    "NORMAL",
    "BAD_ROAD",
    "POTHOLE_IMPACT",
    "ANOMALY_FAULT",
]


def generate_physics_dataset(samples_per_class: int = 1200, seed: int = 42):
    """Generates realistic multi-feature distributions matching the MCP6002 + piezo AFE."""
    rng = np.random.default_rng(seed)
    X_list = []
    y_list = []

    # 0: NORMAL — calm driving, slight speed/tire/sensor variation
    n = samples_per_class
    norm_rms = rng.uniform(0.45, 1.75, n)
    log_norm_rms = np.log1p(norm_rms)
    peer_ratio = rng.normal(1.0, 0.16, n).clip(0.55, 1.50)
    axle_ratio = rng.normal(1.0, 0.17, n).clip(0.55, 1.55)
    crest = rng.normal(2.65, 0.50, n).clip(1.4, 4.1)
    kurtosis = rng.normal(3.05, 0.60, n).clip(1.6, 4.9)
    b_low = rng.uniform(0.36, 0.74, n)
    b_mid = rng.uniform(0.18, 0.45, n)
    b_high = rng.uniform(0.03, 0.25, n)
    b_sum = b_low + b_mid + b_high
    b_low, b_mid, b_high = b_low / b_sum, b_mid / b_sum, b_high / b_sum
    centroid = (b_low * 320 + b_mid * 1350 + b_high * 3800 + rng.normal(0, 180, n)).clip(180, 2500) / 5000.0
    tonality = rng.uniform(1.7, 4.6, n)
    X_list.append(np.column_stack([
        log_norm_rms, peer_ratio, axle_ratio, crest, kurtosis,
        b_low, b_mid, b_high, centroid, tonality
    ]))
    y_list.append(np.full(n, 0))

    # 1: BAD_ROAD — cobblestone, gravel, washboard road + axle transition onto cobblestone
    # Sub-case 1a (70%): All wheels elevated together (with realistic +-35% uneven wheel spread)
    n_all_bad = int(n * 0.70)
    n_axle_tr = n - n_all_bad

    norm_rms_1a = rng.uniform(1.65, 8.0, n_all_bad)
    peer_1a = rng.normal(1.02, 0.24, n_all_bad).clip(0.55, 1.65)
    axle_1a = rng.normal(1.02, 0.24, n_all_bad).clip(0.55, 1.65)
    crest_1a = rng.normal(3.2, 0.55, n_all_bad).clip(1.8, 4.5)
    kurt_1a = rng.normal(3.7, 0.80, n_all_bad).clip(2.0, 5.6)
    bl_1a = rng.uniform(0.45, 0.82, n_all_bad)
    bm_1a = rng.uniform(0.14, 0.42, n_all_bad)
    bh_1a = rng.uniform(0.03, 0.22, n_all_bad)
    bs_1a = bl_1a + bm_1a + bh_1a
    bl_1a, bm_1a, bh_1a = bl_1a / bs_1a, bm_1a / bs_1a, bh_1a / bs_1a
    cent_1a = (bl_1a * 340 + bm_1a * 1250 + bh_1a * 3400 + rng.normal(0, 200, n_all_bad)).clip(220, 2600) / 5000.0
    ton_1a = rng.uniform(1.8, 4.9, n_all_bad)

    # Sub-case 1b (30%): Front axle hits cobblestone/speed bump before rear axle (high peer_ratio, ~1.0 axle_ratio)
    norm_rms_1b = rng.uniform(2.0, 7.5, n_axle_tr)
    peer_1b = rng.uniform(1.55, 4.8, n_axle_tr)
    axle_1b = rng.normal(1.0, 0.18, n_axle_tr).clip(0.65, 1.48)
    crest_1b = rng.normal(3.3, 0.50, n_axle_tr).clip(2.0, 4.5)
    kurt_1b = rng.normal(3.8, 0.75, n_axle_tr).clip(2.2, 5.5)
    bl_1b = rng.uniform(0.46, 0.84, n_axle_tr)
    bm_1b = rng.uniform(0.12, 0.40, n_axle_tr)
    bh_1b = rng.uniform(0.02, 0.20, n_axle_tr)
    bs_1b = bl_1b + bm_1b + bh_1b
    bl_1b, bm_1b, bh_1b = bl_1b / bs_1b, bm_1b / bs_1b, bh_1b / bs_1b
    cent_1b = (bl_1b * 320 + bm_1b * 1150 + bh_1b * 3100 + rng.normal(0, 180, n_axle_tr)).clip(200, 2200) / 5000.0
    ton_1b = rng.uniform(1.8, 4.6, n_axle_tr)

    X_bad = np.vstack([
        np.column_stack([
            np.log1p(norm_rms_1a), peer_1a, axle_1a, crest_1a, kurt_1a,
            bl_1a, bm_1a, bh_1a, cent_1a, ton_1a
        ]),
        np.column_stack([
            np.log1p(norm_rms_1b), peer_1b, axle_1b, crest_1b, kurt_1b,
            bl_1b, bm_1b, bh_1b, cent_1b, ton_1b
        ]),
    ])
    X_list.append(X_bad)
    y_list.append(np.full(n, 1))

    # 2: POTHOLE_IMPACT — sharp transient shock (high crest factor and/or high kurtosis)
    # Includes single-wheel strike and diode-clipped transient impulse
    norm_rms = rng.uniform(2.0, 9.5, n)
    log_norm_rms = np.log1p(norm_rms)
    peer_ratio = rng.uniform(0.85, 5.5, n)
    axle_ratio = rng.uniform(0.85, 5.5, n)
    crest = rng.uniform(3.9, 9.5, n)
    kurtosis = rng.uniform(5.2, 15.0, n)
    b_low = rng.uniform(0.32, 0.74, n)
    b_mid = rng.uniform(0.18, 0.48, n)
    b_high = rng.uniform(0.04, 0.28, n)
    b_sum = b_low + b_mid + b_high
    b_low, b_mid, b_high = b_low / b_sum, b_mid / b_sum, b_high / b_sum
    centroid = rng.uniform(420, 2600, n) / 5000.0
    tonality = rng.uniform(1.9, 5.6, n)
    X_list.append(np.column_stack([
        log_norm_rms, peer_ratio, axle_ratio, crest, kurtosis,
        b_low, b_mid, b_high, centroid, tonality
    ]))
    y_list.append(np.full(n, 2))

    # 3: ANOMALY_FAULT — hub bearing defect OR sticking brake pad (including on rough road!)
    n_bearing = n // 2
    n_brake = n - n_bearing

    # 3a: Hub Bearing Defect (sustained tonal harmonics 700..3000 Hz, localized to 1 wheel)
    norm_rms_b = rng.uniform(1.7, 7.0, n_bearing)
    peer_b = rng.uniform(1.52, 5.5, n_bearing)
    axle_b = rng.uniform(1.48, 5.5, n_bearing)
    crest_b = rng.normal(2.75, 0.48, n_bearing).clip(1.5, 4.1)
    kurt_b = rng.normal(3.45, 0.70, n_bearing).clip(1.8, 5.4)
    bl_b = rng.uniform(0.08, 0.34, n_bearing)
    bm_b = rng.uniform(0.40, 0.72, n_bearing)
    bh_b = rng.uniform(0.10, 0.40, n_bearing)
    bs_b = bl_b + bm_b + bh_b
    bl_b, bm_b, bh_b = bl_b / bs_b, bm_b / bs_b, bh_b / bs_b
    cent_b = rng.uniform(1350, 3800, n_bearing) / 5000.0
    ton_b = rng.uniform(4.8, 14.0, n_bearing)

    # 3b: Sticking Brake Pad / Caliper Chatter (2500..8000 Hz high-freq energy + high differential)
    norm_rms_k = rng.uniform(1.85, 8.5, n_brake)
    peer_k = rng.uniform(1.55, 6.5, n_brake)
    axle_k = rng.uniform(1.50, 6.5, n_brake)
    crest_k = rng.normal(2.95, 0.52, n_brake).clip(1.5, 4.2)
    kurt_k = rng.normal(3.35, 0.65, n_brake).clip(1.8, 5.2)
    bl_k = rng.uniform(0.05, 0.25, n_brake)
    bm_k = rng.uniform(0.16, 0.42, n_brake)
    bh_k = rng.uniform(0.42, 0.78, n_brake)
    bs_k = bl_k + bm_k + bh_k
    bl_k, bm_k, bh_k = bl_k / bs_k, bm_k / bs_k, bh_k / bs_k
    cent_k = rng.uniform(2400, 5800, n_brake) / 5000.0
    ton_k = rng.uniform(4.3, 13.5, n_brake)

    X_fault = np.vstack([
        np.column_stack([
            np.log1p(norm_rms_b), peer_b, axle_b, crest_b, kurt_b,
            bl_b, bm_b, bh_b, cent_b, ton_b
        ]),
        np.column_stack([
            np.log1p(norm_rms_k), peer_k, axle_k, crest_k, kurt_k,
            bl_k, bm_k, bh_k, cent_k, ton_k
        ])
    ])
    X_list.append(X_fault)
    y_list.append(np.full(n, 3))

    X = np.vstack(X_list).astype(np.float32)
    y = np.concatenate(y_list).astype(np.int64)

    perm = rng.permutation(len(y))
    return X[perm], y[perm]


def load_csv_dataset(csv_path: str):
    """Loads logged telemetry CSV: 10 features followed by integer label (0..3)."""
    data = np.loadtxt(csv_path, delimiter=",", skiprows=1, dtype=np.float32)
    X = data[:, :10]
    y = data[:, 10].astype(np.int64)
    return X, y


class NumpyMLP:
    """Compact 3-layer MLP (10 -> 16 -> 12 -> 4) trained with Adam + L2 regularization."""

    def __init__(self, in_dim=10, h1=16, h2=12, out_dim=4, seed=123):
        rng = np.random.default_rng(seed)
        self.W1 = (rng.normal(0, np.sqrt(2.0 / in_dim), (in_dim, h1))).astype(np.float32)
        self.b1 = np.zeros(h1, dtype=np.float32)
        self.W2 = (rng.normal(0, np.sqrt(2.0 / h1), (h1, h2))).astype(np.float32)
        self.b2 = np.zeros(h2, dtype=np.float32)
        self.W3 = (rng.normal(0, np.sqrt(2.0 / h2), (h2, out_dim))).astype(np.float32)
        self.b3 = np.zeros(out_dim, dtype=np.float32)

    @staticmethod
    def relu(x):
        return np.maximum(0.0, x)

    @staticmethod
    def softmax(logits):
        shifted = logits - np.max(logits, axis=1, keepdims=True)
        exps = np.exp(shifted)
        return exps / np.sum(exps, axis=1, keepdims=True)

    def forward(self, X):
        z1 = X @ self.W1 + self.b1
        a1 = self.relu(z1)
        z2 = a1 @ self.W2 + self.b2
        a2 = self.relu(z2)
        logits = a2 @ self.W3 + self.b3
        probs = self.softmax(logits)
        return probs, (X, z1, a1, z2, a2)

    def fit(self, X, y, epochs=180, batch_size=64, lr=0.008, l2=1e-4):
        params = [self.W1, self.b1, self.W2, self.b2, self.W3, self.b3]
        m = [np.zeros_like(p) for p in params]
        v = [np.zeros_like(p) for p in params]
        beta1, beta2, eps = 0.9, 0.999, 1e-8
        step = 0
        rng = np.random.default_rng(7)
        N = X.shape[0]

        for epoch in range(epochs):
            perm = rng.permutation(N)
            for start in range(0, N, batch_size):
                idx = perm[start:start + batch_size]
                xb, yb = X[idx], y[idx]
                bs = len(yb)

                probs, (X_in, z1, a1, z2, a2) = self.forward(xb)
                dlogits = probs.copy()
                dlogits[np.arange(bs), yb] -= 1.0
                dlogits /= bs

                dW3 = a2.T @ dlogits + l2 * self.W3
                db3 = np.sum(dlogits, axis=0)

                da2 = dlogits @ self.W3.T
                dz2 = da2 * (z2 > 0)
                dW2 = a1.T @ dz2 + l2 * self.W2
                db2 = np.sum(dz2, axis=0)

                da1 = dz2 @ self.W2.T
                dz1 = da1 * (z1 > 0)
                dW1 = X_in.T @ dz1 + l2 * self.W1
                db1 = np.sum(dz1, axis=0)

                grads = [dW1, db1, dW2, db2, dW3, db3]
                step += 1
                for i, (p, g) in enumerate(zip(params, grads)):
                    m[i] = beta1 * m[i] + (1 - beta1) * g
                    v[i] = beta2 * v[i] + (1 - beta2) * (g * g)
                    m_hat = m[i] / (1 - beta1 ** step)
                    v_hat = v[i] / (1 - beta2 ** step)
                    p -= lr * m_hat / (np.sqrt(v_hat) + eps)

    def predict(self, X):
        probs, _ = self.forward(X)
        return np.argmax(probs, axis=1), probs


def format_c_array_1d(name, arr):
    vals = ", ".join(f"{float(x):.6f}f" for x in arr)
    return f"static constexpr float {name}[{len(arr)}] = {{ {vals} }};\n"


def format_c_array_2d(name, arr):
    rows, cols = arr.shape
    lines = [f"static constexpr float {name}[{rows}][{cols}] = {{"]
    for r in range(rows):
        row_vals = ", ".join(f"{float(x):.6f}f" for x in arr[r])
        comma = "," if r < rows - 1 else ""
        lines.append(f"    {{ {row_vals} }}{comma}")
    lines.append("};\n")
    return "\n".join(lines)


def export_header(out_path, mean, std, model: NumpyMLP, val_acc: float):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("#pragma once\n\n")
        f.write("// Auto-generated by ml_trainer/train_classifier.py\n")
        f.write(f"// Validation accuracy: {val_acc * 100:.2f}%\n")
        f.write("// Architecture: 10 standardized features -> 16 (ReLU) -> 12 (ReLU) -> 4 (Softmax)\n\n")
        f.write("#include <cstdint>\n\n")
        f.write("namespace techbit {\nnamespace ml {\n\n")
        f.write("static constexpr int kNumFeatures = 10;\n")
        f.write("static constexpr int kHidden1 = 16;\n")
        f.write("static constexpr int kHidden2 = 12;\n")
        f.write("static constexpr int kNumClasses = 4;\n\n")
        f.write(format_c_array_1d("kScalerMean", mean))
        f.write("\n")
        f.write(format_c_array_1d("kScalerStd", std))
        f.write("\n")
        f.write(format_c_array_2d("kW1", model.W1))
        f.write("\n")
        f.write(format_c_array_1d("kB1", model.b1))
        f.write("\n")
        f.write(format_c_array_2d("kW2", model.W2))
        f.write("\n")
        f.write(format_c_array_1d("kB2", model.b2))
        f.write("\n")
        f.write(format_c_array_2d("kW3", model.W3))
        f.write("\n")
        f.write(format_c_array_1d("kB3", model.b3))
        f.write("\n} // namespace ml\n} // namespace techbit\n")


def main():
    parser = argparse.ArgumentParser(description="Train TechBIT MLP classifier and export C++ weights")
    parser.add_argument("--csv", type=str, default=None, help="Optional CSV dataset recorded from ESP32-S3")
    parser.add_argument(
        "--out",
        type=str,
        default=os.path.join(os.path.dirname(__file__), "..", "lib", "TechBitML", "ml_model_weights.h"),
        help="Output header path",
    )
    args = parser.parse_args()

    if args.csv:
        X, y = load_csv_dataset(args.csv)
        print(f"Loaded {len(y)} rows from {args.csv}")
    else:
        X, y = generate_physics_dataset(samples_per_class=1500, seed=42)
        print(f"Generated {len(y)} physics-modeled samples across {len(CLASS_NAMES)} classes")

    split = int(0.8 * len(y))
    X_train, y_train = X[:split], y[:split]
    X_val, y_val = X[split:], y[split:]

    mean = np.mean(X_train, axis=0)
    std = np.std(X_train, axis=0)
    std = np.where(std < 1e-6, 1.0, std)

    X_train_s = (X_train - mean) / std
    X_val_s = (X_val - mean) / std

    model = NumpyMLP(in_dim=10, h1=16, h2=12, out_dim=4, seed=123)
    model.fit(X_train_s, y_train, epochs=180, batch_size=64, lr=0.008, l2=1e-4)

    preds, _ = model.predict(X_val_s)
    val_acc = float(np.mean(preds == y_val))
    print(f"Validation Accuracy: {val_acc * 100:.2f}%")

    # Print confusion matrix
    cm = np.zeros((4, 4), dtype=int)
    for yt, yp in zip(y_val, preds):
        cm[yt, yp] += 1
    print("\nConfusion Matrix (rows=true, cols=pred):")
    header = "                " + " ".join(f"{c[:8]:>9}" for c in CLASS_NAMES)
    print(header)
    for i, cname in enumerate(CLASS_NAMES):
        row_str = " ".join(f"{cm[i, j]:>9d}" for j in range(4))
        print(f"{cname:<16}{row_str}")

    out_path = os.path.abspath(args.out)
    export_header(out_path, mean, std, model, val_acc)
    print(f"\nExported model weights to: {out_path}")


if __name__ == "__main__":
    main()
