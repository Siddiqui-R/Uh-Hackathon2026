"use client";
import { useState } from "react";
function Answer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(https:\/\/[^)\s]+\)|\*\*[^*]+\*\*|https:\/\/[^\s)]+)/g);
  return <p className="answer-text">{parts.map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\((https:\/\/[^)]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (part.startsWith("https://")) return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2,-2)}</strong>;
    return part;
  })}</p>;
}
export default function AskBox() {
  const [question, setQuestion] = useState(""), [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<{ question: string; answer: string; provider: string }[]>([]);
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setQuestion(text);
    try {
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const payload = await response.json() as { answer?: string; error?: string; detail?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? payload.detail ?? "Assistant unavailable");
      setMessages((previous) => [...previous.slice(-4), { question: text, answer: payload.answer ?? "", provider: response.headers.get("X-AI-Provider") || "assistant" }]);
      setQuestion("");
    } catch (error: unknown) {
      setMessages((previous) => [...previous.slice(-4), { question: text, answer: error instanceof Error ? error.message : "Unable to connect. The condition cards remain available.", provider: "unavailable" }]);
    } finally { setBusy(false); }
  }
  return <section className="panel assistant-panel" aria-labelledby="assistant-title">
    <div className="section-label">02 / ASK ABOUT YOUR PLAN</div>
    <h2 id="assistant-title">Ask before<br /><span>you head out.</span></h2>
    <p className="muted">Your copilot uses available conditions and the places and routines you save.</p>
    <div className="prompt-chips">
      {["Should I play basketball near UH at 5 PM?", "What should I check before driving to UH?"].map((text) =>
        <button key={text} disabled={busy} onClick={() => void ask(text)}>{text} <span aria-hidden>↗</span></button>)}
    </div>
    <div className="chat-thread" aria-live="polite">
      {messages.map((message, index) => <article key={index} className="chat-message">
        <p className="question-label">{message.question}</p><span className="tag">{message.provider === "gemini" ? "Gemini · grounded in your briefing" : message.provider}</span>
        <Answer text={message.answer} />
      </article>)}
    </div>
    <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label className="sr-only" htmlFor="question">Ask your environmental assistant</label>
      <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} placeholder="What are you planning today?" />
      <button className="primary" disabled={busy || !question.trim()}>{busy ? "Thinking…" : "Ask ↗"}</button>
    </form>
    <p className="tiny">Readings inform decisions. They don’t establish road safety or replace official guidance.</p>
  </section>;
}
