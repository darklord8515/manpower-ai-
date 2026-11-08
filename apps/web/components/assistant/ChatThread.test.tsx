import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { answer, chatRun } from "./test-data";

const api = {
  chatSuggestions: vi.fn(),
  sendChat: vi.fn(),
  chatAnswer: vi.fn(),
  conversation: vi.fn(),
};

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...original,
    api: {
      ...original.api,
      chatSuggestions: (...a: unknown[]) => api.chatSuggestions(...a),
      sendChat: (...a: unknown[]) => api.sendChat(...a),
      chatAnswer: (...a: unknown[]) => api.chatAnswer(...a),
      conversation: (...a: unknown[]) => api.conversation(...a),
    },
  };
});

import { useChat } from "@/lib/use-chat";
import { ChatThread } from "./ChatThread";

function Harness({ onNavigate }: { onNavigate?: () => void }) {
  const chat = useChat();
  return <ChatThread chat={chat} onNavigate={onNavigate} />;
}

function setup() {
  render(<Harness />);
  return userEvent.setup();
}

const SUGGESTIONS = {
  items: ["Who is available right now?", "What needs my attention today?"],
  ai_enabled: true,
};

// A block body: an arrow that returns the mock would be run by Vitest as a cleanup function.
beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.chatSuggestions.mockResolvedValue(SUGGESTIONS);
  api.sendChat.mockResolvedValue({ run_id: "run-1", conversation_id: "conv-1" });
  api.chatAnswer.mockResolvedValue(chatRun());
});

describe("ChatThread", () => {
  it("starts empty with suggestions that ask the question when pressed", async () => {
    const user = setup();
    expect(screen.getByRole("heading", { name: "Ask Virtual HR" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Who is available right now?" }));
    expect(api.sendChat).toHaveBeenCalledWith("Who is available right now?", null);
    expect(
      await screen.findByText("12 workers match (available, Steel fixer)."),
    ).toBeInTheDocument();
  });

  it("says plainly when no model is set up", async () => {
    api.chatSuggestions.mockResolvedValue({ ...SUGGESTIONS, ai_enabled: false });
    setup();
    expect(await screen.findByText(/No AI model is set up on this server/)).toBeInTheDocument();
  });

  it("sends with Enter, keeps Shift+Enter for a new line, and clears the box", async () => {
    const user = setup();
    const box = screen.getByRole("textbox", { name: "Your question" });
    await user.type(box, "Any free{Shift>}{Enter}{/Shift}steel fixers?");
    expect(api.sendChat).not.toHaveBeenCalled();
    expect(box).toHaveValue("Any free\nsteel fixers?");
    await user.keyboard("{Enter}");
    expect(api.sendChat).toHaveBeenCalledWith("Any free\nsteel fixers?", null);
    expect(box).toHaveValue("");
    expect(screen.getAllByText(/Any free/).length).toBeGreaterThan(0);
  });

  it("will not send an empty question, and keeps Send off while an answer is coming", async () => {
    api.chatAnswer.mockResolvedValue(chatRun({ status: "running", answer: null, steps: [] }));
    const user = setup();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "hello");
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "again");
    await user.keyboard("{Enter}");
    expect(api.sendChat).toHaveBeenCalledTimes(1);
  });

  it("shows the steps as they come in, then the answer with its data and links", async () => {
    api.chatAnswer
      .mockResolvedValueOnce(
        chatRun({ status: "running", answer: null, steps: chatRun().steps.slice(0, 1) }),
      )
      .mockResolvedValue(chatRun());
    const onNavigate = vi.fn();
    render(<Harness onNavigate={onNavigate} />);
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Your question" }),
      "any free steel fixers?",
    );
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Understood the question")).toBeInTheDocument();
    expect(screen.getByText("Virtual HR is working…")).toBeInTheDocument();
    const card = await screen.findByRole(
      "article",
      { name: "Answer from the Workforce agent" },
      { timeout: 3000 },
    );
    expect(within(card).getByRole("table")).toBeInTheDocument();
    expect(within(card).getByText("Anil Kumar")).toBeInTheDocument();
    expect(within(card).getByText(/Understood by the AI as workers/)).toBeInTheDocument();
    expect(within(card).getByText(/Read search workers on 5 Nov 2026/)).toBeInTheDocument();
    expect(within(card).getByText("Python wording")).toBeInTheDocument();
    expect(within(card).getByText("Trace · 2 steps")).toBeInTheDocument();
    const link = within(card).getByRole("link", { name: "Open these in Workers" });
    expect(link).toHaveAttribute("href", "/workers?trade=Steel+fixer");
    await user.click(link);
    expect(onNavigate).toHaveBeenCalled();
    expect(api.sendChat).toHaveBeenCalledWith("any free steel fixers?", null);
  });

  it("continues the same conversation with its id", async () => {
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "first");
    await user.keyboard("{Enter}");
    await screen.findByRole("article");
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "second");
    await user.keyboard("{Enter}");
    expect(api.sendChat).toHaveBeenLastCalledWith("second", "conv-1");
  });

  it("shows a refusal as a note, with no data", async () => {
    api.chatAnswer.mockResolvedValue(
      chatRun({
        status: "refused",
        answer: answer({
          kind: "refusal",
          summary: "HAMRA AI holds no salary or pay data, so I cannot answer that.",
          blocks: [],
          actions: [],
          sources: [],
          agent: null,
          why: "Salary is not stored in this system at all.",
        }),
      }),
    );
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "salary of EMP-0142");
    await user.keyboard("{Enter}");
    const card = await screen.findByRole("article", { name: "Answer from the Virtual HR" });
    expect(within(card).getByRole("note")).toHaveTextContent("holds no salary or pay data");
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows when no model answered, and a model's wording when it did", async () => {
    api.chatAnswer.mockResolvedValue(
      chatRun({ answer: answer({ python_only: true, ai_worded: false }) }),
    );
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "alerts");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Python only")).toBeInTheDocument();
  });

  it("explains a refused send, and a failed answer can be asked again", async () => {
    api.sendChat.mockRejectedValueOnce(
      new ApiError(429, "That is a lot of questions in a short time."),
    );
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "again please");
    await user.keyboard("{Enter}");
    expect(
      await screen.findByText("That is a lot of questions in a short time."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(api.sendChat).toHaveBeenCalledTimes(2);
    // the question appears once, not twice
    expect(screen.getAllByText("again please")).toHaveLength(1);
  });

  it("offers no retry for 'wait for the answer'", async () => {
    api.sendChat.mockRejectedValueOnce(
      new ApiError(409, "Wait for the answer before asking again."),
    );
    const user = setup();
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "too fast");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Wait for the answer before asking again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("gives up with a message when the server stops answering the polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.chatAnswer.mockRejectedValue(new ApiError(0, "offline"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.type(screen.getByRole("textbox", { name: "Your question" }), "anyone there");
    await user.keyboard("{Enter}");
    await vi.advanceTimersByTimeAsync(4000);
    expect(await screen.findByText("Lost touch with the server. Try again.")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
