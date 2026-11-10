import api from "./api";

/**
 * Download one PDF of a chat as bytes. The backend only serves a PDF to the
 * logged-in user who owns the chat (GET /files/{filename}?chat_id=...).
 *
 * Throws an Error whose `code` is "not_found" (deleted or never existed in
 * this chat), "invalid" (rejected request) or "failed" (anything else).
 */
export async function fetchChatPdf(chatId, filename) {
  try {
    const response = await api.get(`/files/${encodeURIComponent(filename)}`, {
      params: { chat_id: chatId },
      responseType: "arraybuffer",
    });
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const wrapped = new Error(`Could not load ${filename}`);
    wrapped.code = status === 404 ? "not_found" : status === 400 ? "invalid" : "failed";
    throw wrapped;
  }
}
