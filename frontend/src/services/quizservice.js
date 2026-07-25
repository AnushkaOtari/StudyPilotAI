const API_URL = "http://127.0.0.1:8000";

export async function generateQuiz(pdf_name, num_questions) {
  const token = localStorage.getItem("token");

  const response = await fetch(`${API_URL}/quiz/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      pdf_name,
      num_questions,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate quiz");
  }

  return await response.json();
}