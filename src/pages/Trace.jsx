// src/pages/Trace.jsx
import { useState, useEffect } from "react";
import { supabase } from "../supabase";

export default function Trace() {
  const [userId, setUserId] = useState(null);
  const [forms, setForms] = useState([]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      setUserId(session.user.id);

      // Fetch all forms
      const { data: formsData } = await supabase.from("forms").select("*").order("created_at", { ascending: false });
      if (!formsData) return;

      // Fetch labels for each form
      const formIds = formsData.map(f => f.id);
      const { data: labelsData } = await supabase.from("labels").select("*").in("form_id", formIds);

      const formsWithLabels = formsData.map(f => ({
        ...f,
        labels: labelsData.filter(l => l.form_id === f.id)
      }));

      setForms(formsWithLabels);
    };

    init();
  }, []);

  async function logLabel(formId, labelId) {
    if (!userId) return alert("User not loaded");

    const { error } = await supabase.from("user_logs").insert({
      user_id: userId,
      form_id: formId,
      label_id: labelId
    });

    if (error) return alert("Error logging label: " + error.message);
    alert("Label logged successfully!");
  }

  return (
    <div className="container mt-5">
      <h1>Trace Page</h1>

      {forms.map(f => (
        <div key={f.id} className="mb-4">
          <h3>{f.title}</h3>
          <p>{f.description}</p>
          <div className="d-flex flex-wrap gap-2">
            {f.labels.map(l => (
              <button key={l.id} className="btn btn-outline-primary" onClick={() => logLabel(f.id, l.id)}>
                {l.label_name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
