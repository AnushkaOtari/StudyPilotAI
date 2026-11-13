import { useCallback, useEffect, useRef, useState } from "react";
import {
  getGraph,
  getGraphStatus,
  getIndexingJobs,
  regenerateGraph,
} from "../services/knowledgegraphservice";
import {
  isBusy,
  isIndexing,
  statusSignature,
} from "../utils/knowledgeGraph";

export const POLL_INTERVAL_MS = 3000;
// Stop polling after this long; the Refresh button starts it again.
export const MAX_POLL_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;

const GIVE_UP_CODES = ["not_found", "gone", "invalid"];

const sameGraph = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Loads a chat's knowledge graph and keeps it fresh.
 *
 * Nothing is requested unless `active` is true, so the Mind Map costs nothing
 * until its tab is opened, and polling stops when the tab is left.
 *
 *   - full load: GET /knowledge-graph  (+ the document queue status)
 *   - while anything is indexing or generating: every few seconds, the cheap
 *     status endpoints; the full graph is downloaded again only when a PDF's
 *     status or size changed
 *   - polling pauses while the browser tab is hidden
 *
 * `refreshKey` should change when the chat's PDFs change (upload/delete).
 * Render the consumer with `key={chatId}` so a different chat starts clean.
 */
export default function useKnowledgeGraph({
  chatId,
  active,
  refreshKey = "",
}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [indexing, setIndexing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [actionError, setActionError] = useState(null);

  const dataRef = useRef(null);

  useEffect(() => {
    if (!active || !chatId) return undefined;

    let cancelled = false;
    let timer = null;
    let failures = 0;
    let waitingForVisible = false;
    const controller = new AbortController();
    const { signal } = controller;
    const startedAt = Date.now();

    const applyGraph = (graph) => {
      dataRef.current = graph;
      setData((previous) => (sameGraph(previous, graph) ? previous : graph));
    };

    const schedule = (action, delay) => {
      if (cancelled) return;
      timer = setTimeout(action, delay);
    };

    const keepPolling = (documents, indexingNow) => {
      if (cancelled) return;
      if (!isBusy(documents, indexingNow)) return;
      if (Date.now() - startedAt > MAX_POLL_MS) return;

      schedule(tick, POLL_INTERVAL_MS);
    };

    const fail = (e, retry) => {
      if (cancelled || e?.code === "canceled") return;

      failures += 1;

      if (GIVE_UP_CODES.includes(e.code)) {
        dataRef.current = null;
        setData(null);
        setError(e);
        return;
      }

      // A graph already on screen is kept; the panel shows a notice.
      setError(e);

      if (failures <= MAX_RETRIES) {
        schedule(retry, POLL_INTERVAL_MS * 2 ** failures);
      }
    };

    async function load() {
      try {
        const [graph, jobs] = await Promise.all([
          getGraph(chatId, { signal }),
          getIndexingJobs(chatId, { signal }),
        ]);

        if (cancelled) return;

        failures = 0;
        const indexingNow = isIndexing(jobs);

        applyGraph(graph);
        setIndexing(indexingNow);
        setError(null);

        keepPolling(graph.documents, indexingNow);
      } catch (e) {
        fail(e, load);
      }
    }

    async function tick() {
      if (cancelled) return;

      if (typeof document !== "undefined" && document.hidden) {
        waitingForVisible = true;
        return;
      }

      try {
        const [status, jobs] = await Promise.all([
          getGraphStatus(chatId, { signal }),
          getIndexingJobs(chatId, { signal }),
        ]);

        if (cancelled) return;

        const indexingNow = isIndexing(jobs);
        setIndexing(indexingNow);

        const changed =
          statusSignature(status.documents) !==
          statusSignature(dataRef.current?.documents);

        if (changed) {
          await load();
          return;
        }

        failures = 0;
        setError(null);
        keepPolling(status.documents, indexingNow);
      } catch (e) {
        fail(e, tick);
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden && waitingForVisible) {
        waitingForVisible = false;
        tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    };
  }, [chatId, active, refreshKey, reloadTick]);

  /** Fetch everything again now (also restarts polling). */
  const refresh = useCallback(() => {
    setReloadTick((t) => t + 1);
  }, []);

  /**
   * Start (re)generation for one filename or a list of them. A PDF that is
   * already generating (409) is not an error. Resolves true when nothing
   * went wrong.
   */
  const regenerate = useCallback(
    async (filenames) => {
      const list = Array.isArray(filenames) ? filenames : [filenames];

      setRegenerating(true);
      setActionError(null);

      let failure = null;

      for (const filename of list) {
        try {
          await regenerateGraph(chatId, filename);
        } catch (e) {
          if (e.code !== "conflict") failure = failure || e;
        }
      }

      setRegenerating(false);

      if (failure) setActionError(failure);

      setReloadTick((t) => t + 1);

      return !failure;
    },
    [chatId]
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    data,
    error,
    indexing,
    regenerating,
    actionError,
    refresh,
    regenerate,
    dismissActionError,
  };
}
