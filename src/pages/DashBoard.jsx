// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  const [userId, setUserId] = useState(null);
  const [forms, setForms] = useState([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [newLabelName, setNewLabelName] = useState("");
  const [labelType, setLabelType] = useState("event");
  const [decaySeconds, setDecaySeconds] = useState("");
  const [emaInterval, setEmaInterval] = useState("");

  const [labels, setLabels] = useState([]);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/");
        return;
      }
      setUserId(session.user.id);
      fetchForms();
    };
    init();
  }, []);

  async function fetchForms() {
    const { data } = await supabase
      .from("forms")
      .select("*")
      .order("created_at", { ascending: false });

    setForms(data || []);
  }

  function addLabel() {
    if (!newLabelName.trim()) return;

    if (labelType === "decay" && !decaySeconds) {
      alert("Decay labels require decay time");
      return;
    }

    if (labelType === "ema" && !emaInterval) {
      alert("EMA labels require prompt interval");
      return;
    }

    setLabels([
      ...labels,
      {
        label_name: newLabelName.trim(),
        label_type: labelType,
        decay_seconds: labelType === "decay" ? Number(decaySeconds) : null,
        ema_interval_seconds: labelType === "ema" ? Number(emaInterval) : null
      }
    ]);

    setNewLabelName("");
    setLabelType("event");
    setDecaySeconds("");
    setEmaInterval("");
  }

  async function createForm() {
    if (!title || labels.length === 0) {
      alert("Form title and labels required");
      return;
    }

    const { data: form, error } = await supabase
      .from("forms")
      .insert({ title, description, created_by: userId })
      .select()
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    await supabase.from("labels").insert(
      labels.map(l => ({
        form_id: form.id,
        label_name: l.label_name,
        label_type: l.label_type,
        decay_seconds: l.decay_seconds,
        ema_interval_seconds: l.ema_interval_seconds
      }))
    );

    setTitle("");
    setDescription("");
    setLabels([]);
    fetchForms();
  }

  async function confirmDeleteForm() {
    if (!deleteTarget) return;

    if (confirmText !== deleteTarget.title) {
      alert("Form title does not match");
      return;
    }

    await supabase.from("user_logs").delete().eq("form_id", deleteTarget.id);
    await supabase.from("forms").delete().eq("id", deleteTarget.id);

    setDeleteTarget(null);
    setConfirmText("");
    fetchForms();
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  return (
    <div className="container mt-5">
      <div className="d-flex justify-content-between mb-4">
        <h1>Admin Dashboard</h1>
        <button className="btn btn-outline-danger" onClick={logout}>Logout</button>
      </div>

      <h3>Create Form</h3>

      <input
        className="form-control mb-2"
        placeholder="Form title"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      <textarea
        className="form-control mb-3"
        placeholder="Form description"
        value={description}
        onChange={e => setDescription(e.target.value)}
      />

      <h5>Add Label</h5>

      <input
        className="form-control mb-2"
        placeholder="Label name"
        value={newLabelName}
        onChange={e => setNewLabelName(e.target.value)}
      />

      <select
        className="form-control mb-2"
        value={labelType}
        onChange={e => setLabelType(e.target.value)}
      >
        <option value="event">Instant</option>
        <option value="decay">Decay</option>
        <option value="ema">State (EMA)</option>
      </select>

      {labelType === "decay" && (
        <input
          type="number"
          className="form-control mb-2"
          placeholder="Decay seconds"
          value={decaySeconds}
          onChange={e => setDecaySeconds(e.target.value)}
        />
      )}

      {labelType === "ema" && (
        <input
          type="number"
          className="form-control mb-2"
          placeholder="Prompt interval (seconds)"
          value={emaInterval}
          onChange={e => setEmaInterval(e.target.value)}
        />
      )}

      <button className="btn btn-secondary mb-3" onClick={addLabel}>
        Add Label
      </button>

      <ul>
        {labels.map((l, i) => (
          <li key={i}>
            {l.label_name} — {l.label_type}
          </li>
        ))}
      </ul>

      <button className="btn btn-primary" onClick={createForm}>
        Create Form
      </button>

      <hr />

      <h3>Existing Forms</h3>

      <ul className="list-group">
        {forms.map(f => (
          <li key={f.id} className="list-group-item d-flex justify-content-between">
            {f.title}
            <button
              className="btn btn-sm btn-outline-danger"
              onClick={() => {
                setDeleteTarget(f);
                setConfirmText("");
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      {deleteTarget && (
        <div className="mt-4 border p-3">
          <p>
            Type <strong>{deleteTarget.title}</strong> to confirm deletion
          </p>
          <input
            className="form-control mb-2"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
          />
          <button className="btn btn-danger" onClick={confirmDeleteForm}>
            Delete
          </button>
          <button
            className="btn btn-secondary ms-2"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
