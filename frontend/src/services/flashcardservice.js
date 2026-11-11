import api from "./api";
import { extractFlashcards } from "../utils/flashcards";

// Uses the shared axios client (Bearer token + 401 handling live in api.js).
export async function generateFlashcards(chatId, pdfName, numFlashcards, { signal } = {}) {
  const response = await api.post(
    "/flashcards/generate",
    {
      chat_id: chatId,
      pdf_name: pdfName || null,
      num_flashcards: numFlashcards,
    },
    { signal }
  );
  return extractFlashcards(response.data);
}
