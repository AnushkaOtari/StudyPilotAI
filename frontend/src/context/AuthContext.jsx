import { createContext, useState, useEffect } from "react";
import api from "../services/api";
import { getToken, setToken, removeToken } from "../utils/token";

export const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setTokenState] = useState(getToken());
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchCurrentUser = async (authToken) => {
    try {
      const response = await api.get("/auth/me", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      setCurrentUser(response.data);
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Failed to restore session:", error);
      removeToken();
      setTokenState(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      removeToken();
      setTokenState(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
    };

    window.addEventListener("studypilot:unauthorized", handleUnauthorized);

    const savedToken = getToken();
    if (savedToken) {
      setTokenState(savedToken);
      fetchCurrentUser(savedToken);
    } else {
      setLoading(false);
    }

    return () => {
      window.removeEventListener("studypilot:unauthorized", handleUnauthorized);
    };
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await api.post("/auth/login", { email, password });
      const { access_token } = response.data;

      setToken(access_token);
      setTokenState(access_token);

      // Fetch user info immediately after login using the new token
      const meResponse = await api.get("/auth/me", {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });

      setCurrentUser(meResponse.data);
      setIsAuthenticated(true);
      return { success: true };
    } catch (error) {
      console.error("Login failed:", error);
      const message =
        error.response?.data?.detail ||
        "Login failed. Please check your credentials.";
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const register = async (name, email, password) => {
    setLoading(true);
    try {
      await api.post("/auth/register", { name, email, password });
      return { success: true };
    } catch (error) {
      console.error("Registration failed:", error);
      let message = "Registration failed.";
      if (error.response?.data?.detail) {
        const detail = error.response.data.detail;
        if (typeof detail === "string") {
          message = detail;
        } else if (Array.isArray(detail) && detail.length > 0) {
          message = detail[0].msg || JSON.stringify(detail);
        } else {
          message = JSON.stringify(detail);
        }
      }
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    removeToken();
    setTokenState(null);
    setCurrentUser(null);
    setIsAuthenticated(false);
  };

  const value = {
    currentUser,
    token,
    isAuthenticated,
    loading,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
