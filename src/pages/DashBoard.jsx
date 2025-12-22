// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import { supabase } from "../supabase";

export default function Dashboard() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [labels, setLabels] = useState([]);
  const [forms, setForms] = useState([]);
  const [userId, setUserId] = useState(null);

  // Get current admin ID
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setUserId(session.user.id);
    };
    fetchUser();
    fetchForms();
  }, []);

  // Fetch existing forms
  async function fetchForms() {
    const { data, error } = await supabase.from("forms").select("*").order("created_at", { ascending: false });
    if (error) return console.error("Error fetching forms:", error);
    setForms(data);
  }

  function addLabel() {
    if (newLabel.trim()) {
      setLabels([...labels, newLabel.trim()]);
      setNewLabel("");
    }
  }

  async function createForm() {
    if (!title || !labels.length) return alert("Form title and at least one label required");
    if (!userId) return alert("Admin not loaded yet");

    // Insert into forms table
    const { data: form, error: formError } = await supabase
      .from("forms")
      .insert({
        title,
        description,
        created_by: userId
      })
      .select()
      .single();

    if (formError) return alert("Error creating form: " + formError.message);

    // Insert labels linked to this form
    const { error: labelsError } = await supabase
      .from("labels")
      .insert(labels.map(label_name => ({ form_id: form.id, label_name })));

    if (labelsError) return alert("Error creating labels: " + labelsError.message);

    // Reset inputs
    setTitle("");
    setDescription("");
    setLabels([]);
    fetchForms();
  }

  return (
    <div className="container mt-5">
      <h1>Admin Dashboard</h1>

      <div className="mb-4">
        <h3>Create a New Form</h3>
        <input
          className="form-control mb-2"
          placeholder="Form Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="form-control mb-2"
          placeholder="Form Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        <div className="mb-2">
          <input
            className="form-control mb-2"
            placeholder="Add Label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button className="btn btn-secondary mb-2" onClick={addLabel}>Add Label</button>
        </div>

        <div className="mb-2">
          <strong>Labels:</strong>
          <ul>
            {labels.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>

        <button className="btn btn-primary" onClick={createForm}>Create Form</button>
      </div>

      <div>
        <h3>Existing Forms</h3>
        <ul>
          {forms.map(f => (
            <li key={f.id}>
              <strong>{f.title}</strong> - {f.description || "No description"}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
