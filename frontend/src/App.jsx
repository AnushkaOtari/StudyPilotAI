import { useState } from "react";

function App() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const askQuestion = async () => {
    const response = await fetch(
      "http://127.0.0.1:8000/ask",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: question,
        }),
      }
    );

    const data = await response.json();

    setAnswer(data.answer);
  };

  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "50px auto",
        padding: "20px",
      }}
    >
      <h1>StudyPilot AI</h1>

      <textarea
        rows="4"
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

      <div
        style={{
          marginTop: "30px",
          padding: "20px",
          border: "1px solid gray",
        }}
      >
        <h3>Answer</h3>

        <p>{answer}</p>
      </div>
    </div>
  );
}

export default App;