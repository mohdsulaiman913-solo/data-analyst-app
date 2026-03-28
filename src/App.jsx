import { useState, useRef, useEffect } from "react";
import { sendToClaudeAPI } from "./services/claudeApi";
import "./App.css";

function App() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "👋 Hello! I'm your AI Data Analyst. You can ask me to analyze data, explain trends, write SQL queries, help with Python/pandas code, or answer any data-related questions. You can also paste CSV data directly in the chat!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadedData, setUploadedData] = useState(null);
  const [fileName, setFileName] = useState("");
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith(".csv") && !file.name.endsWith(".txt") && !file.name.endsWith(".json")) {
      setError("Please upload a CSV, TXT, or JSON file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedData(ev.target.result);
      setFileName(file.name);
      setError("");
    };
    reader.readAsText(file);
  };

  const clearFile = () => {
    setUploadedData(null);
    setFileName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setError("");
    const userMessage = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      // Build conversation history (exclude the initial assistant greeting)
      const history = updatedMessages
        .slice(1) // skip greeting
        .slice(-10) // keep last 10 messages for context window
        .map((m) => ({ role: m.role, content: m.content }));

      // If file is uploaded, prepend data to the first user message in this turn
      let apiMessages = history;
      if (uploadedData && history.length > 0) {
        const lastIdx = apiMessages.length - 1;
        apiMessages = [
          ...apiMessages.slice(0, lastIdx),
          {
            role: "user",
            content: `Here is my uploaded file (${fileName}):\n\`\`\`\n${uploadedData.slice(0, 8000)}\n\`\`\`\n\nMy question: ${trimmed}`,
          },
        ];
      }

      const reply = await sendToClaudeAPI(apiMessages);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
      // Remove the user message if request failed
      setMessages((prev) => prev.slice(0, -1));
      setInput(trimmed);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        role: "assistant",
        content:
          "👋 Hello! I'm your AI Data Analyst. You can ask me to analyze data, explain trends, write SQL queries, help with Python/pandas code, or answer any data-related questions. You can also paste CSV data directly in the chat!",
      },
    ]);
    setError("");
    clearFile();
  };

  const formatMessage = (content) => {
    // Simple code block formatting
    return content.split(/(```[\s\S]*?```)/g).map((part, i) => {
      if (part.startsWith("```")) {
        const lines = part.split("\n");
        const lang = lines[0].replace("```", "") || "code";
        const code = lines.slice(1, -1).join("\n");
        return (
          <pre key={i} className="code-block">
            <span className="code-lang">{lang}</span>
            <code>{code}</code>
          </pre>
        );
      }
      return (
        <span key={i} style={{ whiteSpace: "pre-wrap" }}>
          {part}
        </span>
      );
    });
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">📊</span>
            <div>
              <h1>Data Analyst AI</h1>
              <p>Powered by Claude</p>
            </div>
          </div>
        </div>
        <button className="clear-btn" onClick={clearChat} title="Clear chat">
          🗑 Clear Chat
        </button>
      </header>

      {/* Main Chat Area */}
      <main className="chat-container">
        <div className="messages">
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === "assistant" ? "🤖" : "👤"}
              </div>
              <div className="message-bubble">
                {formatMessage(msg.content)}
              </div>
            </div>
          ))}

          {loading && (
            <div className="message assistant">
              <div className="message-avatar">🤖</div>
              <div className="message-bubble typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner">
              ⚠️ {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="input-area">
        {/* File Upload Badge */}
        {fileName && (
          <div className="file-badge">
            <span>📎 {fileName}</span>
            <button onClick={clearFile} className="remove-file">✕</button>
          </div>
        )}

        <div className="input-row">
          {/* File Upload Button */}
          <button
            className="upload-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Upload CSV/TXT/JSON file"
          >
            📎
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,.json"
            onChange={handleFileUpload}
            style={{ display: "none" }}
          />

          {/* Text Input */}
          <textarea
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about data... (Shift+Enter for new line)"
            rows={1}
            disabled={loading}
          />

          {/* Send Button */}
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            title="Send message"
          >
            {loading ? "⏳" : "➤"}
          </button>
        </div>

        <p className="hint">Press Enter to send · Shift+Enter for new line · Upload CSV files for analysis</p>
      </footer>
    </div>
  );
}

export default App;
