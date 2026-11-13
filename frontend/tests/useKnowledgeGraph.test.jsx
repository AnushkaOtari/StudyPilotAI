import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const svc = vi.hoisted(() => ({
  getGraph: vi.fn(),
  getGraphStatus: vi.fn(),
  getIndexingJobs: vi.fn(),
  regenerateGraph: vi.fn(),
}));
vi.mock("../src/services/knowledgegraphservice", () => svc);

import useKnowledgeGraph, {
  POLL_INTERVAL_MS,
  MAX_POLL_MS,
} from "../src/hooks/useKnowledgeGraph";

const doc = (filename, status, extra = {}) => ({
  filename,
  status,
  node_count: 0,
  edge_count: 0,
  ...extra,
});

const graphOf = (documents, nodes = []) => ({
  chat_id: "c1",
  status: "X",
  nodes,
  edges: [],
  documents,
});

const NODE = { id: "n1", label: "Cell", sources: [] };

const err = (code, message = code) => Object.assign(new Error(message), { code });

let hidden = false;

function setHidden(value) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
}

// Let pending promises settle without moving the clock.
const flush = () => act(async () => {});
const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const mount = (props = {}) =>
  renderHook((p) => useKnowledgeGraph(p), {
    initialProps: { chatId: "c1", active: true, refreshKey: "", ...props },
  });

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

  Object.values(svc).forEach((fn) => fn.mockReset());
  svc.getIndexingJobs.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useKnowledgeGraph: loading", () => {
  it("does nothing at all while inactive (no API calls on page load)", async () => {
    mount({ active: false });
    await advance(POLL_INTERVAL_MS * 3);

    expect(svc.getGraph).not.toHaveBeenCalled();
    expect(svc.getGraphStatus).not.toHaveBeenCalled();
    expect(svc.getIndexingJobs).not.toHaveBeenCalled();
  });

  it("does nothing without a chat id", async () => {
    mount({ chatId: undefined });
    await flush();

    expect(svc.getGraph).not.toHaveBeenCalled();
  });

  it("loads the graph and the queue status once when activated", async () => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "COMPLETED")], [NODE]));
    const { result } = mount();
    await flush();

    expect(svc.getGraph).toHaveBeenCalledTimes(1);
    expect(svc.getGraph.mock.calls[0][0]).toBe("c1");
    expect(svc.getIndexingJobs).toHaveBeenCalledTimes(1);
    expect(result.current.data.nodes).toEqual([NODE]);
    expect(result.current.error).toBeNull();
    expect(result.current.indexing).toBe(false);
  });

  it("starts loading only when the tab becomes active", async () => {
    svc.getGraph.mockResolvedValue(graphOf([], []));
    const { rerender } = mount({ active: false });
    await flush();
    expect(svc.getGraph).not.toHaveBeenCalled();

    rerender({ chatId: "c1", active: true, refreshKey: "" });
    await flush();
    expect(svc.getGraph).toHaveBeenCalledTimes(1);
  });

  it("reloads when the chat's PDFs change (refreshKey)", async () => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "COMPLETED")], [NODE]));
    const { rerender } = mount({ refreshKey: "a.pdf" });
    await flush();

    rerender({ chatId: "c1", active: true, refreshKey: "a.pdf|b.pdf" });
    await flush();

    expect(svc.getGraph).toHaveBeenCalledTimes(2);
  });

  it("reports a failed first load as an error with its code", async () => {
    svc.getGraph.mockRejectedValue(err("failed", "boom"));
    const { result } = mount();
    await flush();

    expect(result.current.data).toBeNull();
    expect(result.current.error.code).toBe("failed");
  });

  it("does not retry a 404 (nothing uploaded yet) or a deleted chat", async () => {
    svc.getGraph.mockRejectedValue(err("not_found"));
    const { result } = mount();
    await flush();
    await advance(POLL_INTERVAL_MS * 10);

    expect(result.current.error.code).toBe("not_found");
    expect(svc.getGraph).toHaveBeenCalledTimes(1);
  });

  it("treats a failed queue lookup as non-fatal (service returns [])", async () => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "COMPLETED")], [NODE]));
    svc.getIndexingJobs.mockResolvedValue([]);
    const { result } = mount();
    await flush();

    expect(result.current.data).not.toBeNull();
  });
});

describe("useKnowledgeGraph: polling", () => {
  it("does not poll once everything has settled", async () => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "COMPLETED")], [NODE]));
    mount();
    await flush();
    await advance(POLL_INTERVAL_MS * 5);

    expect(svc.getGraphStatus).not.toHaveBeenCalled();
    expect(svc.getGraph).toHaveBeenCalledTimes(1);
  });

  it("polls only the light status endpoints while a graph is generating", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing));
    svc.getGraphStatus.mockResolvedValue({ documents: processing });
    mount();
    await flush();

    await advance(POLL_INTERVAL_MS);
    await advance(POLL_INTERVAL_MS);

    expect(svc.getGraphStatus).toHaveBeenCalledTimes(2);
    expect(svc.getGraph).toHaveBeenCalledTimes(1); // nothing changed: no full download
    expect(svc.getIndexingJobs).toHaveBeenCalledTimes(3);
  });

  it("downloads the full graph when a status changes, then stops once COMPLETED", async () => {
    svc.getGraph
      .mockResolvedValueOnce(graphOf([doc("a.pdf", "PROCESSING")]))
      .mockResolvedValueOnce(graphOf([doc("a.pdf", "COMPLETED", { node_count: 1 })], [NODE]));
    svc.getGraphStatus.mockResolvedValue({ documents: [doc("a.pdf", "COMPLETED", { node_count: 1 })] });

    const { result } = mount();
    await flush();
    expect(result.current.data.nodes).toEqual([]);

    await advance(POLL_INTERVAL_MS);

    expect(svc.getGraph).toHaveBeenCalledTimes(2);
    expect(result.current.data.nodes).toEqual([NODE]);

    await advance(POLL_INTERVAL_MS * 5);
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(1); // polling stopped
    expect(svc.getGraph).toHaveBeenCalledTimes(2);
  });

  it("polls while a PDF is still being indexed, even before any graph job exists", async () => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "NOT_STARTED")]));
    svc.getIndexingJobs.mockResolvedValue([{ filename: "a.pdf", status: "WAITING" }]);
    svc.getGraphStatus.mockResolvedValue({ documents: [doc("a.pdf", "NOT_STARTED")] });

    const { result } = mount();
    await flush();
    expect(result.current.indexing).toBe(true);

    await advance(POLL_INTERVAL_MS);
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(1);

    // indexing finishes and the graph job starts
    svc.getIndexingJobs.mockResolvedValue([{ filename: "a.pdf", status: "COMPLETED" }]);
    svc.getGraphStatus.mockResolvedValue({ documents: [doc("a.pdf", "PENDING")] });
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "PENDING")]));
    await advance(POLL_INTERVAL_MS);

    expect(svc.getGraph).toHaveBeenCalledTimes(2);
    expect(result.current.indexing).toBe(false);
  });

  it("picks up a newly uploaded PDF (new filename) through the status signature", async () => {
    svc.getGraph
      .mockResolvedValueOnce(graphOf([doc("a.pdf", "PROCESSING")]))
      .mockResolvedValue(graphOf([doc("a.pdf", "PROCESSING"), doc("b.pdf", "NOT_STARTED")]));
    svc.getGraphStatus.mockResolvedValue({
      documents: [doc("a.pdf", "PROCESSING"), doc("b.pdf", "NOT_STARTED")],
    });

    const { result } = mount();
    await flush();
    await advance(POLL_INTERVAL_MS);

    expect(result.current.data.documents).toHaveLength(2);
  });

  it("stops polling when the tab is left and starts fresh when it returns", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing));
    svc.getGraphStatus.mockResolvedValue({ documents: processing });

    const { rerender } = mount();
    await flush();

    rerender({ chatId: "c1", active: false, refreshKey: "" });
    await advance(POLL_INTERVAL_MS * 4);
    expect(svc.getGraphStatus).not.toHaveBeenCalled();

    rerender({ chatId: "c1", active: true, refreshKey: "" });
    await flush();
    expect(svc.getGraph).toHaveBeenCalledTimes(2); // a full reload on return
  });

  it("aborts in-flight requests when the tab is left or the component unmounts", async () => {
    svc.getGraph.mockImplementation(() => new Promise(() => {})); // never resolves
    const { unmount } = mount();
    await flush();

    const { signal } = svc.getGraph.mock.calls[0][1];
    expect(signal.aborted).toBe(false);

    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("pauses while the browser tab is hidden and resumes when it is visible again", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing));
    svc.getGraphStatus.mockResolvedValue({ documents: processing });
    mount();
    await flush();

    setHidden(true);
    await advance(POLL_INTERVAL_MS * 4);
    expect(svc.getGraphStatus).not.toHaveBeenCalled();

    await act(async () => { setHidden(false); });
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(1);

    await advance(POLL_INTERVAL_MS);
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(2); // normal cadence again
  });

  it("gives up after MAX_POLL_MS (Refresh restarts it)", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing));
    svc.getGraphStatus.mockResolvedValue({ documents: processing });
    const { result } = mount();
    await flush();

    await advance(MAX_POLL_MS + POLL_INTERVAL_MS * 2);
    const calls = svc.getGraphStatus.mock.calls.length;
    await advance(POLL_INTERVAL_MS * 5);
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(calls);

    act(() => result.current.refresh());
    await flush();
    expect(svc.getGraph).toHaveBeenCalledTimes(2);
  });

  it("keeps the graph on screen and retries when a poll fails", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing, [NODE]));
    svc.getGraphStatus
      .mockRejectedValueOnce(err("failed", "network"))
      .mockResolvedValue({ documents: processing });

    const { result } = mount();
    await flush();
    await advance(POLL_INTERVAL_MS);

    expect(result.current.data.nodes).toEqual([NODE]);
    expect(result.current.error.code).toBe("failed");

    await advance(POLL_INTERVAL_MS * 4); // backoff retry succeeds
    expect(result.current.error).toBeNull();
  });

  it("stops retrying after repeated poll failures", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing));
    svc.getGraphStatus.mockRejectedValue(err("failed"));

    mount();
    await flush();
    await advance(POLL_INTERVAL_MS * 200);

    const calls = svc.getGraphStatus.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(5);
    await advance(POLL_INTERVAL_MS * 50);
    expect(svc.getGraphStatus).toHaveBeenCalledTimes(calls);
  });

  it("drops the graph if the chat disappears while polling", async () => {
    const processing = [doc("a.pdf", "PROCESSING")];
    svc.getGraph.mockResolvedValue(graphOf(processing, [NODE]));
    svc.getGraphStatus.mockRejectedValue(err("gone"));

    const { result } = mount();
    await flush();
    await advance(POLL_INTERVAL_MS);

    expect(result.current.data).toBeNull();
    expect(result.current.error.code).toBe("gone");
  });

  it("keeps the same data object when a reload brings nothing new", async () => {
    svc.getGraph.mockImplementation(async () => graphOf([doc("a.pdf", "COMPLETED")], [NODE]));
    const { result } = mount();
    await flush();
    const first = result.current.data;

    act(() => result.current.refresh());
    await flush();

    expect(svc.getGraph).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(first);
  });
});

describe("useKnowledgeGraph: regenerate", () => {
  beforeEach(() => {
    svc.getGraph.mockResolvedValue(graphOf([doc("a.pdf", "FAILED"), doc("b.pdf", "FAILED")]));
  });

  it("requests each PDF then reloads", async () => {
    svc.regenerateGraph.mockResolvedValue({ status: "PENDING" });
    const { result } = mount();
    await flush();

    let ok;
    await act(async () => { ok = await result.current.regenerate(["a.pdf", "b.pdf"]); });

    expect(ok).toBe(true);
    expect(svc.regenerateGraph.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["c1", "a.pdf"],
      ["c1", "b.pdf"],
    ]);
    expect(svc.getGraph).toHaveBeenCalledTimes(2);
    expect(result.current.regenerating).toBe(false);
  });

  it("accepts a single filename", async () => {
    svc.regenerateGraph.mockResolvedValue({});
    const { result } = mount();
    await flush();

    await act(async () => { await result.current.regenerate("a.pdf"); });

    expect(svc.regenerateGraph).toHaveBeenCalledTimes(1);
  });

  it("is not an error when a PDF is already generating (409)", async () => {
    svc.regenerateGraph.mockRejectedValue(err("conflict"));
    const { result } = mount();
    await flush();

    let ok;
    await act(async () => { ok = await result.current.regenerate("a.pdf"); });

    expect(ok).toBe(true);
    expect(result.current.actionError).toBeNull();
  });

  it("reports other failures, still reloads, and can be dismissed", async () => {
    svc.regenerateGraph
      .mockRejectedValueOnce(err("unavailable", "AI service not configured"))
      .mockResolvedValueOnce({});
    const { result } = mount();
    await flush();

    let ok;
    await act(async () => { ok = await result.current.regenerate(["a.pdf", "b.pdf"]); });

    expect(ok).toBe(false);
    expect(result.current.actionError.code).toBe("unavailable");
    expect(svc.regenerateGraph).toHaveBeenCalledTimes(2); // the second PDF was still tried
    expect(svc.getGraph).toHaveBeenCalledTimes(2);

    act(() => result.current.dismissActionError());
    expect(result.current.actionError).toBeNull();
  });
});
