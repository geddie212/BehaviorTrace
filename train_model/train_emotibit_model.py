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

SIGNALS = [
    "ppg_red", "ppg_infrared", "ppg_green",
    "ax", "ay", "az",
    "gyro_x", "gyro_y", "gyro_z",
    "magno_x", "magno_y", "magno_z"
]

# -------------------------
# LOAD LABEL INTERVALS
# -------------------------
labels = pd.read_csv(
    DATA_DIR / "label_intervals.csv",
    parse_dates=["started_at", "ended_at"]
)

# -------------------------
# LOAD SENSOR CSVs (NO RESAMPLING)
# -------------------------
def load_sensor(name):
    df = pd.read_csv(
        DATA_DIR / f"emotibit_{name}.csv",
        parse_dates=["recorded_at"]
    )
    df = df.sort_values("recorded_at")
    return df[["recorded_at", "value"]].rename(columns={"value": name})

sensors = {s: load_sensor(s) for s in SIGNALS}

# -------------------------
# FEATURE EXTRACTION
# -------------------------
def extract_signal_features(df, col, t0, t1):
    w = df[(df["recorded_at"] >= t0) & (df["recorded_at"] < t1)]

    if len(w) < 2:
        return None

    v = w[col].values
    ts = w["recorded_at"].values.astype("datetime64[ns]").astype("int64") / 1e9

    dt = np.diff(ts)

    feats = {
        f"{col}_mean": np.mean(v),
        f"{col}_std": np.std(v),
        f"{col}_min": np.min(v),
        f"{col}_max": np.max(v),
        f"{col}_energy": np.sum(v ** 2),

        # frequency-aware features
        f"{col}_samples": len(v),
        f"{col}_mean_dt": np.mean(dt),
        f"{col}_effective_hz": 1.0 / np.mean(dt),
        f"{col}_coverage": (ts[-1] - ts[0]) / WINDOW_SECONDS
    }
    return feats

# -------------------------
# WINDOWING
# -------------------------
start = min(df["recorded_at"].min() for df in sensors.values())
end = max(df["recorded_at"].max() for df in sensors.values())

X, y = [], []

t = start
while t + pd.Timedelta(seconds=WINDOW_SECONDS) <= end:
    t_end = t + pd.Timedelta(seconds=WINDOW_SECONDS)

    features = {}

    valid = True
    for name, df in sensors.items():
        feats = extract_signal_features(df, name, t, t_end)
        if feats is None:
            valid = False
            break
        features.update(feats)

    if not valid:
        t += pd.Timedelta(seconds=STRIDE_SECONDS)
        continue

    label = UNKNOWN_LABEL
    for _, row in labels.iterrows():
        if t >= row.started_at and t_end <= row.ended_at:
            label = row.label_name
            break

    X.append(features)
    y.append(label)

    t += pd.Timedelta(seconds=STRIDE_SECONDS)

X = pd.DataFrame(X)
y = np.array(y)

print("Label distribution:")
print(pd.Series(y).value_counts())

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
    n_estimators=400,
    n_jobs=-1,
    class_weight="balanced",
    random_state=42
)

clf.fit(X_train, y_train)

# -------------------------
# EVAL
# -------------------------
y_pred = clf.predict(X_test)

print(classification_report(
    y_test,
    y_pred,
    target_names=le.classes_
))

# -------------------------
# SAVE
# -------------------------
Path("models").mkdir(exist_ok=True)
joblib.dump(clf, "models/emotibit_activity_model.joblib")
joblib.dump(le, "models/label_encoder.joblib")

print("Model saved.")
