// src/pages/Trace.jsx
import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

export default function Trace() {
  const navigate = useNavigate();

  const [userId, setUserId] = useState(null);
  const [forms, setForms] = useState([]);
  const [successMessage, setSuccessMessage] = useState("");

  // EMA state
  const [emaPrompt, setEmaPrompt] = useState(null);
  const emaTimerRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }

      setUserId(session.user.id);

      const { data: formsData } = await supabase
        .from("forms")
        .select("*")
        .order("created_at", { ascending: false });

      const formIds = formsData.map(f => f.id);

      const { data: labelsData } = await supabase
        .from("labels")
        .select("*")
        .in("form_id", formIds);

      setForms(
        formsData.map(f => ({
          ...f,
          labels: labelsData.filter(l => l.form_id === f.id)
        }))
      );
    };

    init();

    return () => clearTimeout(emaTimerRef.current);
  }, []);

  function scheduleEmaPrompt(state, label) {
    clearTimeout(emaTimerRef.current);

    emaTimerRef.current = setTimeout(() => {
      setEmaPrompt({ state, label });
    }, label.ema_interval_seconds * 1000);
  }

  async function logLabel(formId, label) {
    // EVENT / DECAY
    if (label.label_type !== "ema") {
      await supabase.from("user_logs").insert({
        user_id: userId,
        form_id: formId,
        label_id: label.id
      });

      setSuccessMessage(`Logged "${label.label_name}"`);
      setTimeout(() => setSuccessMessage(""), 2000);
      return;
    }

    // EMA
    const { data: existing } = await supabase
      .from("user_states")
      .select("*")
      .eq("user_id", userId)
      .eq("label_id", label.id)
      .eq("active", true)
      .maybeSingle();

    if (!existing) {
      const { data: newState } = await supabase
        .from("user_states")
        .insert({
          user_id: userId,
          form_id: formId,
          label_id: label.id
        })
        .select()
        .single();

      setSuccessMessage(`Started "${label.label_name}"`);
      scheduleEmaPrompt(newState, label);
    }

    setTimeout(() => setSuccessMessage(""), 2000);
  }

  async function handleEmaResponse(answer) {
    const { state, label } = emaPrompt;

    if (answer === "yes") {
      await supabase
        .from("user_states")
        .update({ last_confirmed_at: new Date() })
        .eq("id", state.id);

      scheduleEmaPrompt(state, label);
    } else {
      await supabase
        .from("user_states")
        .update({
          active: false,
          ended_at: new Date()
        })
        .eq("id", state.id);
    }

    setEmaPrompt(null);
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  function buttonStyle(label) {
    if (label.label_type === "decay") return "btn-outline-warning";
    if (label.label_type === "ema") return "btn-outline-info";
    return "btn-outline-primary";
  }

  return (
    <div className="container mt-5">
      <div className="d-flex justify-content-between mb-4">
        <h1>Trace</h1>
        <button className="btn btn-outline-danger" onClick={logout}>
          Logout
        </button>
      </div>

      {successMessage && (
        <div className="alert alert-success">{successMessage}</div>
      )}

      {forms.map(f => (
        <div key={f.id} className="mb-4">
          <h3>{f.title}</h3>
          <p>{f.description}</p>

          <div className="d-flex flex-wrap gap-2">
            {f.labels.map(l => (
              <button
                key={l.id}
                className={`btn ${buttonStyle(l)}`}
                onClick={() => logLabel(f.id, l)}
              >
                {l.label_name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* EMA PROMPT MODAL */}
      {emaPrompt && (
        <div className="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50 d-flex align-items-center justify-content-center">
          <div className="bg-white p-4 rounded">
            <h5>
              Do you still feel <strong>{emaPrompt.label.label_name}</strong>?
            </h5>

            <div className="mt-3 d-flex gap-2">
              <button
                className="btn btn-success"
                onClick={() => handleEmaResponse("yes")}
              >
                Yes
              </button>
              <button
                className="btn btn-danger"
                onClick={() => handleEmaResponse("no")}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
