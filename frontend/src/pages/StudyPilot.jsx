import { useState, useEffect, useCallback, useMemo } from "react";
import "../App.css";
import api from "../services/api";
import useAuth from "../hooks/useAuth";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import UploadBox from "../components/UploadBox";
import ChatBox from "../components/ChatBox";
import ChatInput from "../components/ChatInput";
import { normalizeCitations } from "../utils/citations";

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
            localStorage.setItem(storageKeys.conversations, JSON.stringify(mapped));
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
    const parsedActiveChat = savedActiveChat ? Number(savedActiveChat) : null;
    const activeChatExists = loadedConversations.some((c) => c.id === parsedActiveChat);
    const savedSelectedPdf = localStorage.getItem(storageKeys.selectedPdf);

    setConversations(loadedConversations);
    setActiveConversationId(activeChatExists ? parsedActiveChat : loadedConversations[0].id);
    setSelectedPdf(savedSelectedPdf || null);
    setUploadedFiles([]);
    setQueueJobs([]);
  }, [loadUserConversations, storageKeys]);

  // Find active conversation and derive currentChatId
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  ) || conversations[0] || { messages: [] };

  const currentChatId = activeConversation?.chat_id;

  // Persist conversations in localStorage
  useEffect(() => {
    if (storageKeys && conversations.length > 0) {
      localStorage.setItem(storageKeys.conversations, JSON.stringify(conversations));
    }
  }, [conversations, storageKeys]);

  useEffect(() => {
    if (storageKeys && activeConversationId) {
      localStorage.setItem(storageKeys.activeChat, activeConversationId);
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

  // Fetch uploaded files from backend
  const fetchUploadedFiles = async (chatId) => {
    if (!chatId) return;
    try {
      const response = await api.get("/files", { params: { chat_id: chatId } });
      setUploadedFiles(response.data);
    } catch (error) {
      console.error("Error fetching uploaded files:", error);
    }
  };

  // Fetch FIFO document queue processing statuses
  const fetchQueueStatus = async (chatId) => {
    if (!chatId) return;
    try {
      const response = await api.get("/upload/status", { params: { chat_id: chatId } });
      setQueueJobs(response.data || []);
    } catch (error) {
      console.error("Error fetching queue status:", error);
    }
  };

  useEffect(() => {
    if (currentChatId) {
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
      chat_id: crypto.randomUUID()
    };
    setConversations((prev) => [...prev, newConv]);
    setActiveConversationId(newId);
  };

  // Delete a conversation
  const deleteConversation = (id, event) => {
    event.stopPropagation();
    if (conversations.length === 1) {
      // If it's the last chat, clear its messages instead of leaving zero conversations
      const newId = Date.now();
      setConversations([{ id: newId, title: "Conversation 1", messages: [], chat_id: crypto.randomUUID() }]);
      setActiveConversationId(newId);
    } else {
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      // If active conversation was deleted, switch active index
      if (activeConversationId === id) {
        setActiveConversationId(remaining[0].id);
      }
    }
  };

  // Helper: auto-update conversation title on first message
  const updateConversationTitle = (convId, text) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === convId && c.title.startsWith("Conversation")) {
          const truncated = text.length > 22 ? text.slice(0, 22) + "..." : text;
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

    const duplicate = files.find((f) => uploadedFiles.includes(f.name));
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
      
      // Refresh the uploaded file list
      await fetchUploadedFiles(currentChatId);
      setFiles([]);
    } catch (error) {
      console.error(error);
      setUploadStatus("Upload failed. Verify backend is running.");
    } finally {
      setUploading(false);
    }
  };

  // Delete PDF from disk and vector store
  const deletePdf = async (filename) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

    try {
      await api.delete(`/files/${encodeURIComponent(filename)}`, {
        params: { chat_id: currentChatId },
      });
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

    // Append User Message to Active Chat
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id === activeConversationId) {
          return {
            ...c,
            messages: [...c.messages, { role: "user", text: userQuestion }],
          };
        }
        return c;
      })
    );

    const activeConv = conversations.find((c) => c.id === activeConversationId);
    const isFirstMessage = activeConv ? activeConv.messages.length === 0 : true;

    setQuestion("");
    setLoading(true);

    try {
      const response = await api.post("/ask", {
          question: userQuestion,
          chat_id: currentChatId,
          filename: selectedPdf
        });

      const data = response.data;

      // Append Assistant Message to Active Chat
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === activeConversationId) {
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

      // Name conversation after the user's first query
      if (isFirstMessage) {
        updateConversationTitle(activeConversationId, userQuestion);
      }
    } catch (error) {
      console.error(error);
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === activeConversationId) {
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
        onSelectConversation={setActiveConversationId}
        onCreateConversation={createNewConversation}
        onDeleteConversation={deleteConversation}
        uploadedFiles={uploadedFiles}
        selectedPdf={selectedPdf}
        onSelectPdf={setSelectedPdf}
        onDeletePdf={deletePdf}
        currentChatId={currentChatId}
      />

      <div className="main-content">
        <Header activePdf={selectedPdf} />

        <div className="chat-container">
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
          />

          <ChatInput
            question={question}
            setQuestion={setQuestion}
            askQuestion={askQuestion}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

export default StudyPilot;
