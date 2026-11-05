import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AiAnswerCard } from "./AiAnswerCard";
import { AlertList, type AlertView } from "./AlertCard";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { InsightLine } from "./InsightLine";
import { SkeletonLoader } from "./SkeletonLoader";

const ALERTS: AlertView[] = [
  {
    id: "1",
    severity: "critical",
    title: "Visa expires in 7 days",
    project: "RAK-01",
    raised: "3 h ago",
    assignee: null,
  },
  {
    id: "2",
    severity: "info",
    title: "Shift breaks the ban",
    project: null,
    raised: "5 h ago",
    assignee: "Priya Demo",
  },
];

describe("AlertList", () => {
  it("shows severity, title, project, assignee and age on each card", () => {
    render(<AlertList label="Open alerts" alerts={ALERTS} onOpen={() => undefined} />);
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Visa expires in 7 days" })).toBeInTheDocument();
    expect(screen.getByText("RAK-01")).toBeInTheDocument();
    expect(screen.getByText("Company-wide")).toBeInTheDocument();
    expect(screen.getByText("HR team")).toBeInTheDocument();
    expect(screen.getByText("Priya Demo")).toBeInTheDocument();
  });

  it("collapses a resolved alert out of the list and keeps the others", async () => {
    function Harness() {
      const [alerts, setAlerts] = useState(ALERTS);
      return (
        <AlertList
          label="Open alerts"
          alerts={alerts}
          onOpen={() => undefined}
          onResolve={(a) => setAlerts((l) => l.filter((x) => x.id !== a.id))}
        />
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getAllByRole("button", { name: "Mark resolved" })[0]);
    await waitFor(() => expect(screen.queryByText("Visa expires in 7 days")).toBeNull());
    expect(screen.getByText("Shift breaks the ban")).toBeInTheDocument();
  });

  it("hides the resolve button for read-only viewers", () => {
    render(<AlertList label="Open alerts" alerts={ALERTS} onOpen={() => undefined} />);
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
  });

  it("opens an alert from its title", async () => {
    const onOpen = vi.fn();
    render(<AlertList label="Open alerts" alerts={ALERTS} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Visa expires in 7 days" }));
    expect(onOpen).toHaveBeenCalledWith(ALERTS[0]);
  });
});

describe("AiAnswerCard", () => {
  const steps = [{ title: "Checking visas", detail: "12 workers checked" }];

  it("while working: shows the steps so far and the one in progress, not the answer", () => {
    render(
      <AiAnswerCard
        agent="Workforce Agent"
        tier="mid"
        steps={steps}
        pending="Checking availability"
        running
        summary="8 cleared"
      />,
    );
    expect(screen.getByText("Workforce Agent is working…")).toBeInTheDocument();
    expect(screen.getByText("Checking visas")).toBeInTheDocument();
    expect(screen.getByText("Checking availability…")).toBeInTheDocument();
    expect(screen.queryByText("8 cleared")).toBeNull();
  });

  it("when done: shows the answer, exclusions and Why, with the trace collapsed but reopenable", async () => {
    render(
      <AiAnswerCard
        agent="Workforce Agent"
        tier="mid"
        steps={steps}
        running={false}
        summary="8 cleared, 2 excluded"
        excluded={[
          {
            name: "Faisal Ahmed",
            code: "EMP-0111",
            reason: "visa expires 12 Jan 2027",
            rule: "DOC_VALID_THROUGH",
          },
        ]}
        why="Ranked by availability."
        actions={<button type="button">Review</button>}
      />,
    );
    expect(screen.getByText("8 cleared, 2 excluded")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Excluded by the agent (1)");
    expect(screen.getByRole("note")).toHaveTextContent("visa expires 12 Jan 2027");
    expect(screen.getByText("Ranked by availability.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();

    expect(screen.queryByText("12 workers checked")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Trace · 1 step/ }));
    expect(await screen.findByText("12 workers checked")).toBeInTheDocument();
  });

  it("does not let the user collapse the trace while the agent is still working", () => {
    render(<AiAnswerCard agent="Workforce Agent" tier="mid" steps={steps} running />);
    expect(screen.getByRole("button", { name: /Trace/ })).toBeDisabled();
  });
});

describe("states and insight", () => {
  it("EmptyState says why and offers a next step", () => {
    render(
      <EmptyState
        icon={Inbox}
        title="No open alerts"
        action={<button type="button">Clear filters</button>}
      >
        Detectors last ran at 07:00.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "No open alerts" })).toBeInTheDocument();
    expect(screen.getByText("Detectors last ran at 07:00.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("ErrorState announces the problem and retries", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState title="Couldn’t load" onRetry={onRetry}>
        The API did not answer.
      </ErrorState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("The API did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("ErrorState without a retry handler shows no Retry button", () => {
    render(<ErrorState title="Couldn’t load">Nothing to retry.</ErrorState>);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("SkeletonLoader announces what is loading", () => {
    render(<SkeletonLoader label="Loading requests" />);
    expect(screen.getByRole("status", { name: "Loading requests" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("InsightLine states the sentence and links to where it is fixed", () => {
    render(
      <InsightLine href="/forecast" linkLabel="Open forecast">
        3 projects short of welders by 12 Feb
      </InsightLine>,
    );
    expect(screen.getByText("3 projects short of welders by 12 Feb")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Open forecast/ });
    expect(link).toHaveAttribute("href", "/forecast");
  });
});
