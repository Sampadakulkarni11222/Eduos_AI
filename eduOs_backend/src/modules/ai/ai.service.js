/**
 * STAND-IN implementation. core-api's ai module calls an LLM (with tool-use
 * for attendance/marks/fees lookups). No LLM API key is configured in this
 * project, so this is a rule-based intent matcher that demonstrates the
 * same request/response contract. Swap respond() for a real LLM client call
 * (e.g. Anthropic/OpenAI SDK) when a key is available — callers don't change.
 */
const INTENTS = [
  { match: /attendance/i, reply: "I can't check live attendance yet — try GET /api/v1/attendance/summary." },
  { match: /fee|invoice|payment/i, reply: "I can't process payments here — try GET /api/v1/fees/summary." },
  { match: /mark|exam|result/i, reply: "I can't read live marks yet — try GET /api/v1/exams/performance." },
  { match: /timetable|schedule/i, reply: "I can't read your timetable yet — try GET /api/v1/timetable." },
];

export function chat({ message }) {
  const intent = INTENTS.find((i) => i.match.test(message));
  return {
    reply: intent?.reply ?? "I'm a placeholder AI copilot — no LLM is wired up yet. Ask about attendance, fees, marks, or timetable.",
    isStandIn: true,
  };
}
