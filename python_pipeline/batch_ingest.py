import os
import json
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client

from datetime import datetime
from zoneinfo import ZoneInfo


# Load env vars
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

BASE_DIR = "emotibit_SD_data"
BATCH_SIZE = 1000  # safe + fast for Supabase

PACIFIC_TZ = ZoneInfo("America/Los_Angeles")


def extract_device_id(info_json_path):
    with open(info_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # EmotiBit schema: first list item → info → device_id
    return data[0]["info"]["device_id"]

def ingest_csv(csv_path, device_id, data_col, supabase_table):
    df = pd.read_csv(csv_path)

    # Interpret LocalTimestamp as PST/PDT (NOT UTC)
    df["recorded_at"] = df["LocalTimestamp"].apply(
        lambda ts: datetime.fromtimestamp(ts, tz=PACIFIC_TZ)
    )

    records = [
        {
            "device_id": device_id,
            "recorded_at": row["recorded_at"].isoformat(),
            "value": float(row[data_col]),
        }
        for _, row in df.iterrows()
    ]

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i : i + BATCH_SIZE]
        supabase.table(supabase_table).insert(batch).execute()


def process_user_folder(folder_path):
    info_json = None
    ax_csv = None
    ay_csv = None
    az_csv = None
    eda_csv = None
    edl_csv = None
    gyro_x_csv = None
    gyro_y_csv = None
    gyro_z_csv = None
    hr_csv = None
    bi_csv = None
    mx_csv = None
    my_csv = None
    mz_csv = None
    pg_csv = None
    pi_csv = None
    pr_csv = None
    sa_csv = None
    sf_csv = None
    sr_csv = None
    t1_csv = None

    for file in os.listdir(folder_path):
        if file.endswith("_info.json"):
            info_json = os.path.join(folder_path, file)
        elif file.endswith("_AX.csv"):
            ax_csv = os.path.join(folder_path, file)
        elif file.endswith("_AY.csv"):
            ay_csv = os.path.join(folder_path, file)
        elif file.endswith("_AZ.csv"):
            az_csv = os.path.join(folder_path, file)
        elif file.endswith("_EA.csv"):
            eda_csv = os.path.join(folder_path, file)
        elif file.endswith("_EL.csv"):
            edl_csv = os.path.join(folder_path, file)
        elif file.endswith("_GX.csv"):
            gyro_x_csv = os.path.join(folder_path, file)
        elif file.endswith("_GY.csv"):
            gyro_y_csv = os.path.join(folder_path, file)
        elif file.endswith("_GZ.csv"):
            gyro_z_csv = os.path.join(folder_path, file)
        elif file.endswith("_HR.csv"):
            hr_csv = os.path.join(folder_path, file)
        elif file.endswith("_BI.csv"):
            bi_csv = os.path.join(folder_path, file)
        elif file.endswith("_MX.csv"):
            mx_csv = os.path.join(folder_path, file)
        elif file.endswith("_MY.csv"):
            my_csv = os.path.join(folder_path, file)
        elif file.endswith("_MZ.csv"):
            mz_csv = os.path.join(folder_path, file)
        elif file.endswith("_PG.csv"):
            pg_csv = os.path.join(folder_path, file)
        elif file.endswith("_PI.csv"):
            pi_csv = os.path.join(folder_path, file)
        elif file.endswith("_PR.csv"):
            pr_csv = os.path.join(folder_path, file)
        elif file.endswith("_SA.csv"):
            sa_csv = os.path.join(folder_path, file)
        elif file.endswith("_SF.csv"):
            sf_csv = os.path.join(folder_path, file)
        elif file.endswith("_SR.csv"):
            sr_csv = os.path.join(folder_path, file)
        elif file.endswith("_T1.csv"):
            t1_csv = os.path.join(folder_path, file)

    device_id = extract_device_id(info_json)
    ingest_csv(ax_csv, device_id, "AX", "emotibit_ax")
    ingest_csv(ay_csv, device_id, "AY", "emotibit_ay")
    ingest_csv(az_csv, device_id, "AZ", "emotibit_az")
    ingest_csv(eda_csv, device_id, "EA", "emotibit_eda")
    ingest_csv(edl_csv, device_id, "EL", "emotibit_edl")
    ingest_csv(gyro_x_csv, device_id, "GX", "emotibit_gyro_x")
    ingest_csv(gyro_y_csv, device_id, "GY", "emotibit_gyro_y")
    ingest_csv(gyro_z_csv, device_id, "GZ", "emotibit_gyro_z")
    ingest_csv(hr_csv, device_id, "HR", "emotibit_heart_rate")
    ingest_csv(bi_csv, device_id, "BI", "emotibit_inter_beat")
    ingest_csv(mx_csv, device_id, "MX", "emotibit_magno_x")
    ingest_csv(my_csv, device_id, "MY", "emotibit_magno_y")
    ingest_csv(mz_csv, device_id, "MZ", "emotibit_magno_z")
    ingest_csv(pg_csv, device_id, "PG", "emotibit_ppg_green")
    ingest_csv(pi_csv, device_id, "PI", "emotibit_ppg_infrared")
    ingest_csv(pr_csv, device_id, "PR", "emotibit_ppg_red")
    ingest_csv(sa_csv, device_id, "SA", "emotibit_skin_con_amp")
    ingest_csv(sf_csv, device_id, "SF", "emotibit_skin_con_freq")
    ingest_csv(sr_csv, device_id, "SR", "emotibit_skin_con_rise")
    ingest_csv(t1_csv, device_id, "T1", "emotibit_temp")


def main():
    for entry in os.listdir(BASE_DIR):
        folder_path = os.path.join(BASE_DIR, entry)
        if os.path.isdir(folder_path):
            process_user_folder(folder_path)

if __name__ == "__main__":
    main()
