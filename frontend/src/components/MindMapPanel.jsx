import { lazy, Suspense, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader,
  Network,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import useKnowledgeGraph from "../hooks/useKnowledgeGraph";
import {
  deriveView,
  documentStatusText,
  getNeighbors,
} from "../utils/knowledgeGraph";
import ConceptDetails from "./ConceptDetails";
import MindMapErrorBoundary from "./MindMapErrorBoundary";
import "./MindMapPanel.css";

// React Flow and d3-force are only downloaded when a graph is first shown.
const MindMapCanvas = lazy(() => import("./MindMapCanvas"));

const ERROR_TEXT = {
  gone: "This conversation was deleted.",
  invalid: "This conversation cannot be shown.",
  failed:
    "Could not reach the server. Check that the backend is running and try again.",
  unavailable: "The mind map service is not available right now.",
};

const errorText = (error) =>
  ERROR_TEXT[error?.code] ||
  error?.message ||
  "Something went wrong while loading the mind map.";

const actionErrorText = (error) =>
  error?.code === "unavailable"
    ? "Mind map generation is not available right now because the AI service is not configured."
    : errorText(error);

function StateCard({ icon, tone = "neutral", title, role, children }) {
  return (
    <div className="mindmap-state" role={role}>
      <div className={`mindmap-state-icon tone-${tone}`}>{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function DocumentStatusList({ documents, indexing }) {
  return (
    <ul className="mindmap-doc-list">
      {documents.map((doc) => {
        const working =
          doc.status === "PENDING" ||
          doc.status === "PROCESSING" ||
          (doc.status === "NOT_STARTED" && indexing);

        return (
          <li
            key={doc.filename}
            className={`mindmap-doc status-${doc.status.toLowerCase()}`}
          >
            <span className="mindmap-doc-name" title={doc.filename}>
              <FileText size={14} aria-hidden="true" />
              <span>{doc.filename}</span>
            </span>

            <span className="mindmap-doc-status">
              {working && (
                <Loader
                  className="animate-spin"
                  size={13}
                  aria-hidden="true"
                />
              )}
              {doc.status === "COMPLETED" && (
                <CheckCircle2 size={13} aria-hidden="true" />
              )}
              {doc.status === "FAILED" && (
                <XCircle size={13} aria-hidden="true" />
              )}
              {documentStatusText(doc, indexing)}
            </span>

            {doc.status === "FAILED" && doc.error && (
              <span className="mindmap-doc-error">{doc.error}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The Mind Map tab: loads and refreshes the chat's knowledge graph, shows
 * the right state for every situation, and the graph with a details panel.
 * Requests are only made while `active` is true.
 *
 * Render with `key={chatId}` so each chat starts from a clean state.
 */
function MindMapPanel({
  chatId,
  active,
  refreshKey,
  onOpenSource,
  onGoToChat,
}) {
  const knowledge = useKnowledgeGraph({ chatId, active, refreshKey });
  const { data, error, indexing, regenerating, actionError } = knowledge;

  const view = deriveView({ data, error, indexing });

  const [selectedId, setSelectedId] = useState(null);
  const [focusTick, setFocusTick] = useState(0);

  const selectedNode = useMemo(
    () => data?.nodes?.find((n) => n.id === selectedId) || null,
    [data, selectedId]
  );

  const neighbors = useMemo(
    () => getNeighbors(data, selectedNode?.id),
    [data, selectedNode]
  );

  const showGraph = view.kind === "ready" || view.kind === "partial";
  const documents = data?.documents || [];

  const retry = (docs) =>
    knowledge.regenerate(docs.map((d) => d.filename));

  const selectFromList = (id) => {
    setSelectedId(id);
    setFocusTick((tick) => tick + 1);
  };

  const stats = data?.stats;

  return (
    <section className="mindmap-panel" aria-label="Mind map">
      <div className="mindmap-toolbar">
        <div className="mindmap-title">
          <h2>Mind Map</h2>
          {showGraph && stats && (
            <span className="mindmap-stats">
              {stats.node_count}{" "}
              {stats.node_count === 1 ? "concept" : "concepts"} ·{" "}
              {stats.edge_count}{" "}
              {stats.edge_count === 1 ? "connection" : "connections"}
            </span>
          )}
        </div>

        <div className="mindmap-toolbar-actions">
          {view.busy && showGraph && (
            <span className="mindmap-updating" role="status">
              <Loader
                className="animate-spin"
                size={14}
                aria-hidden="true"
              />
              Updating
            </span>
          )}

          <button
            type="button"
            className="mindmap-btn"
            onClick={knowledge.refresh}
            disabled={regenerating}
            aria-label="Refresh mind map"
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span className="mindmap-btn-text">Refresh</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mindmap-notice tone-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{actionErrorText(actionError)}</span>
          <button
            type="button"
            className="mindmap-link-btn"
            onClick={knowledge.dismissActionError}
          >
            Dismiss
          </button>
        </div>
      )}

      {error && data && (
        <div className="mindmap-notice tone-warn" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Could not refresh the mind map. Showing the last version.
          </span>
          <button
            type="button"
            className="mindmap-link-btn"
            onClick={knowledge.refresh}
          >
            Try again
          </button>
        </div>
      )}

      {view.kind === "partial" && (
        <div className="mindmap-notice tone-warn" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            {view.failedDocs.length === 1
              ? `A mind map could not be built for ${view.failedDocs[0].filename}.`
              : `Mind maps could not be built for ${view.failedDocs.length} PDFs.`}{" "}
            The rest are shown below.
          </span>
          <button
            type="button"
            className="mindmap-link-btn"
            onClick={() => retry(view.failedDocs)}
            disabled={regenerating}
          >
            Retry
          </button>
        </div>
      )}

      <div className="mindmap-body">
        {view.kind === "loading" && (
          <StateCard
            role="status"
            tone="neutral"
            icon={
              <Loader
                className="animate-spin"
                size={26}
                aria-hidden="true"
              />
            }
            title="Loading your mind map…"
          />
        )}

        {view.kind === "error" && (
          <StateCard
            role="alert"
            tone="error"
            icon={<AlertTriangle size={26} aria-hidden="true" />}
            title="Could not load the mind map"
          >
            <p>{errorText(view.error)}</p>
            {view.error.code !== "gone" && (
              <button
                type="button"
                className="mindmap-btn primary"
                onClick={knowledge.refresh}
              >
                <RefreshCw size={14} aria-hidden="true" />
                Try again
              </button>
            )}
          </StateCard>
        )}

        {view.kind === "empty" && (
          <StateCard
            tone="neutral"
            icon={<Network size={26} aria-hidden="true" />}
            title="No mind map yet"
          >
            <p>
              Upload a PDF in the Chat tab. StudyPilot will map out its
              key concepts and how they connect, and the mind map will
              appear here.
            </p>
            {onGoToChat && (
              <button
                type="button"
                className="mindmap-btn primary"
                onClick={onGoToChat}
              >
                Go to Chat
              </button>
            )}
          </StateCard>
        )}

        {view.kind === "processing" && (
          <StateCard
            role="status"
            tone="neutral"
            icon={
              <Loader
                className="animate-spin"
                size={26}
                aria-hidden="true"
              />
            }
            title="Building your mind map…"
          >
            <p>
              StudyPilot is reading your PDFs and mapping out the key
              concepts. This can take a minute for long documents, and
              this page updates on its own.
            </p>
            <DocumentStatusList documents={documents} indexing={indexing} />
          </StateCard>
        )}

        {view.kind === "not_started" && (
          <StateCard
            tone="neutral"
            icon={<Sparkles size={26} aria-hidden="true" />}
            title="Mind map not generated yet"
          >
            <p>
              Your PDFs are ready. Generate a mind map to see their key
              concepts and how they connect.
            </p>
            <DocumentStatusList documents={documents} indexing={indexing} />
            <button
              type="button"
              className="mindmap-btn primary"
              onClick={() => retry(view.notStartedDocs)}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader
                  className="animate-spin"
                  size={14}
                  aria-hidden="true"
                />
              ) : (
                <Sparkles size={14} aria-hidden="true" />
              )}
              Generate mind map
            </button>
          </StateCard>
        )}

        {view.kind === "failed" && (
          <StateCard
            role="alert"
            tone="error"
            icon={<XCircle size={26} aria-hidden="true" />}
            title="Could not build a mind map"
          >
            <p>
              Something went wrong while reading your PDFs. Your chat
              and answers are not affected.
            </p>
            <DocumentStatusList documents={documents} indexing={indexing} />
            <button
              type="button"
              className="mindmap-btn primary"
              onClick={() => retry(view.failedDocs)}
              disabled={regenerating}
            >
              {regenerating ? (
                <Loader
                  className="animate-spin"
                  size={14}
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Try again
            </button>
          </StateCard>
        )}

        {showGraph && (
          <div className="mindmap-stage">
            <div className="mindmap-stage-canvas">
              <MindMapErrorBoundary>
                <Suspense
                  fallback={
                    <StateCard
                      role="status"
                      tone="neutral"
                      icon={
                        <Loader
                          className="animate-spin"
                          size={26}
                          aria-hidden="true"
                        />
                      }
                      title="Loading the graph viewer…"
                    />
                  }
                >
                  <MindMapCanvas
                    graph={data}
                    selectedId={selectedNode?.id ?? null}
                    focusTick={focusTick}
                    onSelect={setSelectedId}
                  />
                </Suspense>
              </MindMapErrorBoundary>
            </div>

            {selectedNode && (
              <ConceptDetails
                key={selectedNode.id}
                node={selectedNode}
                neighbors={neighbors}
                onClose={() => setSelectedId(null)}
                onSelectNeighbor={selectFromList}
                onOpenSource={onOpenSource}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default MindMapPanel;
