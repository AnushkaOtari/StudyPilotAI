const API_URL = "http://127.0.0.1:8000";

export async function generateQuiz(chat_id, pdf_name, num_questions, difficulty, question_type) {
  const token = localStorage.getItem("token");

  const response = await fetch(`${API_URL}/quiz/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      pdf_name: pdf_name || null,
      num_questions,
      chat_id,
      difficulty,
      question_type,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate quiz");
  }

  return await response.json();
}

export async function getQuizFeedback(results) {
  const token = localStorage.getItem("token");

  const response = await fetch(`${API_URL}/quiz/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      results,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate performance feedback");
  }

  const data = await response.json();
  return data.feedback;
}