import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { generateQuiz, getQuizFeedback } from "../services/quizService";
import { ArrowLeft, Play, RefreshCw, Award, CheckCircle, XCircle, HelpCircle, Loader } from "lucide-react";
import "./QuizPage.css";

function QuizPage() {
  const location = useLocation();
  const chatId = location.state?.chatId;

  // State variables
  const [mode, setMode] = useState("config"); // 'config' | 'attempt' | 'result'
  const [pdfName, setPdfName] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [questionType, setQuestionType] = useState("mixed");

  const [availablePdfs, setAvailablePdfs] = useState([]);
  const [loadingPdfs, setLoadingPdfs] = useState(true);

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // { [index]: answer }
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch available PDFs in this chat on mount
  useEffect(() => {
    const fetchPdfs = async () => {
      if (!chatId) {
        setLoadingPdfs(false);
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:8000/files?chat_id=${chatId}`);
        if (response.ok) {
          const files = await response.json();
          setAvailablePdfs(files);
        } else {
          console.error("Failed to fetch PDFs from backend");
        }
      } catch (err) {
        console.error("Error fetching PDFs:", err);
      } finally {
        setLoadingPdfs(false);
      }
    };
    fetchPdfs();
  }, [chatId]);

  const handleGenerateQuiz = async () => {
    try {
      setLoading(true);
      setError("");
      setQuestions([]);
      setAnswers({});
      setCurrentIndex(0);

      const data = await generateQuiz(
        chatId,
        pdfName,
        Number(numQuestions),
        difficulty,
        questionType
      );

      if (data.error) {
        setError(data.error);
        return;
      }

      setQuestions(data);
      setStartTime(Date.now());
      setMode("attempt");
    } catch (err) {
      setError(err.message || "Failed to generate quiz. Please ensure the study assistant backend is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = (ans) => {
    setAnswers((prev) => ({
      ...prev,
      [currentIndex]: ans,
    }));
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleFinish = async () => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    setElapsedTime(elapsed);
    setMode("result");

    // Calculate results for feedback
    const scoredQuestions = questions.map((q, idx) => {
      const userAns = answers[idx];
      let isCorrect = false;

      if (q.type === "mcq") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      } else if (q.type === "true_false") {
        isCorrect = userAns === q.correct_answer;
      } else if (q.type === "fill_blank") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      }

      return {
        question: q.question,
        topic: q.topic || "General",
        correct_answer: String(q.correct_answer),
        user_answer: userAns !== undefined ? String(userAns) : "(No Answer)",
        is_correct: isCorrect,
      };
    });

    // Fetch AI performance feedback
    setFeedbackLoading(true);
    try {
      const feedbackData = await getQuizFeedback(scoredQuestions);
      setFeedback(feedbackData);
    } catch (err) {
      console.error(err);
      setFeedback("Failed to fetch performance feedback. Continue reviewing your materials!");
    } finally {
      setFeedbackLoading(false);
    }
  };

  const getResultsSummary = () => {
    let correctCount = 0;
    questions.forEach((q, idx) => {
      const userAns = answers[idx];
      let isCorrect = false;
      if (q.type === "mcq") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      } else if (q.type === "true_false") {
        isCorrect = userAns === q.correct_answer;
      } else if (q.type === "fill_blank") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      }
      if (isCorrect) correctCount++;
    });

    const percentage = Math.round((correctCount / questions.length) * 100);
    return {
      correct: correctCount,
      wrong: questions.length - correctCount,
      percentage,
      total: questions.length,
    };
  };

  const handleRetryIncorrect = () => {
    // Filter questions to only the ones that were incorrect
    const incorrectQuestions = questions.filter((q, idx) => {
      const userAns = answers[idx];
      let isCorrect = false;
      if (q.type === "mcq") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      } else if (q.type === "true_false") {
        isCorrect = userAns === q.correct_answer;
      } else if (q.type === "fill_blank") {
        isCorrect = String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
      }
      return !isCorrect;
    });

    setQuestions(incorrectQuestions);
    setAnswers({});
    setCurrentIndex(0);
    setStartTime(Date.now());
    setMode("attempt");
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Helper check for RAG correctness
  const isQuestionCorrect = (q, idx) => {
    const userAns = answers[idx];
    if (q.type === "mcq") {
      return String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
    } else if (q.type === "true_false") {
      return userAns === q.correct_answer;
    } else if (q.type === "fill_blank") {
      return String(userAns || "").trim().toLowerCase() === String(q.correct_answer || "").trim().toLowerCase();
    }
    return false;
  };

  // Render logic

  // If chatId is not provided (e.g. accessing route directly), show friendly warning
  if (!chatId) {
    return (
      <div className="quiz-page-container">
        <div className="quiz-card animate-fade-in">
          <div className="quiz-header">
            <h1 className="quiz-title">📝 StudyPilot Quiz</h1>
            <Link to="/chat" className="back-link">Return to Chat</Link>
          </div>
          <div className="error-banner" style={{ marginTop: "20px" }}>
            No active chat session detected. Please open a chat session first, then click on the "Quiz" link to generate quizzes from that chat's documents.
          </div>
          <Link to="/chat" className="btn-primary" style={{ textDecoration: "none" }}>
            <ArrowLeft size={16} /> Go to Chat
          </Link>
        </div>
      </div>
    );
  }

  // 1. Loading Screen
  if (loading) {
    return (
      <div className="quiz-page-container">
        <div className="quiz-card animate-fade-in">
          <div className="loading-container">
            <div className="spinner"></div>
            <h2 className="quiz-title">Generating your personalized quiz...</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Analyzing study materials and crafting custom questions based strictly on your PDF context...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Configuration Screen
  if (mode === "config") {
    const hasPdfs = availablePdfs.length > 0;

    return (
      <div className="quiz-page-container">
        <div className="quiz-card animate-slide-up">
          <div className="quiz-header">
            <h1 className="quiz-title">📝 StudyPilot Quiz Generator</h1>
            <Link to="/chat" className="back-link">
              <ArrowLeft size={14} style={{ marginRight: "4px", verticalAlign: "middle" }} />
              Back to Chat
            </Link>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {loadingPdfs ? (
            <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "center", padding: "40px" }}>
              <div className="spinner" style={{ width: "20px", height: "20px" }}></div>
              <span>Checking document library...</span>
            </div>
          ) : (
            <>
              {!hasPdfs && (
                <div className="error-banner">
                  No PDFs uploaded in this chat workspace. Please upload at least one PDF to get started with the quiz system.
                </div>
              )}

              <div className="config-group">
                <label className="config-label">Select Study Document</label>
                <select
                  className="config-select"
                  value={pdfName}
                  onChange={(e) => setPdfName(e.target.value)}
                  disabled={!hasPdfs}
                >
                  <option value="">All Documents (Active Chat)</option>
                  {availablePdfs.map((pdf, idx) => (
                    <option key={idx} value={pdf}>
                      {pdf}
                    </option>
                  ))}
                </select>
              </div>

              <div className="config-group">
                <label className="config-label">Number of Questions</label>
                <select
                  className="config-select"
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(e.target.value)}
                  disabled={!hasPdfs}
                >
                  <option value={5}>5 Questions</option>
                  <option value={10}>10 Questions</option>
                  <option value={20}>20 Questions</option>
                </select>
              </div>

              <div className="config-group">
                <label className="config-label">Difficulty Level</label>
                <select
                  className="config-select"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  disabled={!hasPdfs}
                >
                  <option value="mixed">Mixed Difficulty</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>

              <div className="config-group">
                <label className="config-label">Question Type</label>
                <select
                  className="config-select"
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value)}
                  disabled={!hasPdfs}
                >
                  <option value="mixed">Mixed Types (MCQ, T/F, Blank Fill)</option>
                  <option value="mcq">Multiple Choice Questions (MCQ)</option>
                  <option value="true_false">True / False</option>
                  <option value="fill_blank">Fill in the blanks</option>
                </select>
              </div>

              <button
                className="btn-primary"
                onClick={handleGenerateQuiz}
                disabled={!hasPdfs || loading}
                style={{ marginTop: "12px" }}
              >
                <Play size={16} /> Generate Quiz
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // 3. Attempt Screen
  if (mode === "attempt") {
    const currentQuestion = questions[currentIndex];
    const userAns = answers[currentIndex];
    const isFirst = currentIndex === 0;
    const isLast = currentIndex === questions.length - 1;

    // Progress bar percent
    const progressPercent = Math.round(((currentIndex + 1) / questions.length) * 100);

    return (
      <div className="quiz-page-container">
        <div className="quiz-card animate-slide-up">
          <div className="quiz-header">
            <h1 className="quiz-title">StudyPilot Quiz</h1>
            <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-muted)" }}>
              Question {currentIndex + 1} of {questions.length}
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: "4px", width: "100%", background: "var(--border-color)", borderRadius: "2px", marginBottom: "20px", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progressPercent}%`, background: "var(--accent)", transition: "width 0.3s ease" }}></div>
          </div>

          <div className="question-meta">
            <span className="badge badge-info">{currentQuestion.topic || "Concept"}</span>
            <span className="badge badge-secondary">{currentQuestion.difficulty || "medium"}</span>
            <span className="badge badge-secondary" style={{ textTransform: "none" }}>{currentQuestion.type === "mcq" ? "MCQ" : currentQuestion.type === "true_false" ? "True/False" : "Fill the Blank"}</span>
          </div>

          <h2 className="question-text">{currentQuestion.question}</h2>

          {/* Render inputs based on question type */}
          {currentQuestion.type === "mcq" && (
            <div className="options-list">
              {currentQuestion.options?.map((option, idx) => (
                <button
                  key={idx}
                  className={`option-btn ${userAns === option ? "selected" : ""}`}
                  onClick={() => handleSelectAnswer(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {currentQuestion.type === "true_false" && (
            <div className="tf-container">
              <button
                className={`tf-btn ${userAns === true ? "selected" : ""}`}
                onClick={() => handleSelectAnswer(true)}
              >
                True
              </button>
              <button
                className={`tf-btn ${userAns === false ? "selected" : ""}`}
                onClick={() => handleSelectAnswer(false)}
              >
                False
              </button>
            </div>
          )}

          {currentQuestion.type === "fill_blank" && (
            <input
              type="text"
              className="blank-input"
              placeholder="Type your answer here..."
              value={userAns || ""}
              onChange={(e) => handleSelectAnswer(e.target.value)}
            />
          )}

          <div className="quiz-footer">
            <button
              className="btn-secondary"
              onClick={handlePrevious}
              disabled={isFirst}
            >
              Previous
            </button>

            {isLast ? (
              <button className="btn-primary" style={{ width: "auto" }} onClick={handleFinish}>
                Finish Quiz
              </button>
            ) : (
              <button className="btn-secondary" onClick={handleNext}>
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 4. Result Screen
  if (mode === "result") {
    const summary = getResultsSummary();
    const passed = summary.percentage >= 60;

    return (
      <div className="quiz-page-container">
        <div className="quiz-card animate-slide-up" style={{ maxWidth: "800px" }}>
          <div className="quiz-header">
            <h1 className="quiz-title">Quiz Results</h1>
            <span className={`badge ${passed ? "badge-info" : "badge-secondary"}`}>
              {passed ? "Passed" : "Needs Review"}
            </span>
          </div>

          <div className="results-grid">
            <div className="result-stat-card">
              <div className="review-label">Score</div>
              <div className={`result-stat-val ${passed ? "success" : "fail"}`}>
                {summary.correct} / {summary.total}
              </div>
            </div>
            <div className="result-stat-card">
              <div className="review-label">Percentage</div>
              <div className={`result-stat-val ${passed ? "success" : "fail"}`}>
                {summary.percentage}%
              </div>
            </div>
            <div className="result-stat-card">
              <div className="review-label">Wrong Answers</div>
              <div className="result-stat-val" style={{ color: "var(--danger)" }}>
                {summary.wrong}
              </div>
            </div>
            <div className="result-stat-card">
              <div className="review-label">Time Taken</div>
              <div className="result-stat-val" style={{ color: "var(--text-main)" }}>
                {formatTime(elapsedTime)}
              </div>
            </div>
          </div>

          {/* AI Feedback Card */}
          <div className="feedback-card">
            <h3 className="feedback-title">
              <Award size={18} /> Performance Assessment
            </h3>
            {feedbackLoading ? (
              <div style={{ display: "flex", gap: "8px", alignItems: "center", padding: "10px 0" }}>
                <Loader className="animate-spin" size={16} />
                <span style={{ fontSize: "14px", color: "var(--text-muted)" }}>Generating custom assessment feedback...</span>
              </div>
            ) : (
              <p className="feedback-text">{feedback}</p>
            )}
          </div>

          {/* Review of Questions */}
          <h3 style={{ margin: "24px 0 16px", fontFamily: "var(--font-display)" }}>Question Review</h3>
          <div>
            {questions.map((q, idx) => {
              const correct = isQuestionCorrect(q, idx);
              const userAns = answers[idx];

              return (
                <div key={idx} className={`question-review-item ${correct ? "correct" : "incorrect"}`}>
                  <div className="question-meta" style={{ marginBottom: "12px" }}>
                    <span className="badge badge-info">{q.topic || "Concept"}</span>
                    <span className="badge badge-secondary">{q.difficulty || "medium"}</span>
                    <span className="badge badge-secondary" style={{ textTransform: "none" }}>
                      {q.type === "mcq" ? "MCQ" : q.type === "true_false" ? "True/False" : "Fill the Blank"}
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px", fontSize: "13px", fontWeight: "600", color: correct ? "#10B981" : "var(--danger)" }}>
                      {correct ? <CheckCircle size={15} /> : <XCircle size={15} />}
                      {correct ? "Correct" : "Incorrect"}
                    </span>
                  </div>

                  <div className="review-label">Question {idx + 1}</div>
                  <div className="review-value" style={{ fontWeight: "600", fontSize: "15px" }}>{q.question}</div>

                  <div className="review-label">Your Answer</div>
                  <div className={`review-value ${correct ? "correct-val" : "incorrect-val"}`}>
                    {userAns === undefined ? "(No Answer)" : userAns === true ? "True" : userAns === false ? "False" : String(userAns)}
                  </div>

                  {!correct && (
                    <>
                      <div className="review-label">Correct Answer</div>
                      <div className="review-value correct-val">
                        {q.correct_answer === true ? "True" : q.correct_answer === false ? "False" : String(q.correct_answer)}
                      </div>
                    </>
                  )}

                  <div className="review-label">Explanation</div>
                  <div className="review-exp">{q.explanation}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
            {summary.wrong > 0 && (
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleRetryIncorrect}>
                <RefreshCw size={16} /> Retry Incorrect Questions
              </button>
            )}
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setMode("config")}>
              Generate New Quiz
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default QuizPage;