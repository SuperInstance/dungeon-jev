// jev.js — the receipted TypeSafe (JEV) client with the lane's hard model
// budget. EVERY attempt (success or failure) is receipted to
// receipts/model-calls.jsonl with provider, model, purpose, tokens, latency,
// http. Keys are read from env at call time — never logged, never echoed.
// no bash -x anywhere; push outputs sed-redacted by the lane discipline.
import { appendFileSync, readFileSync } from "node:fs";

const BASE = "https://api.typesafe.ai";
export const BUDGET = { typesafe: 14, deepinfra: 4 };

export function countCalls(receiptsPath, provider) {
  try {
    return readFileSync(receiptsPath, "utf8").split("\n")
      .filter(l => l.trim()).map(l => JSON.parse(l))
      .filter(r => r.provider === provider && r.kind === "call").length;
  } catch { return 0; }
}

export function receipt(receiptsPath, row) {
  appendFileSync(receiptsPath, JSON.stringify({ ts: new Date().toISOString(), kind: "call", ...row }) + "\n");
}

export class JevError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

// POST /v1/systemone — {state, model, questions} (the quilt-jev-toolkit contract).
export async function jevAsk({ receiptsPath, state, questions, purpose, meta = {}, timeoutMs = 45000, model = "jev-latest" }) {
  const used = countCalls(receiptsPath, "typesafe");
  if (used >= BUDGET.typesafe) {
    throw new JevError("E_BUDGET_EXHAUSTED", `typesafe budget ${BUDGET.typesafe} exhausted (${used} receipted attempts)`);
  }
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new JevError("E_CHANNEL_CLOSED", "TYPESAFE_API_KEY missing — fail-closed");
  const t0 = Date.now();
  let res, payload;
  try {
    res = await fetch(BASE + "/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": "dungeon-jev/1.0" },
      body: JSON.stringify({ state, model, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = await res.json().catch(() => ({}));
  } catch (e) {
    receipt(receiptsPath, { provider: "typesafe", model, purpose, http: null, ok: false, err: `transport: ${e.message}`, tokensIn: null, tokensOut: null, latencyMs: Date.now() - t0, ...meta });
    throw new JevError("E_TRANSPORT", `typesafe transport failure: ${e.message}`);
  }
  const row = {
    provider: "typesafe", model: payload.model ?? model, purpose,
    http: res.status, ok: res.ok,
    // JEV usage shape: usage.input_tokens / usage.output_tokens (toolkit README §"usage")
    tokensIn: payload.usage?.input_tokens ?? null, tokensOut: payload.usage?.output_tokens ?? null,
    latencyMs: Date.now() - t0, ...meta,
  };
  if (!res.ok || typeof payload.answers !== "object" || !payload.answers) {
    receipt(receiptsPath, { ...row, ok: false, err: `http ${res.status}: ${JSON.stringify(payload).slice(0, 160)}` });
    throw new JevError("E_HTTP", `typesafe HTTP ${res.status}`);
  }
  receipt(receiptsPath, row);
  return payload; // { model, answers: {name: answer}, usage }
}

// deepinfra fallback (tuner only): OpenAI-style chat completions. Budget ≤4.
export async function deepinfraAsk({ receiptsPath, prompt, purpose, meta = {}, model = "Qwen/Qwen2.5-7B-Instruct", timeoutMs = 60000, maxTokens = 512 }) {
  const used = countCalls(receiptsPath, "deepinfra");
  if (used >= BUDGET.deepinfra) {
    throw new JevError("E_BUDGET_EXHAUSTED", `deepinfra budget ${BUDGET.deepinfra} exhausted`);
  }
  const key = process.env.DEEPINFRA_API_KEY;
  if (!key) throw new JevError("E_CHANNEL_CLOSED", "DEEPINFRA_API_KEY missing — fail-closed");
  const t0 = Date.now();
  let res, payload;
  try {
    res = await fetch("https://api.deepinfra.com/v1/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    payload = await res.json().catch(() => ({}));
  } catch (e) {
    receipt(receiptsPath, { provider: "deepinfra", model, purpose, http: null, ok: false, err: `transport: ${e.message}`, tokensIn: null, tokensOut: null, latencyMs: Date.now() - t0, ...meta });
    throw new JevError("E_TRANSPORT", `deepinfra transport failure: ${e.message}`);
  }
  const row = {
    provider: "deepinfra", model: payload.model ?? model, purpose,
    http: res.status, ok: res.ok,
    tokensIn: payload.usage?.prompt_tokens ?? null, tokensOut: payload.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - t0, ...meta,
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!res.ok || typeof content !== "string" || !content.length) {
    receipt(receiptsPath, { ...row, ok: false, err: `http ${res.status} / empty content` });
    throw new JevError("E_HTTP", `deepinfra HTTP ${res.status}`);
  }
  receipt(receiptsPath, row);
  return { content, modelServed: payload.model ?? model };
}
