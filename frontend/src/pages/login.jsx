import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";

function Login() {
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const updateField = (event) => {
    setFormData((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  };

  const validateForm = () => {
    if (!formData.email.trim() || !formData.password.trim()) {
      return "Email and password are required.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      return "Please enter a valid email address.";
    }

    return "";
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    const result = await login(formData.email, formData.password);
    if (result.success) {
      navigate("/chat", { replace: true });
      return;
    }

    setError(result.error);
  };

  return (
    <main className="auth-page">
      <form className="auth-card animate-auth" onSubmit={handleSubmit}>
        <div className="auth-heading">
          <p>StudyPilot AI</p>
          <h1>Welcome back</h1>
          <span>Sign in to continue your study session.</span>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          Email
          <input
            name="email"
            type="email"
            value={formData.email}
            onChange={updateField}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>

        <label className="auth-field">
          Password
          <div className="password-field">
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={updateField}
              placeholder="Enter your password"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>

        <p className="auth-switch">
          New to StudyPilot? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </main>
  );
}

export default Login;
