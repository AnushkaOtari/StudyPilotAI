import "./header.css";
import logo from "../assets/logo.png";
import { Layers, FileText, Menu } from "lucide-react";

function Header({ activePdf, onMenuClick, menuOpen = false }) {
  return (
    <header className="header animate-fade-in">
      {onMenuClick && (
        <button
          type="button"
          className="menu-btn"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <Menu size={20} />
        </button>
      )}

      <div className="brand">
        <img
          src={logo}
          alt="StudyPilot AI"
          className="brand-logo"
        />
        <div className="brand-text">
          <h1>
            Study<span>Pilot</span> <span className="ai">AI</span>
          </h1>
        </div>
      </div>

      <div className="scope-badge">
        {activePdf ? (
          <>
            <FileText size={13} className="scope-icon" />
            <span className="scope-label">Focusing: </span>
            <span className="scope-value" title={activePdf}>{activePdf}</span>
          </>
        ) : (
          <>
            <Layers size={13} className="scope-icon" />
            <span className="scope-label">Focusing: </span>
            <span className="scope-value">All Documents</span>
          </>
        )}
      </div>
    </header>
  );
}

export default Header;