import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function Trace() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [forms, setForms] = useState([]);
  const [emaPrompt, setEmaPrompt] = useState(null);

  useEffect(() => {
    init();
  }, []);

  async function init() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      navigate("/");
      return;
    }
    setUser(data.session.user);

    await loadForms();
    await checkEma();
  }

  async function enablePush() {
    const reg = await navigator.serviceWorker.register("/sw.js");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          import.meta.env.VITE_VAPID_PUBLIC_KEY
        )
      }));

    await supabase.from("push_subscriptions").upsert({
      user_id: user.id,
      subscription: sub
    });
  }

  async function loadForms() {
    const { data: forms } = await supabase.from("forms").select("*, labels(*)");
    setForms(forms);
  }

  async function checkEma() {
    const { data } = await supabase
      .from("user_states")
      .select("*, labels(*)")
      .eq("user_id", user.id)
      .eq("active", true)
      .lte("next_prompt_at", new Date().toISOString())
      .maybeSingle();

    if (data) setEmaPrompt(data);
  }

  async function respond(answer) {
    if (answer === "yes") {
      await supabase.from("user_states").update({
        next_prompt_at: new Date(
          Date.now() + emaPrompt.labels.ema_interval_seconds * 1000
        )
      }).eq("id", emaPrompt.id);
    } else {
      await supabase.from("user_states").update({
        active: false,
        ended_at: new Date()
      }).eq("id", emaPrompt.id);
    }
    setEmaPrompt(null);
  }

  return (
    <div className="container mt-5">
      <button className="btn btn-primary mb-3" onClick={enablePush}>
        Enable Notifications
      </button>

      {forms.map((f) => (
        <div key={f.id}>
          <h3>{f.title}</h3>
          {f.labels.map((l) => (
            <button key={l.id} className="btn btn-outline-info me-2">
              {l.label_name}
            </button>
          ))}
        </div>
      ))}

      {emaPrompt && (
        <div className="modal show d-block bg-dark bg-opacity-50">
          <div className="modal-dialog">
            <div className="modal-content p-3">
              <h5>
                Still feeling {emaPrompt.labels.label_name}?
              </h5>
              <button className="btn btn-success" onClick={() => respond("yes")}>
                Yes
              </button>
              <button className="btn btn-danger" onClick={() => respond("no")}>
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
