import { Routes, Route, Navigate } from "react-router-dom";
import QuizPage from "./pages/QuizPage";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import StudyPilot from "./pages/StudyPilot.jsx";

import ProtectedRoute from "./components/ProtectedRoute.jsx";
import { useAuth } from "./hooks/useAuth";

function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          background: "#FFFDF5",
          color: "#111111",
          fontFamily: "'Lancelot', serif",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "15px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              border: "3px solid #E9E4D5",
              borderTop: "3px solid #F8E7A1",
              borderRadius: "50%",
              animation: "spin 0.9s linear infinite",
            }}
          />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/chat" replace />
          ) : (
            <Login />
          )
        }
      />

      <Route
        path="/register"
        element={
          isAuthenticated ? (
            <Navigate to="/chat" replace />
          ) : (
            <Register />
          )
        }
      />

      <Route
        path="/chat"
        element={
          <ProtectedRoute>
            <StudyPilot />
          </ProtectedRoute>
        }
      />

      <Route
        path="/quiz"
        element={
          <ProtectedRoute>
            <QuizPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="*"
        element={<Navigate to="/" replace />}
      />
    </Routes>
  );
}

export default App;