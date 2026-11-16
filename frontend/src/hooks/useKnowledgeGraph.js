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
 * Loads the knowledge graph of ONE PDF of a chat and keeps it fresh.
 *
 * `filename` is the selected document. Without one nothing is requested (the
 * panel asks the user to pick a document), so graphs of different PDFs are
 * never combined. A graph is only ever returned for the chat and document it
 * was loaded for, so switching document never shows the previous one.
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
  filename = null,
  active,
  refreshKey = "",
}) {
  const scope = chatId && filename ? `${chatId}\u0000${filename}` : null;

  // What is stored remembers which chat + document it was loaded for, and is
  // only handed out for that same scope.
  const [stored, setStored] = useState({ scope: null, data: null, error: null });
  const data = stored.scope === scope ? stored.data : null;
  const error = stored.scope === scope ? stored.error : null;

  const [indexing, setIndexing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [actionError, setActionError] = useState(null);

  const dataRef = useRef(null);
  const scopeRef = useRef(null);

  useEffect(() => {
    if (!active || !scope) return undefined;

    // A different chat or document starts from nothing.
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      dataRef.current = null;
    }

    const merge = (patch) =>
      setStored((s) => {
        const base = s.scope === scope ? s : { scope, data: null, error: null };
        return { ...base, ...patch };
      });

    let cancelled = false;
    let timer = null;
    let failures = 0;
    let waitingForVisible = false;
    const controller = new AbortController();
    const { signal } = controller;
    const startedAt = Date.now();

    // Only the selected PDF's indexing counts, not the chat's other PDFs.
    const ownJobs = (jobs) => jobs.filter((job) => job?.filename === filename);

    const applyGraph = (graph) => {
      dataRef.current = graph;
      setStored((s) =>
        s.scope === scope && sameGraph(s.data, graph)
          ? s
          : { scope, data: graph, error: s.scope === scope ? s.error : null }
      );
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
        merge({ data: null, error: e });
        return;
      }

      // A graph already on screen is kept; the panel shows a notice.
      merge({ error: e });

      if (failures <= MAX_RETRIES) {
        schedule(retry, POLL_INTERVAL_MS * 2 ** failures);
      }
    };

    async function load() {
      try {
        const [graph, jobs] = await Promise.all([
          getGraph(chatId, { filename, signal }),
          getIndexingJobs(chatId, { signal }),
        ]);

        if (cancelled) return;

        failures = 0;
        const indexingNow = isIndexing(ownJobs(jobs));

        applyGraph(graph);
        setIndexing(indexingNow);
        merge({ error: null });

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
          getGraphStatus(chatId, { filename, signal }),
          getIndexingJobs(chatId, { signal }),
        ]);

        if (cancelled) return;

        const indexingNow = isIndexing(ownJobs(jobs));
        setIndexing(indexingNow);

        const changed =
          statusSignature(status.documents) !==
          statusSignature(dataRef.current?.documents);

        if (changed) {
          await load();
          return;
        }

        failures = 0;
        merge({ error: null });
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
  }, [chatId, filename, scope, active, refreshKey, reloadTick]);

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
