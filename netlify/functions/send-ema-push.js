import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  "mailto:paulged@icloud.com",
  process.env.VITE_VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function handler(event) {
  const { user_id, label_name } = JSON.parse(event.body);

  const { data: sub } = await supabase
    .from("push_subscriptions")
    .select("subscription")
    .eq("user_id", user_id)
    .single();

  if (!sub) {
    return { statusCode: 404 };
  }

  const payload = JSON.stringify({
    title: "Behavior Check",
    body: `Are you still feeling ${label_name}?`,
    url: "/trace"
  });

  await webpush.sendNotification(sub.subscription, payload);

  return {
    statusCode: 200,
    body: "sent"
  };
}
