import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react";
import { fetchChatPdf } from "../services/pdfservice";
import { resolveTargetPage } from "../utils/pdfNavigation";

import "./PdfViewerModal.css";

const ERROR_MESSAGES = {
  not_found:
    "This document is no longer available in this chat. It may have been deleted.",
  invalid: "This document could not be opened.",
  failed: "Could not load this PDF. Please check the connection and try again.",
  render: "This PDF could not be displayed.",
};

// Loads pdf.js on first use only, so it is not part of the main bundle.
async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * Shows one page of a chat's PDF. `page` is the citation's 1-based page and is
 * used as-is. Render with a `key` that changes per citation.
 */
function PdfViewerModal({ chatId, filename, page, onClose }) {
  const bodyRef = useRef(null);
  const canvasRef = useRef(null);
  const closeRef = useRef(null);

  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(null);
  const [notice, setNotice] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [width, setWidth] = useState(0);

  // ---- load the document (once per modal)
  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;

    (async () => {
      try {
        const [pdfjs, bytes] = await Promise.all([loadPdfJs(), fetchChatPdf(chatId, filename)]);
        loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy?.();
          return;
        }
        const target = resolveTargetPage(page, doc.numPages);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(target.page);
        setNotice(target.notice);
      } catch (error) {
        if (!cancelled) setErrorCode(error?.code || "render");
      }
    })();

    return () => {
      cancelled = true;
      loadingTask?.destroy?.();
    };
  }, [chatId, filename, page]);

  // ---- keep track of the available width so the page always fits
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") {
      const frame = window.requestAnimationFrame(measure);
      window.addEventListener("resize", measure);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", measure);
      };
    }
    // The observer reports the initial size as soon as it starts observing.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- draw the current page, scaled to the available width
  useEffect(() => {
    if (!pdfDoc || !pageNumber || !canvasRef.current) return undefined;
    let cancelled = false;
    let renderTask = null;

    (async () => {
      try {
        const pdfPage = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const available = Math.max((width || base.width) - 2, 120);
        const scale = Math.min(Math.max(available / base.width, 0.2), 3);
        const viewport = pdfPage.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        renderTask = pdfPage.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && error?.name !== "RenderingCancelledException") {
          setErrorCode("render");
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdfDoc, pageNumber, width]);

  // ---- release the document when the viewer closes
  useEffect(() => () => pdfDoc?.destroy?.(), [pdfDoc]);

  // ---- keyboard: Esc closes, arrows change page
  const goTo = (n) => {
    setNotice(null);
    setPageNumber((current) => Math.min(Math.max(n, 1), numPages || current || 1));
  };

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowLeft" && pageNumber > 1) {
      goTo(pageNumber - 1);
    } else if (event.key === "ArrowRight" && pageNumber < numPages) {
      goTo(pageNumber + 1);
    }
  };

  const loading = !pdfDoc && !errorCode;

  return (
    <div
      className="pdf-viewer-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="pdf-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`PDF viewer: ${filename}`}
        onKeyDown={onKeyDown}
      >
        <div className="pdf-viewer-header">
          <div className="pdf-viewer-title" title={filename}>
            <FileText size={16} aria-hidden="true" />
            <span>{filename}</span>
          </div>

          {pageNumber && (
            <div className="pdf-viewer-pager">
              <button
                type="button"
                className="pdf-viewer-btn"
                onClick={() => goTo(pageNumber - 1)}
                disabled={pageNumber <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="pdf-viewer-page-label" aria-live="polite">
                Page {pageNumber} of {numPages}
              </span>
              <button
                type="button"
                className="pdf-viewer-btn"
                onClick={() => goTo(pageNumber + 1)}
                disabled={pageNumber >= numPages}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          <button
            type="button"
            ref={closeRef}
            className="pdf-viewer-btn pdf-viewer-close"
            onClick={onClose}
            aria-label="Close PDF viewer"
          >
            <X size={18} />
          </button>
        </div>

        {notice && (
          <div className="pdf-viewer-notice" role="status">
            {notice}
          </div>
        )}

        <div className="pdf-viewer-body" ref={bodyRef}>
          {loading && <div className="pdf-viewer-message" role="status">Loading PDF…</div>}
          {errorCode && (
            <div className="pdf-viewer-message pdf-viewer-error" role="alert">
              {ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.failed}
            </div>
          )}
          {!errorCode && (
            <canvas
              ref={canvasRef}
              className="pdf-viewer-canvas"
              hidden={!pdfDoc}
              aria-label={pageNumber ? `Page ${pageNumber} of ${filename}` : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default PdfViewerModal;
