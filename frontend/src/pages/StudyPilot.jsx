import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  lazy,
  Suspense,
} from "react";
import "../App.css";
import api from "../services/api";
import useAuth from "../hooks/useAuth";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import UploadBox from "../components/UploadBox";
import ChatBox from "../components/ChatBox";
import ChatInput from "../components/ChatInput";
import ViewTabs from "../components/ViewTabs";
import MindMapPanel from "../components/MindMapPanel";
import { normalizeCitations } from "../utils/citations";
import { canOpenCitation } from "../utils/pdfNavigation";
import {
  VIEW_CHAT,
  VIEW_MINDMAP,
  viewPanelId,
  viewTabId,
} from "../utils/knowledgeGraph";

// pdf.js is only downloaded the first time a citation is opened.
const PdfViewerModal = lazy(() =>
  import("../components/PdfViewerModal")
);

const createDefaultConversation = () => ({
  id: Date.now(),
  title: "Conversation 1",
  messages: [],
  chat_id: crypto.randomUUID(),
});

function StudyPilot() {
  const { currentUser } = useAuth();

  console.log("Current User:", currentUser);
  console.log("User ID:", currentUser?.id);

  const userId = currentUser?.id;

  const storageKeys = useMemo(() => {
    if (!userId) return null;

    return {
      conversations: `studypilot_${userId}_conversations`,
      activeChat: `studypilot_${userId}_active_chat`,
      selectedPdf: `studypilot_${userId}_selected_pdf`,
    };
  }, [userId]);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // File upload state for multiple PDFs
  const [files, setFiles] = useState([]);
  const [queueJobs, setQueueJobs] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  // Selected PDF to scope RAG queries (null means query all notes)
  const [selectedPdf, setSelectedPdf] = useState(null);

  // Navigation drawer and citation PDF viewer
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewer, setViewer] = useState(null);
  const lastFocusRef = useRef(null);

  // Prevent duplicate deletion requests for the same chat
  const deletingChatsRef = useRef(new Set());

  // Chat | Mind Map tabs. The chat stays mounted (just hidden) while the Mind
  // Map is open, and the Mind Map is not mounted, so it requests nothing,
  // until its tab is opened for the first time.
  const [activeView, setActiveView] = useState(VIEW_CHAT);
  const [mindMapOpened, setMindMapOpened] = useState(false);

  const changeView = (view) => {
    setActiveView(view);
    if (view === VIEW_MINDMAP) setMindMapOpened(true);
  };

  const loadUserConversations = useCallback(() => {
    if (!storageKeys) return [createDefaultConversation()];

    const saved = localStorage.getItem(storageKeys.conversations);

    if (saved) {
      try {
        const parsed = JSON.parse(saved);

        if (parsed.length > 0) {
          let updated = false;

          const mapped = parsed.map((c) => {
            if (!c.chat_id) {
              c.chat_id = crypto.randomUUID();
              updated = true;
            }

            return c;
          });

          if (updated) {
            localStorage.setItem(
              storageKeys.conversations,
              JSON.stringify(mapped)
            );
          }

          return mapped;
        }
      } catch (e) {
        console.error("Failed to parse conversations:", e);
      }
    }

    return [createDefaultConversation()];
  }, [storageKeys]);

  // Load conversations from user-scoped local storage
  const [conversations, setConversations] = useState([]);

  // Track the active conversation ID
  const [activeConversationId, setActiveConversationId] = useState(null);

  useEffect(() => {
    if (!storageKeys) return;

    const loadedConversations = loadUserConversations();
    const savedActiveChat = localStorage.getItem(storageKeys.activeChat);
    const parsedActiveChat = savedActiveChat
      ? Number(savedActiveChat)
      : null;

    const activeChatExists = loadedConversations.some(
      (c) => c.id === parsedActiveChat
    );

    const savedSelectedPdf = localStorage.getItem(
      storageKeys.selectedPdf
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConversations(loadedConversations);
    setActiveConversationId(
      activeChatExists ? parsedActiveChat : loadedConversations[0].id
    );
    setSelectedPdf(savedSelectedPdf || null);
    setUploadedFiles([]);
    setQueueJobs([]);
  }, [loadUserConversations, storageKeys]);

  // Find active conversation and derive currentChatId
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ||
    conversations[0] ||
    { messages: [] };

  const currentChatId = activeConversation?.chat_id;

  // Changes when this chat's PDFs change, so an open Mind Map reloads.
  const mindMapRefreshKey = `${uploadedFiles.join("|")}#${queueJobs
    .map((job) => `${job.filename}:${job.status}`)
    .join("|")}`;

  // Persist conversations in localStorage
  useEffect(() => {
    if (storageKeys && conversations.length > 0) {
      localStorage.setItem(
        storageKeys.conversations,
        JSON.stringify(conversations)
      );
    }
  }, [conversations, storageKeys]);

  useEffect(() => {
    if (storageKeys && activeConversationId) {
      localStorage.setItem(
        storageKeys.activeChat,
        activeConversationId
      );
    }
  }, [activeConversationId, storageKeys]);

  useEffect(() => {
    if (!storageKeys) return;

    if (selectedPdf) {
      localStorage.setItem(storageKeys.selectedPdf, selectedPdf);
    } else {
      localStorage.removeItem(storageKeys.selectedPdf);
    }
  }, [selectedPdf, storageKeys]);

  // Drawer: Esc closes it
  useEffect(() => {
    if (!sidebarOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  // Close drawer when screen becomes larger
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;

    const query = window.matchMedia("(min-width: 769px)");

    const onChange = (event) => {
      if (event.matches) setSidebarOpen(false);
    };

    query.addEventListener?.("change", onChange);

    return () => query.removeEventListener?.("change", onChange);
  }, []);

  // Open the cited PDF page of the ACTIVE chat
  const openCitation = (citation) => {
    if (!currentChatId || !canOpenCitation(citation)) return;

    lastFocusRef.current = document.activeElement;

    setViewer({
      chatId: currentChatId,
      filename: citation.filename,
      page: citation.page,
    });
  };

  const closeViewer = () => {
    setViewer(null);
    lastFocusRef.current?.focus?.();
  };

  // Fetch uploaded files from backend
  const fetchUploadedFiles = async (chatId) => {
    if (!chatId) return;

    try {
      const response = await api.get("/files", {
        params: { chat_id: chatId },
      });

      setUploadedFiles(response.data);
    } catch (error) {
      console.error("Error fetching uploaded files:", error);
    }
  };

  // Fetch FIFO document queue processing statuses
  const fetchQueueStatus = async (chatId) => {
    if (!chatId) return;

    try {
      const response = await api.get("/upload/status", {
        params: { chat_id: chatId },
      });

      setQueueJobs(response.data || []);
    } catch (error) {
      console.error("Error fetching queue status:", error);
    }
  };

  useEffect(() => {
    if (currentChatId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchUploadedFiles(currentChatId);
      fetchQueueStatus(currentChatId);
    }
  }, [currentChatId]);

  // Create a new empty conversation and select it
  const createNewConversation = () => {
    const newId = Date.now();

    const newConv = {
      id: newId,
      title: `Conversation ${conversations.length + 1}`,
      messages: [],
      chat_id: crypto.randomUUID(),
    };

    setConversations((prev) => [...prev, newConv]);
    setActiveConversationId(newId);
  };

  // Delete a conversation from backend first, then frontend
  const deleteConversation = async (id, event) => {
    event?.stopPropagation();

    const conversationToDelete = conversations.find(
      (c) => c.id === id
    );

    if (!conversationToDelete) {
      console.error("Conversation not found.");
      return;
    }

    const chatId = conversationToDelete.chat_id;

    if (!chatId) {
      alert("This conversation does not have a valid chat ID.");
      return;
    }

    if (deletingChatsRef.current.has(chatId)) {
      return;
    }

    if (
      !window.confirm(
        "Are you sure you want to delete this conversation and all its uploaded data?"
      )
    ) {
      return;
    }

    deletingChatsRef.current.add(chatId);

    try {
      // Step 1: Delete chat data from backend
      await api.delete(`/chats/${encodeURIComponent(chatId)}`);

      // Step 2: Only after backend success, update frontend state
      const remaining = conversations.filter((c) => c.id !== id);
      const isActiveChat = activeConversationId === id;

      if (remaining.length === 0) {
        // Keep one fresh conversation if the last chat was deleted
        const newConversation = createDefaultConversation();

        setConversations([newConversation]);
        setActiveConversationId(newConversation.id);
      } else {
        setConversations(remaining);

        // If active conversation was deleted, select another one
        if (isActiveChat) {
          setActiveConversationId(remaining[0].id);
        }
      }

      // Reset chat-specific UI state when the active chat is deleted
      if (isActiveChat) {
        setUploadedFiles([]);
        setQueueJobs([]);
        setFiles([]);
        setSelectedPdf(null);
        setUploadStatus("");
        setQuestion("");
        setViewer(null);
      }

      console.log("Chat deleted successfully:", chatId);
    } catch (error) {
      console.error("Error deleting conversation:", error);

      const message =
        error.response?.data?.detail ||
        error.response?.data?.message ||
        "Could not delete this conversation from the server. Please try again.";

      alert(message);
    } finally {
      deletingChatsRef.current.delete(chatId);
    }
  };

  // Helper: auto-update conversation title on first message
  const updateConversationTitle = (convId, text) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === convId && c.title.startsWith("Conversation")) {
          const truncated =
            text.length > 22 ? text.slice(0, 22) + "..." : text;

          return { ...c, title: truncated };
        }

        return c;
      })
    );
  };

  // Upload Multiple PDFs via FIFO Document Queue
  const uploadPdf = async () => {
    if (!files || files.length === 0) {
      alert("Please select at least one PDF first.");
      return;
    }

    if (!currentChatId) {
      alert("Please select a conversation first.");
      return;
    }

    const duplicate = files.find((f) =>
      uploadedFiles.includes(f.name)
    );

    if (duplicate) {
      alert(
        `A file named "${duplicate.name}" has already been uploaded. Please remove it from your selection or delete the existing one first.`
      );
      return;
    }

    setUploading(true);
    setUploadStatus("Uploading PDFs to queue...");

    const formData = new FormData();
    formData.append("chat_id", currentChatId);

    files.forEach((f) => {
      formData.append("files", f);
    });

    try {
      const response = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const data = response.data;

      setUploadStatus(data.message);

      if (data.jobs) {
        setQueueJobs(data.jobs);
      }

      await fetchUploadedFiles(currentChatId);
      setFiles([]);
    } catch (error) {
      console.error(error);

      const message =
        error.response?.data?.detail ||
        "Upload failed. Verify backend is running.";

      setUploadStatus(message);
    } finally {
      setUploading(false);
    }
  };

  // Delete PDF from disk and vector store
  const deletePdf = async (filename) => {
    if (!window.confirm(`Are you sure you want to delete "${filename}"?`)) {
      return;
    }

    try {
      await api.delete(
        `/files/${encodeURIComponent(filename)}`,
        {
          params: { chat_id: currentChatId },
        }
      );

      await fetchUploadedFiles(currentChatId);
      await fetchQueueStatus(currentChatId);

      // If the active scope was the deleted PDF, reset scope
      if (selectedPdf === filename) {
        setSelectedPdf(null);
      }
    } catch (error) {
      console.error("Error deleting PDF:", error);
      alert("Network error deleting PDF.");
    }
  };

  // Ask Question scoped to selectedPdf
  const askQuestion = async () => {
    if (!question.trim()) return;

    const userQuestion = question;
    const chatIdAtRequest = currentChatId;
    const conversationIdAtRequest = activeConversationId;

    if (!chatIdAtRequest) return;

    // Append User Message to Active Chat
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === conversationIdAtRequest) {
          return {
            ...c,
            messages: [
              ...c.messages,
              { role: "user", text: userQuestion },
            ],
          };
        }

        return c;
      })
    );

    const activeConv = conversations.find(
      (c) => c.id === conversationIdAtRequest
    );

    const isFirstMessage = activeConv
      ? activeConv.messages.length === 0
      : true;

    setQuestion("");
    setLoading(true);

    try {
      const response = await api.post("/ask", {
        question: userQuestion,
        chat_id: chatIdAtRequest,
        filename: selectedPdf,
      });

      const data = response.data;

      // Append Assistant Message to the original conversation
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === conversationIdAtRequest) {
            return {
              ...c,
              messages: [
                ...c.messages,
                {
                  role: "assistant",
                  text: data.answer,
                  citations: normalizeCitations(data.citations),
                },
              ],
            };
          }

          return c;
        })
      );

      // Name conversation after the users first query
      if (isFirstMessage) {
        updateConversationTitle(
          conversationIdAtRequest,
          userQuestion
        );
      }
    } catch (error) {
      console.error(error);

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === conversationIdAtRequest) {
            return {
              ...c,
              messages: [
                ...c.messages,
                {
                  role: "assistant",
                  text: "Failed to connect to the backend. Please ensure the study assistant server is online.",
                },
              ],
            };
          }

          return c;
        })
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <Sidebar
        currentUser={currentUser}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={(id) => {
          setActiveConversationId(id);
          setSidebarOpen(false);
        }}
        onCreateConversation={() => {
          createNewConversation();
          setSidebarOpen(false);
        }}
        onDeleteConversation={deleteConversation}
        uploadedFiles={uploadedFiles}
        selectedPdf={selectedPdf}
        onSelectPdf={(pdf) => {
          setSelectedPdf(pdf);
          setSidebarOpen(false);
        }}
        onDeletePdf={deletePdf}
        currentChatId={currentChatId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className="main-content">
        <Header
          activePdf={selectedPdf}
          onMenuClick={() => setSidebarOpen(true)}
          menuOpen={sidebarOpen}
        />

        <ViewTabs activeView={activeView} onChange={changeView} />

        <div
          className="chat-container"
          id={viewPanelId(VIEW_CHAT)}
          role="tabpanel"
          aria-labelledby={viewTabId(VIEW_CHAT)}
          style={activeView === VIEW_CHAT ? undefined : { display: "none" }}
        >
          <UploadBox
            files={files}
            setFiles={setFiles}
            uploadPdf={uploadPdf}
            uploadStatus={uploadStatus}
            uploading={uploading}
            queueJobs={queueJobs}
          />

          <ChatBox
            messages={activeConversation.messages}
            loading={loading}
            onOpenCitation={openCitation}
          />

          <ChatInput
            question={question}
            setQuestion={setQuestion}
            askQuestion={askQuestion}
            loading={loading}
          />
        </div>

        {mindMapOpened && currentChatId && (
          <div
            className="mindmap-tabpanel"
            id={viewPanelId(VIEW_MINDMAP)}
            role="tabpanel"
            aria-labelledby={viewTabId(VIEW_MINDMAP)}
            style={
              activeView === VIEW_MINDMAP ? undefined : { display: "none" }
            }
          >
            <MindMapPanel
              key={currentChatId}
              chatId={currentChatId}
              active={activeView === VIEW_MINDMAP}
              refreshKey={mindMapRefreshKey}
              onOpenSource={openCitation}
              onGoToChat={() => changeView(VIEW_CHAT)}
            />
          </div>
        )}
      </div>

      {viewer && (
        <Suspense fallback={null}>
          <PdfViewerModal
            key={`${viewer.chatId}|${viewer.filename}|${viewer.page}`}
            chatId={viewer.chatId}
            filename={viewer.filename}
            page={viewer.page}
            onClose={closeViewer}
          />
        </Suspense>
      )}
    </div>
  );
}

export default StudyPilot;
