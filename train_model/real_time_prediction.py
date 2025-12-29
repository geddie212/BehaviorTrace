from pylsl import resolve_streams, StreamInlet, local_clock
import pandas as pd
import numpy as np
import time
import joblib
from collections import defaultdict, deque

# -------------------------
# CONFIG
# -------------------------
WINDOW_SECONDS = 10.0
STRIDE_SECONDS = 5.0

# Only include streams you actually trained on (your training code SIGNALS list)
LSL_TO_SIGNAL = {
    "PPG_RED": "ppg_red",
    "PPG_IR":  "ppg_infrared",
    "PPG_GRN": "ppg_green",
    "ACC_X":   "ax",
    "ACC_Y":   "ay",
    "ACC_Z":   "az",
    "GYRO_X":  "gyro_x",
    "GYRO_Y":  "gyro_y",
    "GYRO_Z":  "gyro_z",
    "MAG_X":   "magno_x",
    "MAG_Y":   "magno_y",
    "MAG_Z":   "magno_z",
}

# Debug tuning
PRINT_EVERY_STRIDE = True
PRINT_WHEN_NO_SAMPLES = True

# Safety thresholds (prevents “feature row exists but window is tiny”)
MIN_SAMPLES_PER_STREAM = 10            # require at least N samples
MIN_SPAN_SECONDS = 0.75                # require timestamps span in window

# -------------------------
# LOAD MODEL
# -------------------------
clf = joblib.load("models/emotibit_activity_model.joblib")
le = joblib.load("models/label_encoder.joblib")
FEATURE_ORDER = list(getattr(clf, "feature_names_in_", []))
if not FEATURE_ORDER:
    raise RuntimeError("Model is missing feature_names_in_. Re-train with sklearn >= 1.0 or store feature list.")

# -------------------------
# BUFFERS
# -------------------------
# store (ts, value) in LSL time domain
buffers = {lsl_name: deque() for lsl_name in LSL_TO_SIGNAL.keys()}
last_pred_t = 0.0

# -------------------------
# LSL SETUP
# -------------------------
streams = resolve_streams()
inlets = []

for s in streams:
    if s.name() in LSL_TO_SIGNAL:
        inlet = StreamInlet(s, max_buflen=60)  # allow a decent inlet buffer
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
    for name, dq in buffers.items():
        while dq and dq[0][0] < cutoff:
            dq.popleft()

def buffer_health():
    lines = ["[STATUS] buffer health:"]
    for lsl_name, train_name in LSL_TO_SIGNAL.items():
        dq = buffers.get(lsl_name, deque())
        n = len(dq)
        if n < 2:
            lines.append(f"  {lsl_name:7s}->{train_name:10s} n={n:4d} (insufficient)")
            continue
        ts = np.array([x[0] for x in dq], dtype=float)
        span = float(ts[-1] - ts[0])
        dt = np.diff(ts)
        mean_dt = float(np.mean(dt)) if len(dt) else float("nan")
        hz = (1.0 / mean_dt) if mean_dt > 0 else float("nan")
        lines.append(
            f"  {lsl_name:7s}->{train_name:10s} "
            f"n={n:4d} span={span:6.2f}s mean_dt={mean_dt:.6f} hz={hz:.2f} last_lsl={ts[-1]:.6f}"
        )
    return "\n".join(lines)

def extract_features(now_lsl: float):
    feats = {}

    # For every trained stream, ensure we have enough samples in-window
    missing_reasons = []
    for lsl_name, sig in LSL_TO_SIGNAL.items():
        dq = buffers.get(lsl_name)
        if dq is None or len(dq) < 2:
            missing_reasons.append(f"{lsl_name} has <2 samples")
            continue

        ts = np.array([t for (t, _) in dq], dtype=float)
        v = np.array([val for (_, val) in dq], dtype=float)

        span = ts[-1] - ts[0]
        if len(v) < MIN_SAMPLES_PER_STREAM:
            missing_reasons.append(f"{lsl_name} has only {len(v)} samples (<{MIN_SAMPLES_PER_STREAM})")
            continue
        if span < MIN_SPAN_SECONDS:
            missing_reasons.append(f"{lsl_name} span {span:.2f}s (<{MIN_SPAN_SECONDS}s)")
            continue

        dt = np.diff(ts)
        if len(dt) == 0 or np.mean(dt) <= 0:
            missing_reasons.append(f"{lsl_name} dt invalid")
            continue

        feats.update({
            f"{sig}_mean": float(np.mean(v)),
            f"{sig}_std": float(np.std(v)),
            f"{sig}_min": float(np.min(v)),
            f"{sig}_max": float(np.max(v)),
            f"{sig}_energy": float(np.sum(v ** 2)),

            # frequency-aware features (you trained on these)
            f"{sig}_samples": float(len(v)),
            f"{sig}_mean_dt": float(np.mean(dt)),
            f"{sig}_effective_hz": float(1.0 / np.mean(dt)),
            f"{sig}_coverage": float(span / WINDOW_SECONDS),
        })

    if missing_reasons:
        return None, missing_reasons

    # Enforce feature schema
    missing_cols = [c for c in FEATURE_ORDER if c not in feats]
    extra_cols = [c for c in feats.keys() if c not in set(FEATURE_ORDER)]
    if missing_cols:
        return None, [f"missing features (schema mismatch): {missing_cols[:10]}{'...' if len(missing_cols) > 10 else ''}"]
    if extra_cols:
        # not fatal, but indicates a naming mismatch between training/inference
        return None, [f"extra/unexpected features: {extra_cols[:10]}{'...' if len(extra_cols) > 10 else ''}"]

    return feats, []

def predict_from_feats(feats: dict):
    # strict column order for sklearn
    X = pd.DataFrame([[feats[c] for c in FEATURE_ORDER]], columns=FEATURE_ORDER)

    pred_class = int(clf.predict(X)[0])
    label = le.inverse_transform([pred_class])[0]

    # confidence (if supported)
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

    any_pulled = False

    # Pull chunks to avoid "all None" loops losing data
    for stream_name, inlet in inlets:
        chunk, ts_list = inlet.pull_chunk(timeout=0.0, max_samples=512)
        if ts_list:
            any_pulled = True
            for samp, ts in zip(chunk, ts_list):
                # assume 1 channel streams; if multi-channel, adapt here
                buffers[stream_name].append((float(ts), float(samp[0])))

    prune_old(now_lsl)

    #if (not any_pulled) and PRINT_WHEN_NO_SAMPLES:
        #print("[STATUS] no samples pulled in the last loop iteration (all streams returned None).")

    if now_lsl - last_pred_t >= STRIDE_SECONDS:
        last_pred_t = now_lsl

        #if PRINT_EVERY_STRIDE:
            #print(buffer_health())

        feats, reasons = extract_features(now_lsl)
        if feats is None:
            # show top reasons so you can diagnose exactly what’s missing
            print("[SKIP] cannot predict yet:", "; ".join(reasons[:6]) + (" ..." if len(reasons) > 6 else ""))
            time.sleep(0.01)
            continue

        try:
            label, conf = predict_from_feats(feats)
            if conf is None:
                print(f"[{time.strftime('%H:%M:%S')}] -> {label}")
            else:
                print(f"[{time.strftime('%H:%M:%S')}] -> {label} (conf={conf:.2f})")
        except Exception as e:
            # dump the most useful debug snapshot
            print("[ERROR] prediction failed:", repr(e))
            print("[DEBUG] example feat keys:", list(feats.keys())[:10])
            print("[DEBUG] example feat vals:", [feats[k] for k in list(feats.keys())[:5]])
            print("[DEBUG] feature_order head:", FEATURE_ORDER[:10])

    time.sleep(0.01)
