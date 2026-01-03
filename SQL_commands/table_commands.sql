create table public.profiles (
  id uuid not null,
  role text not null,
  created_at timestamp with time zone null default now(),
  email text null,
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE,
  constraint profiles_role_check check ((role = any (array['user'::text, 'admin'::text])))
);

create table public.forms (
  id serial not null,
  title text not null,
  description text null,
  created_by uuid null,
  created_at timestamp with time zone null default now(),
  constraint forms_pkey primary key (id),
  constraint forms_created_by_fkey foreign KEY (created_by) references auth.users (id)
);

create table public.labels (
  id serial not null,
  form_id integer null,
  label_name text not null,
  created_at timestamp with time zone null default now(),
  label_type text not null default 'event'::text,
  decay_seconds integer null,
  ema_interval_seconds integer null,
  ema_prompt text null,
  constraint labels_pkey primary key (id),
  constraint labels_form_id_fkey foreign KEY (form_id) references forms (id) on delete CASCADE,
  constraint labels_label_type_check check (
    (
      label_type = any (array['event'::text, 'decay'::text, 'ema'::text])
    )
  )
);

create table public.user_logs (
  id serial not null,
  user_id uuid null,
  form_id integer null,
  label_id integer null,
  timestamp timestamp with time zone null default now(),
  constraint user_logs_pkey primary key (id),
  constraint user_logs_form_id_fkey foreign KEY (form_id) references forms (id),
  constraint user_logs_label_id_fkey foreign KEY (label_id) references labels (id),
  constraint user_logs_user_id_fkey foreign KEY (user_id) references auth.users (id)
);

create table public.user_states (
  id serial not null,
  user_id uuid not null,
  form_id integer not null,
  label_id integer not null,
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone null,
  last_prompted_at timestamp with time zone not null default now(),
  last_confirmed_at timestamp with time zone not null default now(),
  active boolean not null default true,
  next_prompt_at timestamp with time zone null,
  constraint user_states_pkey primary key (id),
  constraint user_states_form_id_fkey foreign KEY (form_id) references forms (id) on delete CASCADE,
  constraint user_states_label_id_fkey foreign KEY (label_id) references labels (id) on delete CASCADE,
  constraint user_states_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
);

create table public.users_without_devices (
  id uuid not null,
  email text not null,
  created_at timestamp with time zone null default now(),
  constraint users_without_devices_pkey primary key (id),
  constraint users_without_devices_id_fkey foreign KEY (id) references auth.users (id) on delete CASCADE
);

create table public.emotibit_devices (
  id serial not null,
  user_id uuid not null,
  device_id text not null,
  created_at timestamp with time zone null default now(),
  constraint emotibit_devices_pkey primary key (id),
  constraint emotibit_devices_device_id_key unique (device_id),
  constraint emotibit_devices_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
);

create table public.emotibit_ax (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_ax_pkey primary key (id),
  constraint emotibit_ax_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_ax_device_time_idx on public.emotibit_ax using btree (device_id, recorded_at);

create table public.emotibit_ay (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_ay_pkey primary key (id),
  constraint emotibit_ay_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_ay_device_time_idx on public.emotibit_ay using btree (device_id, recorded_at);

create table public.emotibit_az (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_az_pkey primary key (id),
  constraint emotibit_az_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_az_device_time_idx on public.emotibit_az using btree (device_id, recorded_at);

create table public.emotibit_eda (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_eda_pkey primary key (id),
  constraint emotibit_eda_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_eda_device_time_idx on public.emotibit_eda using btree (device_id, recorded_at);

create table public.emotibit_edl (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_edl_pkey primary key (id),
  constraint emotibit_edl_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_edl_device_time_idx on public.emotibit_edl using btree (device_id, recorded_at);

create table public.emotibit_gyro_x (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_gyro_x_pkey primary key (id),
  constraint emotibit_gyro_x_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_gyro_x_device_time_idx on public.emotibit_gyro_x using btree (device_id, recorded_at);

create table public.emotibit_gyro_y (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_gyro_y_pkey primary key (id),
  constraint emotibit_gyro_y_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_gyro_y_device_time_idx on public.emotibit_gyro_y using btree (device_id, recorded_at);

create table public.emotibit_gyro_z (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_gyro_z_pkey primary key (id),
  constraint emotibit_gyro_z_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_gyro_z_device_time_idx on public.emotibit_gyro_z using btree (device_id, recorded_at);

create table public.emotibit_heart_rate (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_heart_rate_pkey primary key (id),
  constraint emotibit_heart_rate_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_heart_rate_device_time_idx on public.emotibit_heart_rate using btree (device_id, recorded_at);

create table public.emotibit_humidity (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_humidity_pkey primary key (id),
  constraint emotibit_humidity_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_humidity_device_time_idx on public.emotibit_humidity using btree (device_id, recorded_at);

create table public.emotibit_inter_beat (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_inter_beat_pkey primary key (id),
  constraint emotibit_inter_beat_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_inter_beat_device_time_idx on public.emotibit_inter_beat using btree (device_id, recorded_at);

create table public.emotibit_magno_x (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_magno_x_pkey primary key (id),
  constraint emotibit_magno_x_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create table public.emotibit_magno_y (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_magno_y_pkey primary key (id),
  constraint emotibit_magno_y_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_magno_y_device_time_idx on public.emotibit_magno_y using btree (device_id, recorded_at);

create table public.emotibit_magno_z (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_magno_z_pkey primary key (id),
  constraint emotibit_magno_z_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_magno_z_device_time_idx on public.emotibit_magno_z using btree (device_id, recorded_at);

create table public.emotibit_ppg_green (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_ppg_green_pkey primary key (id),
  constraint emotibit_ppg_green_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_ppg_green_device_time_idx on public.emotibit_ppg_green using btree (device_id, recorded_at);

create table public.emotibit_ppg_infrared (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_ppg_infrared_pkey primary key (id),
  constraint emotibit_ppg_infrared_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_ppg_infrared_device_time_idx on public.emotibit_ppg_infrared using btree (device_id, recorded_at);

create table public.emotibit_ppg_red (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_ppg_red_pkey primary key (id),
  constraint emotibit_ppg_red_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_ppg_red_device_time_idx on public.emotibit_ppg_red using btree (device_id, recorded_at);

create table public.emotibit_skin_con_amp (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_skin_con_amp_pkey primary key (id),
  constraint emotibit_skin_con_amp_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_skin_con_amp_device_time_idx on public.emotibit_skin_con_amp using btree (device_id, recorded_at);

create table public.emotibit_skin_con_freq (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_skin_con_freq_pkey primary key (id),
  constraint emotibit_skin_con_freq_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_skin_con_freq_device_time_idx on public.emotibit_skin_con_freq using btree (device_id, recorded_at);

create table public.emotibit_skin_con_rise (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_skin_con_rise_pkey primary key (id),
  constraint emotibit_skin_con_rise_device_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_skin_con_rise_device_time_idx on public.emotibit_skin_con_rise using btree (device_id, recorded_at);

create table public.emotibit_temp (
  id bigserial not null,
  device_id text not null,
  recorded_at timestamp with time zone not null,
  value double precision not null,
  constraint emotibit_temp_pkey primary key (id),
  constraint emotibit_temp_id_fkey foreign KEY (device_id) references emotibit_devices (device_id) on delete CASCADE
);

create index IF not exists emotibit_temp_device_time_idx on public.emotibit_temp using btree (device_id, recorded_at);

