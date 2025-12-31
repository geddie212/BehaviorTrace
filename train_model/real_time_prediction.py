from pylsl import resolve_streams, StreamInlet, local_clock
import pandas as pd
import numpy as np
import time
import joblib
from collections import deque

# -------------------------
# CONFIG
# -------------------------
WINDOW_SECONDS = 10.0
STRIDE_SECONDS = 5.0
SLEEP_SECONDS = 0.01

# Map LSL stream name -> training signal name
LSL_TO_SIGNAL = {
    "ACC_X": "ax",
    "ACC_Y": "ay",
    "ACC_Z": "az",
    "EDA": "eda",
    "GYRO_X": "gyro_x",
    "GYRO_Y": "gyro_y",
    "GYRO_Z": "gyro_z",
    "HR": "heart_rate",
    "MAG_X": "magno_x",
    "MAG_Y": "magno_y",
    "MAG_Z": "magno_z",
    "PPG_GRN": "ppg_green",
    "PPG_IR": "ppg_infrared",
    "PPG_RED": "ppg_red",
    "SCR_AMP": "skin_con_amp",
    "SCR_FREQ": "skin_con_freq",
    "SCR_RIS": "skin_con_rise",
    "TEMP1": "temp",
}

# Must match the training script's SIGNAL_SPECS (dense vs sparse + min_samples)
DENSE_SPECS = {
    "ax": 50, "ay": 50, "az": 50,
    "gyro_x": 50, "gyro_y": 50, "gyro_z": 50,
    "magno_x": 50, "magno_y": 50, "magno_z": 50,
    "ppg_red": 50, "ppg_infrared": 50, "ppg_green": 50,
    "eda": 20,
    "temp": 10,
}
SPARSE_SIGNALS = {"heart_rate", "skin_con_amp", "skin_con_freq", "skin_con_rise"}

PRINT_BUFFER_HEALTH_EVERY = 1  # strides; set 0 to disable
PRINT_SKIP_REASONS = True

# -------------------------
# LOAD MODEL
# -------------------------
clf = joblib.load("models/emotibit_activity_model.joblib")
le = joblib.load("models/label_encoder.joblib")

FEATURE_ORDER = list(getattr(clf, "feature_names_in_", []))
if not FEATURE_ORDER:
    raise RuntimeError("Model missing feature_names_in_. Retrain with sklearn>=1.0 or save feature list manually.")

# -------------------------
# BUFFERS
# -------------------------
# buffers store (lsl_ts, value)
buffers = {lsl: deque() for lsl in LSL_TO_SIGNAL.keys()}
last_pred_t = 0.0
stride_count = 0

# -------------------------
# LSL SETUP
# -------------------------
streams = resolve_streams()
inlets = []

for s in streams:
    if s.name() in LSL_TO_SIGNAL:
        inlet = StreamInlet(s, max_buflen=60)
        inlets.append((s.name(), inlet))
        print(f"Connected to {s.name()} -> {LSL_TO_SIGNAL[s.name()]}")

if not inlets:
    raise RuntimeError("No matching LSL streams found. Check stream names vs LSL_TO_SIGNAL keys.")

print("\n--- Realtime inference started ---\n")

# -------------------------
# HELPERS
# -------------------------
def prune_old(now_lsl: float):
    cutoff = now_lsl - WINDOW_SECONDS
    for dq in buffers.values():
        while dq and dq[0][0] < cutoff:
            dq.popleft()

def buffer_health(now_lsl: float) -> str:
    lines = [f"[STATUS] now_lsl={now_lsl:.3f} window={WINDOW_SECONDS:.1f}s"]
    for lsl_name, train_name in LSL_TO_SIGNAL.items():
        dq = buffers.get(lsl_name, deque())
        n = len(dq)
        if n == 0:
            lines.append(f"  {lsl_name:8s}->{train_name:14s} n=0")
            continue
        ts0, ts1 = dq[0][0], dq[-1][0]
        span = ts1 - ts0
        lines.append(f"  {lsl_name:8s}->{train_name:14s} n={n:4d} span={span:6.2f}s last_age={(now_lsl-ts1):5.2f}s")
    return "\n".join(lines)

def dense_features_from_buffer(sig: str, dq: deque):
    # dq: (ts, val) pairs already pruned to window
    n = len(dq)
    min_samples = DENSE_SPECS[sig]
    if n < min_samples:
        return None, f"{sig} dense n={n} < min_samples={min_samples}"

    ts = np.array([t for (t, _) in dq], dtype=float)
    v = np.array([val for (_, val) in dq], dtype=float)

    span = float(ts[-1] - ts[0])
    dt = np.diff(ts)
    if len(dt) == 0:
        return None, f"{sig} dense dt empty"

    mean_dt = float(np.mean(dt))
    eff_hz = float(1.0 / mean_dt) if mean_dt > 0 else np.nan

    feats = {
        f"{sig}_mean": float(np.mean(v)),
        f"{sig}_std": float(np.std(v)),
        f"{sig}_min": float(np.min(v)),
        f"{sig}_max": float(np.max(v)),
        f"{sig}_energy": float(np.sum(v ** 2)),
        f"{sig}_samples": float(n),
        f"{sig}_mean_dt": mean_dt,
        f"{sig}_effective_hz": eff_hz,
        f"{sig}_coverage": float(span / WINDOW_SECONDS) if WINDOW_SECONDS > 0 else np.nan,
    }
    return feats, None

def sparse_features_from_buffer(sig: str, dq: deque, now_lsl: float):
    # Implements the same sparse schema as training:
    # count, last, time_since_last, mean, std
    n = len(dq)
    feats = {
        f"{sig}_count": float(n),
    }

    if n == 0:
        feats.update({
            f"{sig}_last": np.nan,
            f"{sig}_time_since_last": float(WINDOW_SECONDS),
            f"{sig}_mean": np.nan,
            f"{sig}_std": np.nan,
        })
        return feats

    last_ts, last_val = dq[-1]
    feats[f"{sig}_last"] = float(last_val)
    feats[f"{sig}_time_since_last"] = float(now_lsl - float(last_ts))

    if n >= 2:
        v = np.array([val for (_, val) in dq], dtype=float)
        feats[f"{sig}_mean"] = float(np.mean(v))
        feats[f"{sig}_std"] = float(np.std(v))
    else:
        feats[f"{sig}_mean"] = float(last_val)
        feats[f"{sig}_std"] = 0.0

    return feats

def extract_features(now_lsl: float):
    feats = {}
    reasons = []

    # Build by TRAINING signal name, not LSL name
    # First ensure all required signals are present in mapping
    for lsl_name, sig in LSL_TO_SIGNAL.items():
        dq = buffers.get(lsl_name, deque())

        if sig in DENSE_SPECS:
            f, err = dense_features_from_buffer(sig, dq)
            if f is None:
                reasons.append(err)
            else:
                feats.update(f)
        elif sig in SPARSE_SIGNALS:
            feats.update(sparse_features_from_buffer(sig, dq, now_lsl))
        else:
            # If you trained on a signal but forgot to categorize it, this will show up immediately
            reasons.append(f"{sig} not categorized (dense/sparse)")

    if reasons:
        return None, reasons

    # Enforce schema exactly
    missing_cols = [c for c in FEATURE_ORDER if c not in feats]
    extra_cols = [c for c in feats.keys() if c not in set(FEATURE_ORDER)]
    if missing_cols:
        return None, [f"schema missing: {missing_cols[:12]}{'...' if len(missing_cols)>12 else ''}"]
    if extra_cols:
        return None, [f"schema extra: {extra_cols[:12]}{'...' if len(extra_cols)>12 else ''}"]

    return feats, []

def predict_from_feats(feats: dict):
    X = pd.DataFrame([[feats[c] for c in FEATURE_ORDER]], columns=FEATURE_ORDER)
    pred_class = int(clf.predict(X)[0])
    label = le.inverse_transform([pred_class])[0]

    conf = None
    if hasattr(clf, "predict_proba"):
        proba = clf.predict_proba(X)[0]
        conf = float(np.max(proba))

    return label, conf

# -------------------------
# MAIN LOOP
# -------------------------
while True:
    now_lsl = local_clock()

    # Pull chunks (better than pull_sample for high-rate streams)
    for stream_name, inlet in inlets:
        chunk, ts_list = inlet.pull_chunk(timeout=0.0, max_samples=512)
        if ts_list:
            for samp, ts in zip(chunk, ts_list):
                buffers[stream_name].append((float(ts), float(samp[0])))

    prune_old(now_lsl)

    if now_lsl - last_pred_t >= STRIDE_SECONDS:
        last_pred_t = now_lsl
        stride_count += 1

        if PRINT_BUFFER_HEALTH_EVERY and (stride_count % PRINT_BUFFER_HEALTH_EVERY == 0):
            print(buffer_health(now_lsl))

        feats, reasons = extract_features(now_lsl)
        if feats is None:
            if PRINT_SKIP_REASONS:
                print("[SKIP] cannot predict:", "; ".join(reasons[:6]) + (" ..." if len(reasons) > 6 else ""))
            time.sleep(SLEEP_SECONDS)
            continue

        try:
            label, conf = predict_from_feats(feats)
            ts_str = time.strftime("%H:%M:%S")
            if conf is None:
                print(f"[{ts_str}] -> {label}")
            else:
                print(f"[{ts_str}] -> {label} (conf={conf:.2f})")
        except Exception as e:
            print("[ERROR] prediction failed:", repr(e))
            print("[DEBUG] first 12 feature keys:", FEATURE_ORDER[:12])
            print("[DEBUG] example values:", [feats[k] for k in FEATURE_ORDER[:5]])

    time.sleep(SLEEP_SECONDS)
