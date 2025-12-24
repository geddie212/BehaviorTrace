import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler() {
  const now = new Date().toISOString();

  const { data: states } = await supabase
    .from("user_states")
    .select("id, user_id, labels(label_name)")
    .eq("active", true)
    .lte("next_prompt_at", now);

  for (const state of states) {
    await fetch(`${process.env.URL}/.netlify/functions/send-ema-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: state.user_id,
        label_name: state.labels.label_name
      })
    });
  }

  return { statusCode: 200 };
}
