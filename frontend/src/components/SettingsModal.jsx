import "./SettingsModal.css";
import {
  Settings,
  User,
  Info,
  X,
  LogOut,
} from "lucide-react";

function SettingsModal({ currentUser, onClose, onLogout }) {
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="settings-header">
          <h2>
            <Settings size={24} />
            <span>  Settings</span>
          </h2>

          <button
            className="close-icon"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Account */}
        <div className="settings-card">
          <div className="settings-card-title">
            <User size={18} />
            <span>Account</span>
          </div>

          <div className="account-name">
            {currentUser?.name}
          </div>

          <div className="account-email">
            {currentUser?.email}
          </div>
        </div>

        {/* About */}
        <div className="settings-card">
            <div className="settings-card-title">
                <Info size={18} />
                <span>About</span>
            </div>
            <h4 className="about-title">StudyPilot AI</h4>
            <p className="about-description">
                AI-powered study companion
            </p>
            <p className="about-version">
                Version 1.0
            </p>
        </div>

        {/* Logout */}
        <button
          className="logout-btn"
          onClick={onLogout}
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>

      </div>
    </div>
  );
}

export default SettingsModal;