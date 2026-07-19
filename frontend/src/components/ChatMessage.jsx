import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import "highlight.js/styles/github-dark.css";

function ChatMessage({ role, text }) {
  const isUser = role === "user";

  return (
    <div className={`message-wrapper ${isUser ? "user" : "assistant"}`}>
      <div
        className={`chat-message ${
          isUser ? "user-message" : "ai-message"
        }`}
      >
        <div className="message-sender">
          {isUser ? "👤 You" : "🤖 StudyPilot"}
        </div>

        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

export default ChatMessage;