import { useState, useRef, useCallback, useEffect } from "react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ScatterChart, Scatter, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ── Utilities ─────────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => {
      const n = parseFloat(vals[i]);
      obj[h] = isNaN(n) ? vals[i] : n;
    });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== "" && v !== undefined));
  return { headers, rows };
}

function parseJSON(text) {
  try {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : data.data || data.rows || Object.values(data);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const headers = Object.keys(arr[0]);
    return { headers, rows: arr };
  } catch { return null; }
}

function detectColumnTypes(rows, headers) {
  const types = {};
  headers.forEach(h => {
    const vals = rows.map(r => r[h]).filter(v => v !== null && v !== undefined && v !== "");
    const numCount = vals.filter(v => typeof v === "number" || !isNaN(parseFloat(v))).length;
    types[h] = numCount / vals.length > 0.8 ? "numeric" : "categorical";
  });
  return types;
}

function computeStats(rows, col) {
  const vals = rows.map(r => r[col]).filter(v => typeof v === "number");
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = vals.reduce((s, v) => s + v, 0);
  const mean = sum / vals.length;
  const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return {
    count: vals.length, sum: sum.toFixed(2), mean: mean.toFixed(2),
    median, q1, q3, std: Math.sqrt(variance).toFixed(2),
    min: sorted[0], max: sorted[sorted.length - 1],
    nulls: rows.length - vals.length
  };
}

function frequencyCount(rows, col, top = 10) {
  const freq = {};
  rows.forEach(r => { const v = r[col]; freq[v] = (freq[v] || 0) + 1; });
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([name, value]) => ({ name: String(name).slice(0, 20), value }));
}

function correlationMatrix(rows, numCols) {
  const result = [];
  numCols.forEach(a => {
    numCols.forEach(b => {
      const va = rows.map(r => r[a]);
      const vb = rows.map(r => r[b]);
      const ma = va.reduce((s, v) => s + v, 0) / va.length;
      const mb = vb.reduce((s, v) => s + v, 0) / vb.length;
      const num = va.reduce((s, v, i) => s + (v - ma) * (vb[i] - mb), 0);
      const den = Math.sqrt(va.reduce((s, v) => s + Math.pow(v - ma, 2), 0) * vb.reduce((s, v) => s + Math.pow(v - mb, 2), 0));
      result.push({ a, b, r: den ? +(num / den).toFixed(2) : 0 });
    });
  });
  return result;
}

// ── Claude API ────────────────────────────────────────────────────────────────

async function askClaude(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages
    })
  });
  const data = await res.json();
  return data.content?.map(b => b.text || "").join("") || "No response.";
}

// ── Color Palette ─────────────────────────────────────────────────────────────

const COLORS = ["#00E5CC", "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#C77DFF", "#FF9A3C", "#FF61A6"];
const CORR_COLOR = (v) => {
  if (v > 0.7) return "#00E5CC";
  if (v > 0.3) return "#6BCB77";
  if (v > -0.3) return "#444";
  if (v > -0.7) return "#FF9A3C";
  return "#FF6B6B";
};

// ── Main Component ─────────────────────────────────────────────────────────────

export default function DataAnalystAgent() {
  const [dataset, setDataset] = useState(null);
  const [fileName, setFileName] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", content: "👋 Hello! I'm your AI Data Analyst. Upload a CSV or JSON file, or paste data below — then ask me anything about your data." }
  ]);
  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [dashboardCharts, setDashboardCharts] = useState([]);
  const [selectedX, setSelectedX] = useState("");
  const [selectedY, setSelectedY] = useState("");
  const [chartType, setChartType] = useState("bar");
  const fileRef = useRef();
  const chatEndRef = useRef();

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  const loadData = useCallback((text, name) => {
    let parsed = parseCSV(text) || parseJSON(text);
    if (!parsed) { alert("Could not parse file. Try CSV or JSON."); return; }
    const colTypes = detectColumnTypes(parsed.rows, parsed.headers);
    setDataset({ ...parsed, colTypes, raw: text });
    setFileName(name);
    const numCols = parsed.headers.filter(h => colTypes[h] === "numeric");
    setSelectedX(parsed.headers[0]);
    setSelectedY(numCols[0] || parsed.headers[1] || parsed.headers[0]);
    setChatMessages(prev => [...prev, {
      role: "assistant",
      content: `✅ Loaded **${name}** — ${parsed.rows.length} rows × ${parsed.headers.length} columns.\n\nColumns: ${parsed.headers.join(", ")}\n\nWhat would you like to explore?`
    }]);
    setActiveTab("overview");
  }, []);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => loadData(ev.target.result, file.name);
    reader.readAsText(file);
  };

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    loadData(pasteText, "pasted-data.csv");
    setPasteMode(false);
    setPasteText("");
  };

  const loadSample = () => {
    const headers = ["Month", "Revenue", "Expenses", "Profit", "Customers", "Region"];
    const regions = ["North", "South", "East", "West"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const rows = months.map((m, i) => ({
      Month: m,
      Revenue: Math.round(80000 + Math.random() * 60000 + i * 3000),
      Expenses: Math.round(50000 + Math.random() * 30000 + i * 1000),
      Profit: 0,
      Customers: Math.round(200 + Math.random() * 300 + i * 15),
      Region: regions[i % 4]
    }));
    rows.forEach(r => r.Profit = r.Revenue - r.Expenses);
    const csv = [headers.join(","), ...rows.map(r => headers.map(h => r[h]).join(","))].join("\n");
    loadData(csv, "sample-business-data.csv");
  };

  const sendMessage = async () => {
    if (!userInput.trim()) return;
    const msg = userInput.trim();
    setUserInput("");
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setLoading(true);

    const systemPrompt = dataset
      ? `You are an expert data analyst AI. The user has loaded a dataset.
Dataset: ${dataset.rows.length} rows, ${dataset.headers.length} columns: ${dataset.headers.join(", ")}
Column types: ${JSON.stringify(dataset.colTypes)}
Sample rows (first 5): ${JSON.stringify(dataset.rows.slice(0, 5))}
Stats for numeric cols: ${dataset.headers.filter(h => dataset.colTypes[h] === "numeric").map(h => `${h}: ${JSON.stringify(computeStats(dataset.rows, h))}`).join("; ")}

Provide insightful, concise analysis. Use bullet points where helpful. Be specific with numbers. Flag anomalies, trends, and actionable insights.`
      : `You are an expert data analyst AI assistant. Help the user with data analysis concepts, SQL queries, Python/R code, statistical methods, visualization advice, and best practices. Be concise and practical.`;

    const history = chatMessages.filter(m => m.role !== "system").slice(-10).map(m => ({
      role: m.role, content: m.content
    }));

    try {
      const reply = await askClaude([...history, { role: "user", content: msg }], systemPrompt);
      setChatMessages(prev => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: "assistant", content: "⚠️ Error reaching Claude API. Please check your connection." }]);
    }
    setLoading(false);
  };

  const addToDashboard = () => {
    if (!dataset || !selectedX || !selectedY) return;
    setDashboardCharts(prev => [...prev, { id: Date.now(), type: chartType, x: selectedX, y: selectedY }]);
    setActiveTab("dashboard");
  };

  const removeChart = (id) => setDashboardCharts(prev => prev.filter(c => c.id !== id));

  // ── Derived Data ──────────────────────────────────────────────────────────

  const numCols = dataset ? dataset.headers.filter(h => dataset.colTypes[h] === "numeric") : [];
  const catCols = dataset ? dataset.headers.filter(h => dataset.colTypes[h] === "categorical") : [];
  const corrData = dataset && numCols.length >= 2 ? correlationMatrix(dataset.rows, numCols.slice(0, 6)) : [];

  const renderChart = ({ type, x, y }, data, height = 220) => {
    const chartData = data || (dataset ? dataset.rows.slice(0, 50) : []);
    const props = { data: chartData, margin: { top: 5, right: 20, bottom: 5, left: 0 } };
    const common = <>
      <CartesianGrid strokeDasharray="3 3" stroke="#222" />
      <XAxis dataKey={x} tick={{ fill: "#888", fontSize: 11 }} />
      <YAxis tick={{ fill: "#888", fontSize: 11 }} />
      <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }} />
      <Legend />
    </>;
    if (type === "bar") return <ResponsiveContainer width="100%" height={height}><BarChart {...props}>{common}<Bar dataKey={y} fill="#00E5CC" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer>;
    if (type === "line") return <ResponsiveContainer width="100%" height={height}><LineChart {...props}>{common}<Line type="monotone" dataKey={y} stroke="#00E5CC" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer>;
    if (type === "area") return <ResponsiveContainer width="100%" height={height}><AreaChart {...props}>{common}<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#00E5CC" stopOpacity={0.3}/><stop offset="95%" stopColor="#00E5CC" stopOpacity={0}/></linearGradient></defs><Area type="monotone" dataKey={y} stroke="#00E5CC" fill="url(#ag)" /></AreaChart></ResponsiveContainer>;
    if (type === "scatter") return <ResponsiveContainer width="100%" height={height}><ScatterChart {...props}>{common}<Scatter data={chartData} fill="#00E5CC" /></ScatterChart></ResponsiveContainer>;
    if (type === "pie") {
      const fd = frequencyCount(chartData, x);
      return <ResponsiveContainer width="100%" height={height}><PieChart><Pie data={fd} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={{ stroke: "#555" }}>{fd.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }} /></PieChart></ResponsiveContainer>;
    }
    return null;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs = [
    { id: "overview", label: "📊 Overview" },
    { id: "explore", label: "🔍 Explore" },
    { id: "stats", label: "📈 Statistics" },
    { id: "dashboard", label: "🖥 Dashboard" },
    { id: "chat", label: "🤖 AI Chat" },
  ];

  return (
    <div style={{ fontFamily: "'DM Mono', 'Courier New', monospace", background: "#080808", minHeight: "100vh", color: "#e0e0e0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Clash+Display:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #00E5CC44; }
        .tab-btn { background: none; border: none; cursor: pointer; padding: 10px 18px; font-family: inherit; font-size: 13px; color: #666; border-bottom: 2px solid transparent; transition: all 0.2s; white-space: nowrap; }
        .tab-btn:hover { color: #aaa; }
        .tab-btn.active { color: #00E5CC; border-bottom-color: #00E5CC; }
        .card { background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 12px; padding: 20px; }
        .stat-card { background: #0f0f0f; border: 1px solid #1e1e1e; border-radius: 10px; padding: 16px; }
        .btn { padding: 9px 18px; border-radius: 8px; border: none; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .btn-primary { background: #00E5CC; color: #000; }
        .btn-primary:hover { background: #00ffdd; transform: translateY(-1px); }
        .btn-ghost { background: #1a1a1a; color: #aaa; border: 1px solid #2a2a2a; }
        .btn-ghost:hover { background: #222; color: #e0e0e0; }
        .btn-danger { background: #1a0a0a; color: #FF6B6B; border: 1px solid #FF6B6B33; }
        .btn-danger:hover { background: #FF6B6B22; }
        select, input, textarea { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; color: #e0e0e0; font-family: inherit; font-size: 13px; padding: 9px 12px; outline: none; transition: border-color 0.2s; }
        select:focus, input:focus, textarea:focus { border-color: #00E5CC44; }
        .tag { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; }
        .tag-num { background: #00E5CC15; color: #00E5CC; border: 1px solid #00E5CC33; }
        .tag-cat { background: #FF6B6B15; color: #FF6B6B; border: 1px solid #FF6B6B33; }
        .chat-bubble { padding: 12px 16px; border-radius: 12px; font-size: 13.5px; line-height: 1.6; max-width: 88%; white-space: pre-wrap; word-break: break-word; }
        .chat-user { background: #00E5CC18; border: 1px solid #00E5CC33; align-self: flex-end; color: #e8fffc; }
        .chat-ai { background: #141414; border: 1px solid #222; align-self: flex-start; }
        .upload-zone { border: 2px dashed #2a2a2a; border-radius: 16px; padding: 48px 32px; text-align: center; cursor: pointer; transition: all 0.3s; }
        .upload-zone:hover { border-color: #00E5CC55; background: #00E5CC05; }
        .corr-cell { width: 70px; height: 50px; display: flex; align-items: center; justify-content: center; font-size: 12px; border-radius: 6px; font-weight: 500; }
        .pulse { animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        .fade-in { animation: fadeIn 0.4s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1a1a1a", padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, background: "#080808", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #00E5CC, #4D96FF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: "-0.5px", color: "#fff" }}>DataMind <span style={{ color: "#00E5CC" }}>AI</span></div>
            <div style={{ fontSize: 11, color: "#555" }}>Intelligent Data Analyst Agent</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {dataset && (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#555", background: "#111", padding: "6px 12px", borderRadius: 20, border: "1px solid #1e1e1e" }}>
              📁 <span style={{ color: "#aaa" }}>{fileName}</span>
              <span style={{ color: "#444", margin: "0 6px" }}>|</span>
              <span style={{ color: "#00E5CC" }}>{dataset.rows.length}</span><span style={{ color: "#555" }}> rows</span>
              <span style={{ color: "#444", margin: "0 6px" }}>×</span>
              <span style={{ color: "#00E5CC" }}>{dataset.headers.length}</span><span style={{ color: "#555" }}> cols</span>
            </div>
          </div>
        )}
        <button className="btn btn-ghost" onClick={() => fileRef.current.click()} style={{ fontSize: 12 }}>+ Load Data</button>
        <input ref={fileRef} type="file" accept=".csv,.json,.txt" style={{ display: "none" }} onChange={handleFile} />
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #151515", padding: "0 24px", display: "flex", gap: 0, overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t.id} className={`tab-btn ${activeTab === t.id ? "active" : ""}`} onClick={() => setActiveTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === "overview" && (
          <div className="fade-in">
            {!dataset ? (
              <div style={{ maxWidth: 640, margin: "60px auto" }}>
                <div className="upload-zone" onClick={() => fileRef.current.click()}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
                  <div style={{ fontFamily: "'Clash Display', sans-serif", fontSize: 22, fontWeight: 600, color: "#fff", marginBottom: 8 }}>Drop your data here</div>
                  <div style={{ color: "#555", fontSize: 13, marginBottom: 24 }}>Supports CSV and JSON files</div>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-primary" onClick={e => { e.stopPropagation(); fileRef.current.click(); }}>📁 Browse File</button>
                    <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); setPasteMode(true); }}>📋 Paste Data</button>
                    <button className="btn btn-ghost" onClick={e => { e.stopPropagation(); loadSample(); }}>⚡ Load Sample</button>
                  </div>
                </div>
                {pasteMode && (
                  <div className="card fade-in" style={{ marginTop: 20 }}>
                    <div style={{ fontWeight: 600, marginBottom: 12 }}>Paste CSV / JSON data</div>
                    <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste your CSV or JSON data here..." rows={8} style={{ width: "100%", resize: "vertical" }} />
                    <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                      <button className="btn btn-primary" onClick={handlePaste}>Parse & Load</button>
                      <button className="btn btn-ghost" onClick={() => setPasteMode(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  {[
                    { icon: "📊", title: "Auto Visualization", desc: "Charts generated instantly from your data" },
                    { icon: "🤖", title: "AI Insights", desc: "Claude analyzes patterns and anomalies" },
                    { icon: "📋", title: "Full Statistics", desc: "Descriptive stats, correlation, distributions" },
                  ].map(f => (
                    <div key={f.title} className="stat-card" style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#fff", marginBottom: 4 }}>{f.title}</div>
                      <div style={{ fontSize: 11, color: "#555" }}>{f.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                {/* KPI Cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
                  <div className="stat-card">
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>ROWS</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#00E5CC", fontFamily: "'Clash Display', sans-serif" }}>{dataset.rows.length.toLocaleString()}</div>
                  </div>
                  <div className="stat-card">
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>COLUMNS</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#4D96FF", fontFamily: "'Clash Display', sans-serif" }}>{dataset.headers.length}</div>
                  </div>
                  <div className="stat-card">
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>NUMERIC</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#6BCB77", fontFamily: "'Clash Display', sans-serif" }}>{numCols.length}</div>
                  </div>
                  <div className="stat-card">
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>CATEGORICAL</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#FFD93D", fontFamily: "'Clash Display', sans-serif" }}>{catCols.length}</div>
                  </div>
                  {numCols.length > 0 && (() => {
                    const s = computeStats(dataset.rows, numCols[0]);
                    return s ? (
                      <div className="stat-card">
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>{numCols[0].toUpperCase()} AVG</div>
                        <div style={{ fontSize: 32, fontWeight: 700, color: "#C77DFF", fontFamily: "'Clash Display', sans-serif" }}>{Number(s.mean).toLocaleString()}</div>
                      </div>
                    ) : null;
                  })()}
                </div>

                {/* Column Overview */}
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 14, color: "#fff" }}>Column Schema</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {dataset.headers.map(h => (
                      <div key={h} style={{ background: "#141414", border: "1px solid #1e1e1e", borderRadius: 8, padding: "8px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, color: "#ddd" }}>{h}</span>
                        <span className={`tag ${dataset.colTypes[h] === "numeric" ? "tag-num" : "tag-cat"}`}>{dataset.colTypes[h]}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quick Charts */}
                {numCols.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
                    {numCols.slice(0, 2).map(col => (
                      <div key={col} className="card">
                        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 13 }}>{col} — Distribution</div>
                        {renderChart({ type: "bar", x: dataset.headers[0], y: col }, dataset.rows.slice(0, 20))}
                      </div>
                    ))}
                    {catCols.slice(0, 1).map(col => (
                      <div key={col} className="card">
                        <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 13 }}>{col} — Frequency</div>
                        {renderChart({ type: "pie", x: col, y: col }, dataset.rows)}
                      </div>
                    ))}
                  </div>
                )}

                {/* Data Preview */}
                <div className="card" style={{ marginTop: 20 }}>
                  <div style={{ fontWeight: 600, marginBottom: 14, color: "#fff" }}>Data Preview <span style={{ color: "#555", fontWeight: 400 }}>(first 10 rows)</span></div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr>{dataset.headers.map(h => <th key={h} style={{ textAlign: "left", padding: "8px 14px", color: "#555", borderBottom: "1px solid #1e1e1e", whiteSpace: "nowrap" }}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {dataset.rows.slice(0, 10).map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #111" }}>
                            {dataset.headers.map(h => (
                              <td key={h} style={{ padding: "8px 14px", color: dataset.colTypes[h] === "numeric" ? "#00E5CC" : "#bbb", whiteSpace: "nowrap" }}>
                                {typeof row[h] === "number" ? row[h].toLocaleString() : String(row[h] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── EXPLORE TAB ── */}
        {activeTab === "explore" && dataset && (
          <div className="fade-in">
            <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
              <select value={selectedX} onChange={e => setSelectedX(e.target.value)}>
                {dataset.headers.map(h => <option key={h}>{h}</option>)}
              </select>
              <select value={selectedY} onChange={e => setSelectedY(e.target.value)}>
                {dataset.headers.map(h => <option key={h}>{h}</option>)}
              </select>
              <select value={chartType} onChange={e => setChartType(e.target.value)}>
                <option value="bar">Bar Chart</option>
                <option value="line">Line Chart</option>
                <option value="area">Area Chart</option>
                <option value="scatter">Scatter Plot</option>
                <option value="pie">Pie Chart</option>
              </select>
              <button className="btn btn-primary" onClick={addToDashboard}>+ Add to Dashboard</button>
            </div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 14 }}>{selectedY} by {selectedX}</div>
              {renderChart({ type: chartType, x: selectedX, y: selectedY }, dataset.rows.slice(0, 50), 340)}
            </div>
            {catCols.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
                {catCols.slice(0, 3).map(col => (
                  <div key={col} className="card">
                    <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 13 }}>{col} — Top Values</div>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={frequencyCount(dataset.rows, col)} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                        <XAxis type="number" tick={{ fill: "#555", fontSize: 11 }} />
                        <YAxis dataKey="name" type="category" width={80} tick={{ fill: "#aaa", fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "#111", border: "1px solid #333", borderRadius: 8 }} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>{frequencyCount(dataset.rows, col).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STATISTICS TAB ── */}
        {activeTab === "stats" && dataset && (
          <div className="fade-in">
            {numCols.length > 0 && (
              <div>
                <div style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 16, marginBottom: 16, color: "#fff" }}>Descriptive Statistics</div>
                <div style={{ overflowX: "auto", marginBottom: 28 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1e1e1e" }}>
                        {["Column","Count","Mean","Median","Std Dev","Min","Q1","Q3","Max","Nulls"].map(h => (
                          <th key={h} style={{ padding: "10px 14px", color: "#555", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {numCols.map(col => {
                        const s = computeStats(dataset.rows, col);
                        if (!s) return null;
                        return (
                          <tr key={col} style={{ borderBottom: "1px solid #111" }}>
                            <td style={{ padding: "10px 14px", color: "#00E5CC", fontWeight: 500 }}>{col}</td>
                            {[s.count, s.mean, s.median, s.std, s.min, s.q1, s.q3, s.max, s.nulls].map((v, i) => (
                              <td key={i} style={{ padding: "10px 14px", color: i === 8 && s.nulls > 0 ? "#FF6B6B" : "#bbb" }}>{typeof v === "number" ? v.toLocaleString() : v}</td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {numCols.length >= 2 && (
                  <div>
                    <div style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 600, fontSize: 16, marginBottom: 16, color: "#fff" }}>Correlation Matrix</div>
                    <div className="card" style={{ overflowX: "auto" }}>
                      <div style={{ display: "grid", gridTemplateColumns: `120px ${numCols.slice(0,6).map(() => "70px").join(" ")}`, gap: 4, alignItems: "center" }}>
                        <div />
                        {numCols.slice(0, 6).map(h => <div key={h} style={{ fontSize: 11, color: "#555", textAlign: "center", padding: "4px 0" }}>{h.slice(0, 8)}</div>)}
                        {numCols.slice(0, 6).map(a => (
                          <>
                            <div key={a} style={{ fontSize: 11, color: "#555", padding: "2px 8px" }}>{a.slice(0, 14)}</div>
                            {numCols.slice(0, 6).map(b => {
                              const v = corrData.find(c => c.a === a && c.b === b)?.r ?? 0;
                              const abs = Math.abs(v);
                              return (
                                <div key={b} className="corr-cell" style={{ background: a === b ? "#1a1a1a" : `${CORR_COLOR(v)}22`, color: a === b ? "#555" : CORR_COLOR(v), border: `1px solid ${a === b ? "#222" : CORR_COLOR(v) + "44"}` }}>
                                  {a === b ? "—" : v}
                                </div>
                              );
                            })}
                          </>
                        ))}
                      </div>
                      <div style={{ marginTop: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
                        {[["#00E5CC","Strong +"],["#6BCB77","Moderate +"],["#FF9A3C","Moderate −"],["#FF6B6B","Strong −"]].map(([c,l]) => (
                          <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#555" }}>
                            <div style={{ width: 12, height: 12, borderRadius: 3, background: c + "44", border: `1px solid ${c}44` }} />
                            {l}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <div className="fade-in">
            {dashboardCharts.length === 0 ? (
              <div style={{ textAlign: "center", padding: "80px 0", color: "#444" }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🖥</div>
                <div style={{ fontSize: 18, color: "#555", marginBottom: 8 }}>Your dashboard is empty</div>
                <div style={{ fontSize: 13, color: "#333", marginBottom: 24 }}>Go to the Explore tab and add charts to your dashboard</div>
                <button className="btn btn-ghost" onClick={() => setActiveTab("explore")}>Go to Explore →</button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ fontFamily: "'Clash Display', sans-serif", fontWeight: 700, fontSize: 20, color: "#fff" }}>My Dashboard</div>
                  <button className="btn btn-ghost" onClick={() => setActiveTab("explore")}>+ Add Chart</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 16 }}>
                  {dashboardCharts.map(c => (
                    <div key={c.id} className="card" style={{ position: "relative" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{c.y} by {c.x} <span style={{ color: "#444", fontWeight: 400 }}>({c.type})</span></div>
                        <button className="btn btn-danger" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => removeChart(c.id)}>✕</button>
                      </div>
                      {dataset && renderChart(c, dataset.rows.slice(0, 50))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CHAT TAB ── */}
        {activeTab === "chat" && (
          <div className="fade-in" style={{ maxWidth: 820, margin: "0 auto" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 20, maxHeight: "60vh", overflowY: "auto", padding: "4px 0" }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div className={`chat-bubble ${m.role === "user" ? "chat-user" : "chat-ai"}`}>
                    {m.role === "assistant" && <span style={{ color: "#00E5CC", fontWeight: 600, fontSize: 12, display: "block", marginBottom: 4 }}>⚡ DataMind AI</span>}
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex" }}>
                  <div className="chat-bubble chat-ai">
                    <span className="pulse" style={{ color: "#555" }}>⚡ Analyzing...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Quick prompts */}
            {dataset && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {[
                  "Summarize this dataset",
                  "What are the key insights?",
                  "Are there any anomalies?",
                  "What trends do you see?",
                  "Which columns are most correlated?",
                ].map(q => (
                  <button key={q} className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 12px" }} onClick={() => { setUserInput(q); }}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={dataset ? "Ask about your data... (Enter to send)" : "Ask a data analysis question..."}
                style={{ flex: 1 }}
                disabled={loading}
              />
              <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !userInput.trim()}>
                {loading ? "..." : "Send"}
              </button>
            </div>
          </div>
        )}

        {/* No data warning for tabs that need it */}
        {!dataset && ["explore", "stats", "dashboard"].includes(activeTab) && (
          <div className="fade-in" style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📂</div>
            <div style={{ fontSize: 16, color: "#555", marginBottom: 20 }}>No data loaded yet</div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => fileRef.current.click()}>Load a File</button>
              <button className="btn btn-ghost" onClick={loadSample}>Load Sample Data</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
