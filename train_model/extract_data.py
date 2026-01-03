import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None

# -----------------------------
# Config
# -----------------------------
load_dotenv()

SUPABASE_URL = os.getenv("VITE_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # service role bypasses RLS

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

OUT_DIR = "training_data"
os.makedirs(OUT_DIR, exist_ok=True)

PAGE_SIZE = 1000  # PostgREST default max per request is often 1000

SIGNAL_TABLES = [
    "emotibit_ax",
    "emotibit_ay",
    "emotibit_az",
    "emotibit_eda",
    "emotibit_edl",
    "emotibit_gyro_x",
    "emotibit_gyro_y",
    "emotibit_gyro_z",
    "emotibit_heart_rate",
    "emotibit_humidity",
    "emotibit_inter_beat",
    "emotibit_magno_x",
    "emotibit_magno_y",
    "emotibit_magno_z",
    "emotibit_ppg_green",
    "emotibit_ppg_infrared",
    "emotibit_ppg_red",
    "emotibit_skin_con_amp",
    "emotibit_skin_con_freq",
    "emotibit_skin_con_rise",
    "emotibit_temp",
]

# -----------------------------
# Helpers
# -----------------------------
def fetch_all_rows(table: str, columns: str, order_col: str, pbar=None):
    """
    Fetch all rows from a table with pagination using .range().
    If pbar is provided, updates progress by number of rows fetched.
    """
    all_rows = []
    offset = 0

    while True:
        q = (
            supabase.table(table)
            .select(columns)
            .order(order_col, desc=False)
            .range(offset, offset + PAGE_SIZE - 1)
        )

        res = q.execute()
        page = res.data or []

        if not page:
            break

        all_rows.extend(page)

        if pbar is not None:
            pbar.update(len(page))

        if len(page) < PAGE_SIZE:
            break

        offset += PAGE_SIZE

    return all_rows



def export_signal_table(table: str):
    # Create a per-table row progress bar (unknown total)
    row_pbar = None
    if tqdm:
        row_pbar = tqdm(desc=f"Downloading {table}", unit="rows", leave=False)

    rows = fetch_all_rows(
        table=table,
        columns="device_id,recorded_at,value",
        order_col="recorded_at",
        pbar=row_pbar,
    )

    if row_pbar is not None:
        row_pbar.close()

    df = pd.DataFrame(rows, columns=["device_id", "recorded_at", "value"])

    df["recorded_at"] = (
        pd.to_datetime(df["recorded_at"], utc=True)
        .dt.strftime("%Y-%m-%d %H:%M:%S.%f%z")
    )

    out_path = os.path.join(OUT_DIR, f"{table}.csv")
    df.to_csv(out_path, index=False)
    return len(df), out_path


def export_label_intervals():
    # Leverage FK relationship: user_states.label_id -> labels.id
    # This nested select is supported by Supabase/PostgREST when FK exists.
    rows = fetch_all_rows(
        table="user_states",
        columns="user_id,form_id,started_at,ended_at,labels(label_name)",
        order_col="started_at",
    )

    df = pd.DataFrame(rows)

    # Flatten nested labels(label_name) into label_name
    # Each row has {"labels": {"label_name": "..."} } (or None)
    def extract_label_name(x):
        if isinstance(x, dict):
            return x.get("label_name")
        return None

    df["label_name"] = df["labels"].apply(extract_label_name)
    df = df.drop(columns=["labels"], errors="ignore")

    # Match your example rows: ended_at present
    df = df[df["ended_at"].notna()]

    # Ensure column order
    df = df[["user_id", "form_id", "started_at", "ended_at", "label_name"]]

    out_path = os.path.join(OUT_DIR, "label_intervals.csv")
    df.to_csv(out_path, index=False)
    return len(df), out_path


def main():
    total_exported = 0

    iterator = SIGNAL_TABLES
    if tqdm:
        iterator = tqdm(SIGNAL_TABLES, desc="Exporting signal tables", unit="table")

    for table in iterator:
        n, path = export_signal_table(table)
        total_exported += n
        if not tqdm:
            print(f"{table}: {n} rows -> {path}")

    n_labels, path_labels = export_label_intervals()
    if not tqdm:
        print(f"label_intervals: {n_labels} rows -> {path_labels}")

    print(f"\nDone. Exported {total_exported} signal rows + {n_labels} label rows into '{OUT_DIR}/'.")


if __name__ == "__main__":
    main()
