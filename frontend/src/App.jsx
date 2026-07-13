import { useState } from "react";
import "./App.css";

import Header from "./components/Header";
import UploadBox from "./components/UploadBox";
import ChatBox from "./components/ChatBox";
import ChatInput from "./components/ChatInput";

function App() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const [file, setFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  // Upload PDF
  const uploadPdf = async () => {
    if (!file) {
      alert("Please select a PDF first.");
      return;
    }

    setUploading(true);
    setUploadStatus("Uploading PDF...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/upload",
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();

      setUploadStatus(data.message);
    } catch (error) {
      setUploadStatus("Upload failed.");
    }

    setUploading(false);
  };

  // Ask Question
  const askQuestion = async () => {
    if (!question.trim()) return;

    const userQuestion = question;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: userQuestion,
      },
    ]);

    setQuestion("");
    setLoading(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/ask",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: userQuestion,
          }),
        }
      );

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
        },
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Something went wrong.",
        },
      ]);
    }

    setLoading(false);
  };

  return (
    <div className="app">

      <Header />

      <UploadBox
        file={file}
        setFile={setFile}
        uploadPdf={uploadPdf}
        uploadStatus={uploadStatus}
        uploading={uploading}
      />

      <ChatBox
        messages={messages}
        loading={loading}
      />

      <ChatInput
        question={question}
        setQuestion={setQuestion}
        askQuestion={askQuestion}
      />

    </div>
  );
}

export default App;