import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

# -------------------------
# CONFIG
# -------------------------
DATA_DIR = Path("training_data")
WINDOW_SECONDS = 10
STRIDE_SECONDS = 5
UNKNOWN_LABEL = "unknown"

WINDOW = pd.Timedelta(seconds=WINDOW_SECONDS)
STRIDE = pd.Timedelta(seconds=STRIDE_SECONDS)

# Define each signal with a strategy
# - dense: expects frequent samples; require a minimum count
# - sparse: irregular/bursty; allow 0/1 samples and extract different features
SIGNAL_SPECS = {
    # dense ~25 Hz
    "ax": {"type": "dense", "min_samples": 50},
    "ay": {"type": "dense", "min_samples": 50},
    "az": {"type": "dense", "min_samples": 50},

    "gyro_x": {"type": "dense", "min_samples": 50},
    "gyro_y": {"type": "dense", "min_samples": 50},
    "gyro_z": {"type": "dense", "min_samples": 50},

    "magno_x": {"type": "dense", "min_samples": 50},
    "magno_y": {"type": "dense", "min_samples": 50},
    "magno_z": {"type": "dense", "min_samples": 50},

    "ppg_red": {"type": "dense", "min_samples": 50},
    "ppg_infrared": {"type": "dense", "min_samples": 50},
    "ppg_green": {"type": "dense", "min_samples": 50},

    # medium rate (often ~15 Hz)
    "eda": {"type": "dense", "min_samples": 20},

    # lower rate (often ~7.5 Hz)
    "temp": {"type": "dense", "min_samples": 10},

    # sparse / irregular
    "heart_rate": {"type": "sparse"},
    "skin_con_amp": {"type": "sparse"},
    "skin_con_freq": {"type": "sparse"},
    "skin_con_rise": {"type": "sparse"},

    # If you later add these, set type appropriately:
    # "edl": {"type": "dense", "min_samples": 20},
    # "inter_beat": {"type": "sparse"},
}

SIGNALS = list(SIGNAL_SPECS.keys())

# -------------------------
# LOAD LABEL INTERVALS
# -------------------------
labels = pd.read_csv(
    DATA_DIR / "label_intervals.csv",
    parse_dates=["started_at", "ended_at"]
).sort_values("started_at").reset_index(drop=True)

# -------------------------
# LOAD SENSOR CSVs
# -------------------------
def load_sensor(name: str) -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / f"emotibit_{name}.csv", parse_dates=["recorded_at"])
    df = df.sort_values("recorded_at")
    df = df[["recorded_at", "value"]].rename(columns={"value": name})
    return df

sensors = {s: load_sensor(s) for s in SIGNALS}

# -------------------------
# FEATURE EXTRACTION
# -------------------------
def dense_features(df: pd.DataFrame, col: str, t0: pd.Timestamp, t1: pd.Timestamp, min_samples: int):
    w = df[(df["recorded_at"] >= t0) & (df["recorded_at"] < t1)]
    n = len(w)
    if n < min_samples:
        return None

    v = w[col].to_numpy(dtype=float)
    ts = w["recorded_at"].to_numpy(dtype="datetime64[ns]").astype("int64") / 1e9
    dt = np.diff(ts)

    # dt can be empty if n==1 (but min_samples prevents that)
    mean_dt = float(np.mean(dt)) if len(dt) else np.nan
    eff_hz = float(1.0 / mean_dt) if (len(dt) and mean_dt > 0) else np.nan
    span = float(ts[-1] - ts[0]) if n >= 2 else 0.0

    return {
        f"{col}_mean": float(np.mean(v)),
        f"{col}_std": float(np.std(v)),
        f"{col}_min": float(np.min(v)),
        f"{col}_max": float(np.max(v)),
        f"{col}_energy": float(np.sum(v ** 2)),
        f"{col}_samples": float(n),
        f"{col}_mean_dt": mean_dt,
        f"{col}_effective_hz": eff_hz,
        f"{col}_coverage": float(span / WINDOW_SECONDS) if WINDOW_SECONDS > 0 else np.nan,
    }

def sparse_features(df: pd.DataFrame, col: str, t0: pd.Timestamp, t1: pd.Timestamp):
    w = df[(df["recorded_at"] >= t0) & (df["recorded_at"] < t1)]
    n = len(w)

    feats = {
        f"{col}_count": float(n),
    }

    if n == 0:
        feats.update({
            f"{col}_last": np.nan,
            f"{col}_time_since_last": float(WINDOW_SECONDS),  # "no sample in window"
            f"{col}_mean": np.nan,
            f"{col}_std": np.nan,
        })
        return feats

    # at least 1 sample
    last_time = w["recorded_at"].iloc[-1]
    feats[f"{col}_last"] = float(w[col].iloc[-1])
    feats[f"{col}_time_since_last"] = float((t1 - last_time).total_seconds())

    if n >= 2:
        v = w[col].to_numpy(dtype=float)
        feats[f"{col}_mean"] = float(np.mean(v))
        feats[f"{col}_std"] = float(np.std(v))
    else:
        feats[f"{col}_mean"] = float(w[col].iloc[-1])
        feats[f"{col}_std"] = 0.0

    return feats

def extract_window_features(t0: pd.Timestamp, t1: pd.Timestamp):
    feats = {}
    for sig, spec in SIGNAL_SPECS.items():
        df = sensors[sig]
        if spec["type"] == "dense":
            f = dense_features(df, sig, t0, t1, min_samples=spec["min_samples"])
            if f is None:
                return None  # skip this window (dense signal missing too much data)
            feats.update(f)
        else:
            feats.update(sparse_features(df, sig, t0, t1))
    return feats

# -------------------------
# LABEL ASSIGNMENT (efficient-ish)
# -------------------------
def label_for_window(t0: pd.Timestamp, t1: pd.Timestamp) -> str:
    # strict containment like your original: window must be fully inside interval
    # if you want overlap-based labeling later, change this function.
    for _, row in labels.iterrows():
        if t0 >= row.started_at and t1 <= row.ended_at:
            return row.label_name
        if row.started_at > t1:
            break
    return UNKNOWN_LABEL

# -------------------------
# WINDOWING
# -------------------------
start = min(df["recorded_at"].min() for df in sensors.values())
end = max(df["recorded_at"].max() for df in sensors.values())

X, y = [], []
t = start

skipped = 0
while t + WINDOW <= end:
    t_end = t + WINDOW

    feats = extract_window_features(t, t_end)
    if feats is None:
        skipped += 1
        t += STRIDE
        continue

    y.append(label_for_window(t, t_end))
    X.append(feats)

    t += STRIDE

X = pd.DataFrame(X)
y = np.array(y)

print("Windows kept:", len(y), "Skipped:", skipped)
print("Label distribution:")
print(pd.Series(y).value_counts())

# Drop unknown if you want a purely supervised activity classifier
# (optional; if you keep UNKNOWN, it becomes another class)
# mask = (y != UNKNOWN_LABEL)
# X, y = X[mask], y[mask]

# -------------------------
# ENCODE + SPLIT
# -------------------------
le = LabelEncoder()
y_enc = le.fit_transform(y)

X_train, X_test, y_train, y_test = train_test_split(
    X, y_enc,
    test_size=0.2,
    stratify=y_enc,
    random_state=42
)

# -------------------------
# TRAIN
# -------------------------
clf = RandomForestClassifier(
    n_estimators=500,
    n_jobs=-1,
    class_weight="balanced",
    random_state=42
)
clf.fit(X_train, y_train)

# -------------------------
# EVAL
# -------------------------
y_pred = clf.predict(X_test)
print(classification_report(y_test, y_pred, target_names=le.classes_))

# -------------------------
# SAVE
# -------------------------
Path("models").mkdir(exist_ok=True)
joblib.dump(clf, "models/emotibit_activity_model.joblib")
joblib.dump(le, "models/label_encoder.joblib")
print("Model saved.")
