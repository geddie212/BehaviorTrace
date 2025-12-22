import { supabase } from "../supabase";
import { useNavigate } from "react-router-dom";

export default function Trace() {
  const navigate = useNavigate();

  async function logout() {
    await supabase.auth.signOut();
    navigate("/");
  }

  return (
    <div className="container mt-5">
      <h1>Trace (Protected Page)</h1>
      <p>You are logged in.</p>

      <button className="btn btn-danger" onClick={logout}>
        Log out
      </button>
    </div>
  );
}
