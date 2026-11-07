import type { ChatAnswer, ChatRun, Conversation, ConversationView } from "@/lib/api-types";

export function answer(overrides: Partial<ChatAnswer> = {}): ChatAnswer {
  return {
    kind: "data",
    summary: "12 workers match (available, Steel fixer).",
    blocks: [
      {
        type: "table",
        title: null,
        columns: [
          { key: "code", label: "Code", align: "left" },
          { key: "name", label: "Name", align: "left" },
          { key: "level", label: "Level", align: "right" },
        ],
        rows: [
          { code: "EMP-0142", name: "Anil Kumar", level: 4 },
          { code: "EMP-0107", name: "Bikash Rai", level: null },
        ],
        total: 12,
        href: "/workers?trade=Steel+fixer",
      },
      { type: "note", tone: "info", text: "Showing the first 2 of 12. The screen has the rest." },
    ],
    why: "Understood by the AI as workers · available · Steel fixer. Searched the worker directory in your scope.",
    actions: [{ label: "Open these in Workers", href: "/workers?trade=Steel+fixer" }],
    sources: [{ tool: "search_workers", as_of: "5 Nov 2026" }],
    agent: "workforce",
    ai_worded: false,
    python_only: false,
    ...overrides,
  };
}

export function chatRun(overrides: Partial<ChatRun> = {}): ChatRun {
  return {
    id: "run-1",
    conversation_id: "conv-1",
    status: "succeeded",
    steps: [
      { title: "Understood the question", detail: "workers, by the AI" },
      { title: "Searched the worker directory", detail: "12 workers found, 2 shown" },
    ],
    answer: answer(),
    error: null,
    model: "groq:llama-test",
    started_at: "2026-11-05T09:00:00Z",
    finished_at: "2026-11-05T09:00:02Z",
    ...overrides,
  };
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv-1",
    title: "Any free steel fixers?",
    updated_at: "2026-11-05T09:00:00Z",
    ...overrides,
  };
}

export function conversationView(overrides: Partial<ConversationView> = {}): ConversationView {
  return {
    ...conversation(),
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Any free steel fixers?",
        answer: null,
        run_id: "run-1",
        created_at: "2026-11-05T09:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "12 workers match (available, Steel fixer).",
        answer: answer(),
        run_id: "run-1",
        created_at: "2026-11-05T09:00:02Z",
      },
    ],
    ...overrides,
  };
}
