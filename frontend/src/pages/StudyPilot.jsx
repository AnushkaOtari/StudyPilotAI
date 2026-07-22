import { useState, useEffect } from "react";
import "../App.css";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import UploadBox from "../components/UploadBox";
import ChatBox from "../components/ChatBox";
import ChatInput from "../components/ChatInput";

function StudyPilot() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  
  // File upload state
  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  // Selected PDF to scope RAG queries (null means query all notes)
  const [selectedPdf, setSelectedPdf] = useState(null);

  // Load conversations from local storage
  const [conversations, setConversations] = useState(() => {
    const saved = localStorage.getItem("studypilot_conversations");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed;
      } catch (e) {
        console.error("Failed to parse conversations:", e);
      }
    }
    return [{ id: Date.now(), title: "Conversation 1", messages: [] }];
  });

  // Track the active conversation ID
  const [activeConversationId, setActiveConversationId] = useState(() => {
    const saved = localStorage.getItem("studypilot_active_conv_id");
    if (saved) {
      const parsedId = Number(saved);
      if (parsedId) return parsedId;
    }
    return conversations[0]?.id || Date.now();
  });

  // Persist conversations in localStorage
  useEffect(() => {
    localStorage.setItem("studypilot_conversations", JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem("studypilot_active_conv_id", activeConversationId);
  }, [activeConversationId]);

  // Fetch already uploaded files from backend on mount
  const fetchUploadedFiles = async () => {
    try {
      const response = await fetch("http://127.0.0.1:8000/files");
      if (response.ok) {
        const files = await response.json();
        setUploadedFiles(files);
      }
    } catch (error) {
      console.error("Error fetching uploaded files:", error);
    }
  };

  useEffect(() => {
    fetchUploadedFiles();
  }, []);

  // Create a new empty conversation and select it
  const createNewConversation = () => {
    const newId = Date.now();
    const newConv = {
      id: newId,
      title: `Conversation ${conversations.length + 1}`,
      messages: []
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
      setConversations([{ id: newId, title: "Conversation 1", messages: [] }]);
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

  // Upload PDF
  const uploadPdf = async () => {
    if (!file) {
      alert("Please select a PDF first.");
      return;
    }

    if (uploadedFiles.includes(file.name)) {
      alert(`A file named "${file.name}" has already been uploaded. Please choose a different file or delete the existing one first.`);
      setFile(null);
      return;
    }

    setUploading(true);
    setUploadStatus("Uploading PDF...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Server error during upload.");
      }

      const data = await response.json();
      setUploadStatus(data.message);
      
      // Refresh the uploaded file list
      await fetchUploadedFiles();
      setFile(null);
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
      const response = await fetch(
        `http://127.0.0.1:8000/files/${encodeURIComponent(filename)}`,
        { method: "DELETE" }
      );

      if (response.ok) {
        await fetchUploadedFiles();
        // If the active scope was the deleted PDF, reset scope
        if (selectedPdf === filename) {
          setSelectedPdf(null);
        }
      } else {
        alert("Failed to delete PDF from backend.");
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
      const response = await fetch("http://127.0.0.1:8000/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: userQuestion,
          filename: selectedPdf
        }),
      });

      if (!response.ok) {
        throw new Error("Ask API failure");
      }

      const data = await response.json();

      // Append Assistant Message to Active Chat
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id === activeConversationId) {
            return {
              ...c,
              messages: [
                ...c.messages,
                { role: "assistant", text: data.answer },
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

  // Get active conversation messages
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  ) || conversations[0] || { messages: [] };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onCreateConversation={createNewConversation}
        onDeleteConversation={deleteConversation}
        uploadedFiles={uploadedFiles}
        selectedPdf={selectedPdf}
        onSelectPdf={setSelectedPdf}
        onDeletePdf={deletePdf}
      />

      <div className="main-content">
        <Header activePdf={selectedPdf} />

        <div className="chat-container">
          <UploadBox
            file={file}
            setFile={setFile}
            uploadPdf={uploadPdf}
            uploadStatus={uploadStatus}
            uploading={uploading}
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