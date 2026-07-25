import { useState } from "react";
import { generateQuiz } from "../services/quizService";
function QuizPage() {
  const [pdfName, setPdfName] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [quiz, setQuiz] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateQuiz = async () => {
  try {
    setLoading(true);
    setError("");

    const data = await generateQuiz(
      pdfName,
      Number(numQuestions)
    );

    setQuiz(data);
  } catch (err) {
    setError(err.message);
  } finally {
    setLoading(false);
  }
};

  return (
    <div style={{ padding: "30px" }}>
      <h1>📝 Quiz Generator</h1>

      <div style={{ marginTop: "20px" }}>
        <label>PDF Name</label>

        <input
          type="text"
          placeholder="Operating System.pdf"
          value={pdfName}
          onChange={(e) => setPdfName(e.target.value)}
        />
      </div>

      <div style={{ marginTop: "20px" }}>
        <label>Number of Questions</label>

        <input
          type="number"
          value={numQuestions}
          onChange={(e) => setNumQuestions(e.target.value)}
        />
      </div>

      <button onClick={handleGenerateQuiz}>
        {loading ? "Generating..." : "Generate Quiz"}
      </button>

      {error && <p style={{ color: "red" }}>{error}</p>}
      
      {quiz.length > 0 && (
        <pre>
            {JSON.stringify(quiz, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default QuizPage;