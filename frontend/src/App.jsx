import { useState } from "react";

function App() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const askQuestion = async () => {
    if (!question.trim()) return;

    const userQuestion = question;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userQuestion,
      },
    ]);

    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/ask",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: userQuestion,
          }),
        }
      );

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Something went wrong.",
        },
      ]);
    }

    setLoading(false);
  };

  return (
    <div
      style={{
        maxWidth: "900px",
        margin: "20px auto",
        padding: "20px",
      }}
    >
      <h1>🎓 StudyPilot AI</h1>

      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "10px",
          padding: "20px",
          minHeight: "400px",
          marginBottom: "20px",
        }}
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              marginBottom: "15px",
            }}
          >
            <strong>
              {msg.role === "user"
                ? "You"
                : "StudyPilot"}
            </strong>

            <p>{msg.text}</p>
          </div>
        ))}

        {loading && (
          <p>
            <strong>StudyPilot:</strong> Thinking...
          </p>
        )}
      </div>

      <textarea
        rows="3"
        style={{
          width: "100%",
          padding: "10px",
        }}
        placeholder="Ask a question..."
        value={question}
        onChange={(e) =>
          setQuestion(e.target.value)
        }
      />

      <br />
      <br />

      <button onClick={askQuestion}>
        Ask
      </button>
    </div>
  );
}

export default App;