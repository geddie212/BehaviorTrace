import { useState } from "react";
import { supabase } from "../supabase";
import { useNavigate, Link } from "react-router-dom";

export default function AdminAuth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function handleLogin(e) {
    e.preventDefault();
    setError("");

    const { data, error: authError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (authError) return setError(authError.message);

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError) return setError(profileError.message);

    if (!profile || profile.role !== "admin") {
      await supabase.auth.signOut();
      return setError("You do not have administrator access.");
    }

    navigate("/dashboard");
  }

  return (
    <div className="container mt-5" style={{ maxWidth: 400 }}>
      <h1 className="mb-3">Admin Login</h1>

      <form onSubmit={handleLogin}>
        <input
          className="form-control mb-3"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          className="form-control mb-3"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn btn-primary w-100">Log in</button>
      </form>

      {error && <p className="text-danger mt-3">{error}</p>}

      {/* User login link */}
      <div className="text-center mt-3">
        <Link to="/" className="text-decoration-none">
          User login
        </Link>
      </div>
    </div>
  );
}
