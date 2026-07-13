function ChatMessage({ role, text }) {
  return (
    <div
      className={
        role === "user"
          ? "user-message"
          : "ai-message"
      }
    >
      <strong>
        {role === "user"
          ? "👤 You"
          : "🤖 StudyPilot"}
      </strong>

      <p>{text}</p>
    </div>
  );
}

export default ChatMessage;