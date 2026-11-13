import api from "./api";

// Uses the shared axios client (Bearer token + 401 handling live in api.js).
// The backend scopes every call to the logged-in user; a chat that is not
// theirs looks exactly like a chat that does not exist (404).

const CODES = {
  400: "invalid",
  404: "not_found",
  409: "conflict",
  410: "gone",
  503: "unavailable",
};

/**
 * Turn an axios error into an Error with a stable `code`:
 * "canceled" | "not_found" | "gone" | "conflict" | "unavailable" |
 * "invalid" | "failed" (anything else, including network errors).
 * `message` is the backend's `detail` when it sent one.
 */
export function toGraphError(error, fallbackMessage) {
  if (error?.code === "ERR_CANCELED" || error?.name === "CanceledError") {
    const canceled = new Error("Request canceled");
    canceled.code = "canceled";
    return canceled;
  }

  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;

  const wrapped = new Error(
    typeof detail === "string" && detail ? detail : fallbackMessage
  );
  wrapped.code = CODES[status] || "failed";
  wrapped.status = status;

  return wrapped;
}

/** The merged knowledge graph of a chat, plus the status of each PDF. */
export async function getGraph(chatId, { signal } = {}) {
  try {
    const response = await api.get("/knowledge-graph", {
      params: { chat_id: chatId },
      signal,
    });
    return response.data;
  } catch (error) {
    throw toGraphError(error, "Could not load the mind map.");
  }
}

/** Lightweight per-PDF graph status (used for polling). */
export async function getGraphStatus(chatId, { signal } = {}) {
  try {
    const response = await api.get("/knowledge-graph/status", {
      params: { chat_id: chatId },
      signal,
    });
    return response.data;
  } catch (error) {
    throw toGraphError(error, "Could not check the mind map status.");
  }
}

/**
 * The existing document-queue statuses (same endpoint StudyPilot uses). Needed
 * to tell "PDF is still being indexed" from "graph was never started".
 * Never throws for a normal failure: an unknown queue just means "not busy".
 */
export async function getIndexingJobs(chatId, { signal } = {}) {
  try {
    const response = await api.get("/upload/status", {
      params: { chat_id: chatId },
      signal,
    });
    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    const wrapped = toGraphError(error, "Could not check upload status.");
    if (wrapped.code === "canceled") throw wrapped;
    return [];
  }
}

/** (Re)generate the graph of one PDF. Resolves with the 202 body. */
export async function regenerateGraph(chatId, filename) {
  try {
    const response = await api.post(
      `/knowledge-graph/documents/${encodeURIComponent(filename)}/regenerate`,
      null,
      { params: { chat_id: chatId } }
    );
    return response.data;
  } catch (error) {
    throw toGraphError(error, "Could not start mind map generation.");
  }
}
