"use client";
import { useEffect, useRef, useState } from "react";
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
  const [messages, setMessages] = useState<{ id?: number; question: string; answer: string; provider: string }[]>([]);
  const [historyStatus, setHistoryStatus] = useState("Loading recent questions…");
  const [hasMore, setHasMore] = useState(false), [olderBusy, setOlderBusy] = useState(false);
  const [pending, setPending] = useState("");
  const thread = useRef<HTMLDivElement>(null), loadingOlder = useRef(false);
  // Keep the newest exchange in view inside the thread; loading older questions keeps the reader's place.
  useEffect(() => {
    if (loadingOlder.current) { loadingOlder.current = false; return; }
    if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [messages.length, pending]);
  useEffect(() => {
    let active = true;
    void fetch("/api/assistant/history", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Recent questions are unavailable.");
      return response.json() as Promise<{ id?: number; question: string; answer: string; provider: string }[]>;
    }).then((rows) => { if (active) { setMessages(rows); setHasMore(rows.length === 20); setHistoryStatus(rows.length ? "" : "No questions yet. Ask about a plan to get started."); } })
      .catch(() => { if (active) setHistoryStatus("Recent questions are unavailable. You can still ask a new one."); });
    return () => { active = false; };
  }, []);
  async function loadOlder() {
    const firstId = messages.find((message) => message.id)?.id;
    if (!firstId || olderBusy) return;
    setOlderBusy(true); loadingOlder.current = true;
    try {
      const response = await fetch(`/api/assistant/history?before=${firstId}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const rows = await response.json() as { id: number; question: string; answer: string; provider: string }[];
      setMessages((previous) => [...rows, ...previous]); setHasMore(rows.length === 20);
    } catch { setHistoryStatus("Earlier questions could not be loaded. Please try again."); }
    finally { setOlderBusy(false); }
  }
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true); setQuestion(text); setPending(text);
    try {
      const history = messages.filter((message) => message.provider !== "unavailable").slice(-4)
        .map(({ question, answer }) => ({ question, answer: answer.slice(0, 3000) }));
      const response = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history }) });
      const payload = await response.json() as { answer?: string; error?: string; detail?: string };
      if (!response.ok || !payload.answer) throw new Error(payload.error ?? payload.detail ?? "Assistant unavailable");
      setMessages((previous) => [...previous, { question: text, answer: payload.answer ?? "", provider: response.headers.get("X-AI-Provider") || "assistant" }]);
      setHistoryStatus("");
      setQuestion("");
    } catch (error: unknown) {
      setMessages((previous) => [...previous, { question: text, answer: error instanceof Error ? error.message : "Unable to connect. The condition cards remain available.", provider: "unavailable" }]);
    } finally { setBusy(false); setPending(""); }
  }
  return <section className="panel assistant-panel" aria-labelledby="assistant-title">
    <div className="section-label">02 / ASK ABOUT YOUR PLAN</div>
    <h2 id="assistant-title">Ask before<br /><span>you head out.</span></h2>
    <p className="muted">Your copilot uses available conditions and the places and routines you save. You can ask follow-up questions here.</p>
    <div className="prompt-chips">
      {["Should I play basketball near UH at 5 PM?", "What should I check before driving to UH?"].map((text) =>
        <button key={text} disabled={busy} onClick={() => void ask(text)}>{text} <span aria-hidden>↗</span></button>)}
    </div>
    <div className="chat-thread" aria-live="polite" ref={thread}>
      {historyStatus && <p className="tiny" role="status">{historyStatus}</p>}
      {hasMore && <button className="secondary" disabled={olderBusy} aria-busy={olderBusy || undefined} onClick={() => void loadOlder()}>{olderBusy ? "Loading…" : "Load earlier questions"}</button>}
      {messages.map((message, index) => <article key={index} className="chat-message">
        <p className="question-label">{message.question}</p><span className="tag">{message.provider === "gemini" ? "Gemini · grounded in your briefing" : message.provider}</span>
        <Answer text={message.answer} />
      </article>)}
      {pending && <article className="chat-message" aria-busy="true"><p className="question-label">{pending}</p><span className="thinking" role="status"><i aria-hidden /><i aria-hidden /><i aria-hidden /> Checking your briefing…</span></article>}
    </div>
    <form className="ask-form" onSubmit={(event) => { event.preventDefault(); void ask(question); }}>
      <label className="sr-only" htmlFor="question">Ask your environmental assistant</label>
      <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} placeholder="What are you planning today?" />
      <button className="primary" disabled={busy || !question.trim()} aria-busy={busy || undefined}>{busy ? "Thinking…" : "Ask ↗"}</button>
    </form>
    <p className="tiny">Readings inform decisions. They don’t establish road safety or replace official guidance.</p>
  </section>;
}
