// Cloudflare Pages Function
// Lives at: /api/chat  (because this file is at functions/api/chat.js)
// The Gemini API key is read from an environment variable (set in the
// Cloudflare Pages dashboard, NOT in this file) so it never reaches the browser.

const ALLOWED_GRADES = ["10", "11"];
const GEMINI_MODEL = "gemini-2.0-flash"; // change if you want a different model
const MAX_HISTORY_MESSAGES = 20; // basic guard against giant payloads

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const { grade, message, history } = body || {};

  // --- Server-side access control (this is the real gate, not the UI toggle) ---
  if (!grade || !ALLOWED_GRADES.includes(String(grade))) {
    return json({ error: "AI Study Bot is only available for Grade 10 and 11 students." }, 403);
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    return json({ error: "Message is required." }, 400);
  }

  if (message.length > 4000) {
    return json({ error: "Message too long." }, 400);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: "Server is missing GEMINI_API_KEY configuration." }, 500);
  }

  // Trim/validate history from the client (don't trust it blindly)
  const safeHistory = Array.isArray(history)
    ? history
        .slice(-MAX_HISTORY_MESSAGES)
        .filter(m => m && (m.role === "user" || m.role === "model") && typeof m.text === "string")
        .map(m => ({
          role: m.role,
          parts: [{ text: m.text.slice(0, 4000) }],
        }))
    : [];

  const systemInstruction = {
    role: "user",
    parts: [{
      text:
        "You are a friendly, encouraging study assistant for school students (Grade 10-11, O/Level " +
        "syllabus, Sri Lanka). Help with explanations, past-paper style practice questions, and " +
        "study tips. Keep answers clear and age-appropriate. If a question is outside school " +
        "subjects or inappropriate, politely redirect the student back to their studies."
    }]
  };

  const contents = [
    systemInstruction,
    { role: "model", parts: [{ text: "Understood — I'm ready to help with your studies!" }] },
    ...safeHistory,
    { role: "user", parts: [{ text: message.slice(0, 4000) }] },
  ];

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800,
          },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
          ],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return json({ error: "The study bot is temporarily unavailable. Please try again shortly." }, 502);
    }

    const data = await geminiRes.json();
    const reply =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ||
      "Sorry, I couldn't come up with a response to that — could you rephrase your question?";

    return json({ reply });
  } catch (err) {
    console.error("Chat function error:", err);
    return json({ error: "Something went wrong reaching the study bot." }, 500);
  }
}

// Reject non-POST requests
export async function onRequestGet() {
  return json({ error: "Use POST." }, 405);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
