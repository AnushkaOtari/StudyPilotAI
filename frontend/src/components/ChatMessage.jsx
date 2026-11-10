import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import CitationChips from "./CitationChips";

import "highlight.js/styles/github-dark.css";
import "./ChatBox.css";

function ChatMessage({ role, text, citations, onOpenCitation }) {
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

        {!isUser && (
          <CitationChips citations={citations} onOpen={onOpenCitation} />
        )}
      </div>
    </div>
  );
}

export default ChatMessage;