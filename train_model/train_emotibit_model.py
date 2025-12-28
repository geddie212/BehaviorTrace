import pandas as pd
import numpy as np
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import joblib

# --------------------
# CONFIG
# --------------------
DATA_DIR = Path("training_data")
WINDOW_SIZE = pd.Timedelta(seconds=10)
STRIDE = pd.Timedelta(seconds=5)
RESAMPLE_RATE = "50ms"  # 20 Hz common grid
UNKNOWN_LABEL = "unknown"

# --------------------
# LOAD LABELS
# --------------------
labels = pd.read_csv(
    DATA_DIR / "label_intervals.csv",
    parse_dates=["started_at", "ended_at"]
)


# --------------------
# LOAD SENSORS
# --------------------
def load_sensor(name):
    df = pd.read_csv(
        DATA_DIR / f"emotibit_{name}.csv",
        parse_dates=["recorded_at"]
    )
    df = df.sort_values("recorded_at")
    df = df.set_index("recorded_at")
    return df[["value"]].rename(columns={"value": name})


signals = [
    "ax", "ay", "az", "eda", "edl", "gyro_x", "gyro_y", "gyro_z", "heart_rate", "inter_beat", "magno_x", "magno_y",
    "ppg_green", "ppg_infrared", "ppg_red", "skin_con_amp", "skin_con_freq", "skin_con_rise"
]

sensor_dfs = [load_sensor(s) for s in signals]

# --------------------
# ALIGN ALL SENSORS
# --------------------
data = pd.concat(sensor_dfs, axis=1)
data = data.resample(RESAMPLE_RATE).mean().interpolate()

# --------------------
# WINDOWING + LABELING
# --------------------
X = []
y = []

start = data.index.min()
end = data.index.max()

t = start
while t + WINDOW_SIZE <= end:
    window = data.loc[t:t + WINDOW_SIZE]

    if len(window) < 2:
        t += STRIDE
        continue

    # ---- feature extraction ----
    features = {}
    for col in window.columns:
        values = window[col].values
        features[f"{col}_mean"] = np.mean(values)
        features[f"{col}_std"] = np.std(values)
        features[f"{col}_min"] = np.min(values)
        features[f"{col}_max"] = np.max(values)
        features[f"{col}_energy"] = np.sum(values ** 2)

    # ---- label assignment ----
    label = UNKNOWN_LABEL
    for _, row in labels.iterrows():
        if t >= row.started_at and (t + WINDOW_SIZE) <= row.ended_at:
            label = row.label_name
            break

    X.append(features)
    y.append(label)

    t += STRIDE

X = pd.DataFrame(X)
y = np.array(y)

print("Label distribution:")
print(pd.Series(y).value_counts())

# --------------------
# ENCODE LABELS
# --------------------
le = LabelEncoder()
y_enc = le.fit_transform(y)

# --------------------
# TRAIN / TEST SPLIT
# --------------------
X_train, X_test, y_train, y_test = train_test_split(
    X, y_enc, test_size=0.2, stratify=y_enc, random_state=42
)

# --------------------
# TRAIN MODEL
# --------------------
clf = RandomForestClassifier(
    n_estimators=300,
    max_depth=None,
    n_jobs=-1,
    class_weight="balanced",
    random_state=42
)

clf.fit(X_train, y_train)

# --------------------
# EVALUATION
# --------------------
y_pred = clf.predict(X_test)

print(classification_report(
    y_test,
    y_pred,
    target_names=le.classes_
))

# --------------------
# SAVE MODEL
# --------------------
joblib.dump(clf, "emotibit_activity_model.joblib")
joblib.dump(le, "label_encoder.joblib")

print("Model saved.")
