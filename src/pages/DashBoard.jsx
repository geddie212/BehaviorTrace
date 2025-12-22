// src/pages/Dashboard.jsx
import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

export default function Dashboard() {
  const navigate = useNavigate();

  async function logout() {
    await supabase.auth.signOut();
    navigate("/admin");
  }

  return (
    <div className="container mt-5">
      <h1>Admin Dashboard</h1>
      <p>Welcome, Admin!</p>
      <button className="btn btn-danger" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
