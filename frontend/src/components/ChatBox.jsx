import ChatMessage from "./ChatMessage";

function ChatBox({ messages, loading }) {
  return (
    <div className="chat-box">

      {messages.map((msg, index) => (
        <ChatMessage
          key={index}
          role={msg.role}
          text={msg.text}
        />
      ))}

      {loading && (
        <ChatMessage
          role="assistant"
          text="Thinking..."
        />
      )}

    </div>
  );
}

export default ChatBox;