import "./Sidebar.css";
import SettingsModal from "./SettingsModal";
import logo from "../assets/logo.png";
import { Brain } from "lucide-react";
import { BrainCircuit, ChevronRight } from "lucide-react";
import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import useAuth from "../hooks/useAuth";
import { 
  Plus, 
  MessageSquare, 
  BookOpen, 
  Trash2, 
  Settings, 
  FileText, 
  Layers, 
  User 
} from "lucide-react";

function Sidebar({
  currentUser,
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  uploadedFiles = [],
  selectedPdf,
  onSelectPdf,
  onDeletePdf,
  currentChatId,
}) {

  const [showSettings, setShowSettings] = useState(false);

  const navigate = useNavigate();
  const { logout } = useAuth();
  const handleLogout = () => {
    const confirmLogout = window.confirm(
      "Are you sure you want to logout?"
    );
    if (!confirmLogout) return;
    logout();              // Clears auth state
    setShowSettings(false);
    navigate("/login");
};
  return (
    <div className="sidebar animate-fade-in">
      {/* Brand Header */}
      <div className="sidebar-logo">
        <img
          src={logo}
          alt="StudyPilot AI Logo"
          className="sidebar-logo-img"
        />
        <div className="sidebar-logo-text">
          <h2>StudyPilot AI</h2>
          <p>Intelligent Study Companion</p>
        </div>
      </div>

      {/* User Profile Card */}
      <div className="profile-card">
        <div className="avatar">
          <User size={18} />
        </div>
          
        <div className="profile-info">
          <h3>{currentUser?.name || "Guest User"}</h3>
          <p>{currentUser?.email || "Not signed in"}</p>
        </div>
      </div>

      {/* Action Button */}
      <button className="new-chat-btn" onClick={onCreateConversation}>
        <Plus size={16} />
        <span>New Chat</span>
      </button>

      {/* Navigation & Lists Container */}
      <div className="sidebar-scrollable">
        {/* Recent Chats */}
        <div className="sidebar-section">
          <div className="section-title">
            <MessageSquare size={14} />
            <h4>Recent Chats</h4>
          </div>
          <div className="list-container">
            {conversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              return (
                <div
                  key={conv.id}
                  className={`chat-item-wrapper ${isActive ? "active" : ""}`}
                  onClick={() => onSelectConversation(conv.id)}
                >
                  <div className="chat-item-text">
                    <MessageSquare size={14} className="item-icon" />
                    <span>{conv.title}</span>
                  </div>
                  <button
                    className="delete-item-btn"
                    onClick={(e) => onDeleteConversation(conv.id, e)}
                    title="Delete Conversation"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <NavLink
        to="/quiz"
        state={{ chatId: currentChatId }}
        className="sidebar-quiz-card"
        >
          <div className="quiz-icon-box">
            <BrainCircuit size={22} />
          </div>
          
          <div className="quiz-text">
            <span className="quiz-title">AI Quiz</span>
            <span className="quiz-subtitle">
              Test your understanding
            </span>
          </div>
          <ChevronRight size={18} className="quiz-arrow" />
        </NavLink>

        {/* Study Materials (PDFs) */}
        <div className="sidebar-section">
          <div className="section-title">
            <BookOpen size={14} />
            <h4>Study Materials</h4>
          </div>
          <div className="list-container">
            {/* "All PDFs" Toggle */}
            <div
              className={`pdf-item-wrapper ${selectedPdf === null ? "active" : ""}`}
              onClick={() => onSelectPdf(null)}
            >
              <div className="pdf-item-text">
                <Layers size={14} className="item-icon" />
                <span>All Documents</span>
              </div>
            </div>

            {/* Uploaded PDF List */}
            {uploadedFiles.length === 0 ? (
              <div className="empty-section-text">
                No PDFs uploaded yet.
              </div>
            ) : (
              uploadedFiles.map((pdf, index) => {
                const isSelected = selectedPdf === pdf;
                return (
                  <div
                    key={index}
                    className={`pdf-item-wrapper ${isSelected ? "active" : ""}`}
                    onClick={() => onSelectPdf(pdf)}
                  >
                    <div className="pdf-item-text" title={pdf}>
                      <FileText size={14} className="item-icon" />
                      <span>{pdf}</span>
                    </div>
                    <button
                      className="delete-item-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeletePdf(pdf);
                      }}
                      title="Delete Document"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
          {uploadedFiles.length > 0 && (
            <div className="pdf-count-badge animate-fade-in">
              {uploadedFiles.length} {uploadedFiles.length === 1 ? "PDF" : "PDFs"} Loaded
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Footer */}

      <div className="sidebar-footer">
        <button
        className="settings-btn"
        onClick={() => setShowSettings(true)}
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>

      {
      showSettings && (
        <SettingsModal
        currentUser={currentUser}
        onClose={() => setShowSettings(false)}
        onLogout={handleLogout}
        />
      )
      }
    
    </div>

  );
}

export default Sidebar;