import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";

function Register() {
  const navigate = useNavigate();
  const { register, loading } = useAuth();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
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
    if (
      !formData.name.trim() ||
      !formData.email.trim() ||
      !formData.password.trim() ||
      !formData.confirmPassword.trim()
    ) {
      return "All fields are required.";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      return "Please enter a valid email address.";
    }

    if (formData.password !== formData.confirmPassword) {
      return "Passwords do not match.";
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

    const result = await register(formData.name, formData.email, formData.password);
    if (result.success) {
      navigate("/", { replace: true });
      return;
    }

    setError(result.error);
  };

  return (
    <main className="auth-page">
      <form className="auth-card animate-auth" onSubmit={handleSubmit}>
        <div className="auth-heading">
          <p>StudyPilot AI</p>
          <h1>Create account</h1>
          <span>Start a secure workspace for your documents.</span>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          Name
          <input
            name="name"
            type="text"
            value={formData.name}
            onChange={updateField}
            placeholder="Your name"
            autoComplete="name"
          />
        </label>

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
              placeholder="Create a password"
              autoComplete="new-password"
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

        <label className="auth-field">
          Confirm Password
          <input
            name="confirmPassword"
            type={showPassword ? "text" : "password"}
            value={formData.confirmPassword}
            onChange={updateField}
            placeholder="Confirm your password"
            autoComplete="new-password"
          />
        </label>

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </button>

        <p className="auth-switch">
          Already have an account? <Link to="/">Sign in</Link>
        </p>
      </form>
    </main>
  );
}

export default Register;
