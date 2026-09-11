# StudyPilot AI 🎓🤖

> An AI-powered academic study companion that helps students learn, revise, and interact with their study material using Generative AI, RAG, quizzes, and interactive mind maps.

---

## 📌 Overview

StudyPilot AI is an intelligent academic resource management and study planning platform designed to help students access and understand their study material from a single place.

Students can upload academic PDFs and interact with their content using AI. Instead of searching through multiple documents manually, StudyPilot AI uses Retrieval-Augmented Generation (RAG) to retrieve relevant information from the student's uploaded resources and generate context-aware answers.

The platform also provides AI-powered quizzes and interactive mind maps to support active learning and revision.

---

## ✨ Key Features

### 🔐 User Authentication

- User registration and login
- JWT-based authentication
- Protected API endpoints
- Authenticated user sessions
- Logout functionality
- User-specific access to resources

---

### 📚 PDF Resource Management

Students can upload their academic PDFs and manage them within individual chats.

Features include:

- PDF upload
- PDF listing
- PDF deletion
- Text extraction
- Document chunking
- Vector embedding generation
- Persistent FAISS storage

---

### 🧠 Chat-Scoped RAG

One of the core features of StudyPilot AI is its chat-scoped knowledge base.

Each chat has its own vector store.

For example:

```text
Chat A
 ├── AI.pdf
 ├── ML.pdf
 └── DBMS.pdf

Chat B
 ├── Resume.pdf
 └── Interview.pdf
