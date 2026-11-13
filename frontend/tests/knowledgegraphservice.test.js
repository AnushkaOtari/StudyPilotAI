import { describe, it, expect, vi, beforeEach } from "vitest";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../src/services/api", () => ({ default: apiMock }));

import {
  getGraph,
  getGraphStatus,
  getIndexingJobs,
  regenerateGraph,
  toGraphError,
} from "../src/services/knowledgegraphservice";

const httpError = (status, detail) => ({
  response: { status, data: detail === undefined ? {} : { detail } },
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

describe("knowledge graph service", () => {
  it("getGraph uses the shared api client with chat_id and the abort signal", async () => {
    apiMock.get.mockResolvedValueOnce({ data: { nodes: [], edges: [] } });
    const controller = new AbortController();

    const result = await getGraph("chat-1", { signal: controller.signal });

    expect(result).toEqual({ nodes: [], edges: [] });
    expect(apiMock.get).toHaveBeenCalledWith("/knowledge-graph", {
      params: { chat_id: "chat-1" },
      signal: controller.signal,
    });
  });

  it("getGraphStatus calls the status endpoint", async () => {
    apiMock.get.mockResolvedValueOnce({ data: { status: "COMPLETED", documents: [] } });

    expect((await getGraphStatus("c")).status).toBe("COMPLETED");
    expect(apiMock.get.mock.calls[0][0]).toBe("/knowledge-graph/status");
    expect(apiMock.get.mock.calls[0][1].params).toEqual({ chat_id: "c" });
  });

  it.each([
    [400, "invalid"],
    [404, "not_found"],
    [409, "conflict"],
    [410, "gone"],
    [503, "unavailable"],
    [500, "failed"],
    [undefined, "failed"],
  ])("maps HTTP %s to code %s", async (status, code) => {
    apiMock.get.mockRejectedValueOnce(status ? httpError(status) : new Error("Network Error"));

    await expect(getGraph("c")).rejects.toMatchObject({ code });
  });

  it("uses the backend's detail message when there is one, else a fallback", async () => {
    apiMock.get.mockRejectedValueOnce(httpError(404, "Chat not found."));
    await expect(getGraph("c")).rejects.toThrow("Chat not found.");

    apiMock.get.mockRejectedValueOnce(httpError(500));
    await expect(getGraph("c")).rejects.toThrow("Could not load the mind map.");

    // FastAPI validation errors send a list; never show "[object Object]".
    apiMock.get.mockRejectedValueOnce(httpError(422, [{ msg: "bad" }]));
    await expect(getGraph("c")).rejects.toThrow("Could not load the mind map.");
  });

  it("reports a canceled request as code 'canceled'", async () => {
    apiMock.get.mockRejectedValueOnce({ code: "ERR_CANCELED", name: "CanceledError" });

    await expect(getGraph("c")).rejects.toMatchObject({ code: "canceled" });
    expect(toGraphError({ name: "CanceledError" }, "x").code).toBe("canceled");
  });

  describe("getIndexingJobs (existing /upload/status)", () => {
    it("returns the jobs", async () => {
      apiMock.get.mockResolvedValueOnce({ data: [{ filename: "a.pdf", status: "WAITING" }] });

      expect(await getIndexingJobs("c")).toEqual([{ filename: "a.pdf", status: "WAITING" }]);
      expect(apiMock.get.mock.calls[0][0]).toBe("/upload/status");
    });

    it("treats a failure or an odd response as 'no jobs' instead of throwing", async () => {
      apiMock.get.mockRejectedValueOnce(httpError(500));
      expect(await getIndexingJobs("c")).toEqual([]);

      apiMock.get.mockResolvedValueOnce({ data: { not: "a list" } });
      expect(await getIndexingJobs("c")).toEqual([]);
    });

    it("still propagates cancellation", async () => {
      apiMock.get.mockRejectedValueOnce({ code: "ERR_CANCELED" });

      await expect(getIndexingJobs("c")).rejects.toMatchObject({ code: "canceled" });
    });
  });

  describe("regenerateGraph", () => {
    it("POSTs to the encoded document path with chat_id as a query parameter", async () => {
      apiMock.post.mockResolvedValueOnce({ data: { status: "PENDING" } });

      const result = await regenerateGraph("chat-9", "My notes #1.pdf");

      expect(result).toEqual({ status: "PENDING" });
      expect(apiMock.post).toHaveBeenCalledWith(
        "/knowledge-graph/documents/My%20notes%20%231.pdf/regenerate",
        null,
        { params: { chat_id: "chat-9" } }
      );
    });

    it("exposes 409 and 503 as distinct codes", async () => {
      apiMock.post.mockRejectedValueOnce(httpError(409, "Graph generation is already running for this PDF."));
      await expect(regenerateGraph("c", "a.pdf")).rejects.toMatchObject({ code: "conflict" });

      apiMock.post.mockRejectedValueOnce(httpError(503, "not configured"));
      await expect(regenerateGraph("c", "a.pdf")).rejects.toMatchObject({ code: "unavailable" });
    });
  });
});
