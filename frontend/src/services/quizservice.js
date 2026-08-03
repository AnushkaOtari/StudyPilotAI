import api from "./api";

export async function generateQuiz(chat_id, pdf_name, num_questions, difficulty, question_type) {
  const response = await api.post("/quiz/generate", {
    pdf_name: pdf_name || null,
    num_questions,
    chat_id,
    difficulty,
    question_type,
  });
  return response.data;
}

export async function getQuizFeedback(results) {
  const response = await api.post("/quiz/feedback", {
    results,
  });
  return response.data.feedback;
}
