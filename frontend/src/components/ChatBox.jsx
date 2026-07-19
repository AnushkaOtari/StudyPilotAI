import { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage";
import { BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import "highlight.js/styles/github-dark.css";
function ChatBox({ messages = [], loading }) {
  const messagesEndRef = useRef(null);

  // Auto-scroll helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  return (
    <div className="chat-box">
      {messages.length === 0 ? (
        <div className="chat-empty-state">
          <BookOpen className="chat-empty-icon" />
          <h3>Welcome to StudyPilot AI</h3>
          <p>
            Upload study materials (PDFs) in the card above, select them to scope your chat, and ask any questions. StudyPilot will extract answers directly from your notes.
          </p>
        </div>
      ) : (
        messages.map((msg, index) => (
          <ChatMessage
            key={index}
            role={msg.role}
            text={msg.text}
          />
        ))
      )}

      {loading && (
        <div className="message-wrapper assistant">
          <div className="chat-message ai-message">
            <div className="message-sender">
              🤖 StudyPilot
            </div>
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}

export default ChatBox;