import { FileText, X } from "lucide-react";
import {
  compressPages,
  nodeTypeLabel,
  relationshipText,
} from "../utils/knowledgeGraph";
import "./ConceptDetails.css";

// A concept that appears on a great many pages still has to fit the panel.
const MAX_PAGE_BUTTONS = 20;

/**
 * What a selected concept is, where it came from, and what it connects to.
 * Source pages open the existing PDF viewer through `onOpenSource`.
 */
function ConceptDetails({
  node,
  neighbors = [],
  onClose,
  onSelectNeighbor,
  onOpenSource,
}) {
  const sources = node.sources || [];

  return (
    <aside
      className="concept-details animate-fade-in"
      aria-label={`Details for ${node.label}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="concept-details-header">
        <div className="concept-details-heading">
          <span className="concept-type-chip" data-kind={node.type}>
            {nodeTypeLabel(node.type)}
          </span>
          <h3>{node.label}</h3>
        </div>

        <button
          type="button"
          className="concept-details-close"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </button>
      </div>

      <div className="concept-details-body">
        <p
          className={
            node.description
              ? "concept-description"
              : "concept-description is-empty"
          }
        >
          {node.description ||
            "The study material does not define this concept."}
        </p>

        <section aria-labelledby="concept-sources-title">
          <h4 id="concept-sources-title">Sources</h4>

          {sources.length === 0 ? (
            <p className="concept-details-empty">
              No source recorded.
            </p>
          ) : (
            <ul className="concept-sources">
              {sources.map((source) => {
                const pages = [...new Set(source.pages || [])].sort(
                  (a, b) => a - b
                );
                const shown = pages.slice(0, MAX_PAGE_BUTTONS);
                const showOwn =
                  source.description &&
                  source.description !== node.description;

                return (
                  <li key={source.document} className="concept-source">
                    <div className="concept-source-name" title={source.document}>
                      <FileText size={14} aria-hidden="true" />
                      <span>{source.document}</span>
                    </div>

                    {showOwn && (
                      <p className="concept-source-description">
                        {source.description}
                      </p>
                    )}

                    <div className="concept-pages">
                      {shown.length === 0 ? (
                        <button
                          type="button"
                          className="concept-page-btn"
                          onClick={() =>
                            onOpenSource({
                              filename: source.document,
                              page: 1,
                            })
                          }
                        >
                          Open PDF
                        </button>
                      ) : (
                        <>
                          <span className="concept-pages-label">
                            {pages.length === 1 ? "Page" : "Pages"}
                            <span className="sr-only">
                              {" "}
                              {compressPages(pages)}
                            </span>
                          </span>

                          {shown.map((page) => (
                            <button
                              key={page}
                              type="button"
                              className="concept-page-btn"
                              onClick={() =>
                                onOpenSource({
                                  filename: source.document,
                                  page,
                                })
                              }
                              aria-label={`Open ${source.document} at page ${page}`}
                            >
                              {page}
                            </button>
                          ))}

                          {pages.length > shown.length && (
                            <span className="concept-pages-more">
                              +{pages.length - shown.length} more
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="concept-links-title">
          <h4 id="concept-links-title">
            Connected concepts
            {neighbors.length > 0 && (
              <span className="concept-count">{neighbors.length}</span>
            )}
          </h4>

          {neighbors.length === 0 ? (
            <p className="concept-details-empty">
              No connections were found for this concept.
            </p>
          ) : (
            <ul className="concept-links">
              {neighbors.map(({ direction, edge, node: other }) => (
                <li key={edge.id}>
                  <button
                    type="button"
                    className="concept-link-btn"
                    onClick={() => onSelectNeighbor(other.id)}
                  >
                    {direction === "out" ? (
                      <>
                        <em>{relationshipText(edge)}</em>{" "}
                        <strong>{other.label}</strong>
                      </>
                    ) : (
                      <>
                        <strong>{other.label}</strong>{" "}
                        <em>{relationshipText(edge)}</em> this
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

export default ConceptDetails;
