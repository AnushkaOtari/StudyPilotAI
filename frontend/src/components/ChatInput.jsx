function ChatInput({
  question,
  setQuestion,
  askQuestion,
}) {
  return (
    <div className="chat-input">

      <textarea
        rows="2"
        placeholder="Ask anything from your uploaded notes..."
        value={question}
        onChange={(e) =>
          setQuestion(e.target.value)
        }
      />

      <button onClick={askQuestion}>
        ➜
      </button>

    </div>
  );
}

export default ChatInput;