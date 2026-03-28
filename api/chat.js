export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Validate API key exists
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "API key not configured on server." });
  }

  // Validate request body
  const { messages, model, max_tokens, system } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Invalid request: messages array is required." });
  }

  try {
    const payload = {
      model: model || "claude-sonnet-4-20250514",
      max_tokens: max_tokens || 2048,
      messages,
    };
    if (system) payload.system = system;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Claude API error",
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      error: "Failed to reach Claude API. Please try again.",
      details: error.message,
    });
  }
}
