import { Send } from "lucide-react";

function ChatInput({
  question,
  setQuestion,
  askQuestion,
  loading,
}) {
  // Listen for Enter (submit) vs Shift+Enter (new line)
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  return (
    <div className="chat-input-container animate-slide-up">
      <textarea
        className="chat-input-textarea"
        rows="1"
        placeholder="Ask anything about your uploaded study notes..."
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={loading}
      />

      <button 
        className="send-btn" 
        onClick={askQuestion}
        disabled={loading || !question.trim()}
        title="Send Question"
      >
        <Send size={16} />
      </button>
    </div>
  );
}

export default ChatInput;