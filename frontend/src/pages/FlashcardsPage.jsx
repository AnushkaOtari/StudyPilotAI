import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, SquareStack, Sparkles } from "lucide-react";
import api from "../services/api";
import { generateFlashcards } from "../services/flashcardservice";
import { findStoredActiveChatId, getFlashcardErrorMessage } from "../utils/flashcards";
import useAuth from "../hooks/useAuth";
import FlashcardStudyView from "../components/FlashcardStudyView";
import "./FlashcardsPage.css";

const CARD_COUNT_OPTIONS = [5, 10, 15, 20, 30]; // all inside the backend's 1-30 limit

function FlashcardsPage() {
  const location = useLocation();
  const { currentUser } = useAuth();
  const userId = currentUser?.id;

  // Same hand-off as the Quiz (router state from the sidebar); when the page is
  // opened directly, fall back to the chat StudyPilot last had open.
  const chatId = useMemo(
    () => location.state?.chatId || findStoredActiveChatId(userId),
    [location.state, userId]
  );

  const [pdfName, setPdfName] = useState("");
  const [numFlashcards, setNumFlashcards] = useState(10);
  const [availablePdfs, setAvailablePdfs] = useState([]);
  const [loadingPdfs, setLoadingPdfs] = useState(true);

  const [cards, setCards] = useState([]);
  const [deckId, setDeckId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emptyResult, setEmptyResult] = useState(false);

  const inFlight = useRef(false);
  const abortRef = useRef(null);

  // Cancel a pending request if the student leaves the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    const fetchPdfs = async () => {
      if (!chatId) {
        setLoadingPdfs(false);
        return;
      }
      try {
        const response = await api.get("/files", { params: { chat_id: chatId } });
        if (!cancelled) setAvailablePdfs(Array.isArray(response.data) ? response.data : []);
      } catch (err) {
        console.error("Error fetching PDFs:", err?.message);
      } finally {
        if (!cancelled) setLoadingPdfs(false);
      }
    };
    fetchPdfs();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  const handleGenerate = async () => {
    if (inFlight.current || !chatId) return; // no duplicate submissions
    inFlight.current = true;
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    setEmptyResult(false);

    try {
      const result = await generateFlashcards(chatId, pdfName, Number(numFlashcards), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.length === 0) {
        setCards([]);
        setEmptyResult(true);
      } else {
        setCards(result);
        setDeckId((id) => id + 1); // new deck => study view starts at card 1, answer hidden
      }
    } catch (err) {
      const message = getFlashcardErrorMessage(err);
      if (message) setError(message);
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const header = (
    <div className="fc-header">
      <div className="fc-header-text">
        <h1 className="fc-title">
          <SquareStack size={26} aria-hidden="true" />
          Flashcards
        </h1>
        <p className="fc-subtitle">Generate AI-powered flashcards and practice concepts from your study material.</p>
      </div>
      <Link to="/chat" className="fc-back-link">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to Chat
      </Link>
    </div>
  );

  // Opened with no chat to work from.
  if (!chatId) {
    return (
      <div className="fc-page">
        <div className="fc-shell">
          {header}
          <div className="fc-banner fc-banner-error" role="alert">
            No active chat session detected. Open a chat first, then choose Flashcards from the sidebar to
            generate cards from that chat's documents.
          </div>
          <Link to="/chat" className="fc-btn fc-btn-primary fc-btn-link">
            <ArrowLeft size={16} aria-hidden="true" /> Go to Chat
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="fc-page">
        <div className="fc-shell">
          {header}
          <div className="fc-loading" role="status" aria-live="polite">
            <div className="fc-spinner" aria-hidden="true" />
            <h2 className="fc-loading-title">Generating your flashcards…</h2>
            <p className="fc-loading-text">Reading your study material and writing question and answer cards.</p>
          </div>
        </div>
      </div>
    );
  }

  if (cards.length > 0) {
    return (
      <div className="fc-page">
        <div className="fc-shell">
          {header}
          <FlashcardStudyView key={deckId} cards={cards} onNewDeck={() => setCards([])} />
        </div>
      </div>
    );
  }

  const hasPdfs = availablePdfs.length > 0;

  return (
    <div className="fc-page">
      <div className="fc-shell">
        {header}

        {error && (
          <div className="fc-banner fc-banner-error" role="alert">
            {error}
          </div>
        )}

        {emptyResult && (
          <div className="fc-banner fc-banner-info" role="status">
            No flashcards could be created from this material. Try a different document or upload more study
            material, then generate again.
          </div>
        )}

        {loadingPdfs ? (
          <div className="fc-inline-loading">
            <div className="fc-spinner fc-spinner-sm" aria-hidden="true" />
            <span>Checking document library…</span>
          </div>
        ) : (
          <form
            className="fc-form"
            onSubmit={(event) => {
              event.preventDefault();
              handleGenerate();
            }}
          >
            {!hasPdfs && (
              <div className="fc-banner fc-banner-error" role="alert">
                No PDFs uploaded in this chat yet. Upload at least one PDF, then come back to generate flashcards.
              </div>
            )}

            <div className="fc-field">
              <label className="fc-label" htmlFor="fc-document">
                Study document
              </label>
              <select
                id="fc-document"
                className="fc-select"
                value={pdfName}
                onChange={(event) => setPdfName(event.target.value)}
                disabled={!hasPdfs}
              >
                <option value="">All documents (active chat)</option>
                {availablePdfs.map((pdf) => (
                  <option key={pdf} value={pdf}>
                    {pdf}
                  </option>
                ))}
              </select>
            </div>

            <div className="fc-field">
              <label className="fc-label" htmlFor="fc-count">
                Number of flashcards
              </label>
              <select
                id="fc-count"
                className="fc-select"
                value={numFlashcards}
                onChange={(event) => setNumFlashcards(event.target.value)}
                disabled={!hasPdfs}
              >
                {CARD_COUNT_OPTIONS.map((count) => (
                  <option key={count} value={count}>
                    {count} flashcards
                  </option>
                ))}
              </select>
              <p className="fc-help">You may get fewer if the material doesn't cover that many topics.</p>
            </div>

            <button type="submit" className="fc-btn fc-btn-primary fc-btn-block" disabled={!hasPdfs || loading}>
              <Sparkles size={18} aria-hidden="true" />
              Generate Flashcards
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default FlashcardsPage;
