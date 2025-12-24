import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "web-push";

// Load VAPID keys from environment variables
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:pauliusgedrimas@gmail.com", // change to your email
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

console.info("send-ema-push function started");

Deno.serve(async (req: Request) => {
  // fetch Supabase client
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Get active EMA states that need prompting
  const { data: pendingStates } = await supabase
    .from("user_states")
    .select("id, label_id, next_prompt_at, labels(label_name)")
    .eq("active", true)
    .lte("next_prompt_at", new Date().toISOString());

  if (!pendingStates?.length) {
    return new Response(JSON.stringify({ message: "No pending EMA prompts" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Get push subscriptions
  for (const state of pendingStates) {
    const { data: subscriptions } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", state.user_id);

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify({
          title: "EMA Prompt",
          body: `Do you still feel ${state.labels.label_name}?`,
          data: { stateId: state.id },
        }));
      } catch (err) {
        console.error("Push failed", err);
      }
    }

    // Update next_prompt_at so it doesn’t spam
    await supabase
      .from("user_states")
      .update({ last_prompted_at: new Date() })
      .eq("id", state.id);
  }

  return new Response(JSON.stringify({ message: "EMA notifications sent" }), {
    headers: { "Content-Type": "application/json" },
  });
});
