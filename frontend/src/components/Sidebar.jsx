import "./Sidebar.css";
import logo from "../assets/logo.png";
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
  conversations = [],
  activeConversationId,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  uploadedFiles = [],
  selectedPdf,
  onSelectPdf,
  onDeletePdf,
}) {
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
          <h3>Anushka Otari</h3>
          <p>Diploma AIML Student</p>
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
        <div className="settings-btn">
          <Settings size={16} />
          <span>Settings</span>
        </div>
      </div>
    </div>
  );
}

export default Sidebar;