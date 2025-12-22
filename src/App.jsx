// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Auth from "./pages/Auth";
import Trace from "./pages/Trace";
import AdminAuth from "./pages/AdminAuth";
import Dashboard from "./pages/DashBoard";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminProtectedRoute from "./components/AdminProtectedRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Normal users */}
        <Route path="/" element={<Auth />} />
        <Route
          path="/trace"
          element={
            <ProtectedRoute>
              <Trace />
            </ProtectedRoute>
          }
        />

        {/* Admin */}
        <Route path="/admin" element={<AdminAuth />} />
        <Route
          path="/dashboard"
          element={
            <AdminProtectedRoute>
              <Dashboard />
            </AdminProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
