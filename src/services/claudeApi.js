// src/services/claudeApi.js
// All Claude API calls go through /api/chat (Vercel serverless function)
// NEVER call api.anthropic.com directly from the frontend

const API_ENDPOINT = "/api/chat";

/**
 * Send messages to Claude via the secure backend proxy
 * @param {Array} messages - Array of {role, content} objects
 * @param {Object} options - Optional: model, max_tokens, system prompt
 * @returns {Promise<string>} - Claude's text response
 */
export async function sendToClaudeAPI(messages, options = {}) {
  const {
    model = "claude-sonnet-4-20250514",
    max_tokens = 2048,
    system = "You are an expert data analyst. Help users understand their data, perform analysis, generate insights, and explain results clearly.",
  } = options;

  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model, max_tokens, system }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  if (!data.content || !data.content[0]) {
    throw new Error("Invalid response from Claude API");
  }

  return data.content[0].text;
}

/**
 * Analyze data/CSV content with Claude
 * @param {string} dataContent - The data to analyze (CSV text, JSON, etc.)
 * @param {string} userQuestion - The user's question about the data
 * @param {Array} history - Previous conversation messages
 */
export async function analyzeData(dataContent, userQuestion, history = []) {
  const messages = [
    ...history,
    {
      role: "user",
      content: dataContent
        ? `Here is my data:\n\`\`\`\n${dataContent}\n\`\`\`\n\nMy question: ${userQuestion}`
        : userQuestion,
    },
  ];

  return sendToClaudeAPI(messages);
}
