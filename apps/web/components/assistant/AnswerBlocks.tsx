import { Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { SeverityChip } from "@/components/ui/SeverityChip";
import type { ChatBlock, ChatCell, ChatTone } from "@/lib/api-types";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<ChatTone, string> = {
  neutral: "text-fg",
  good: "text-success-text",
  warn: "text-warning-text",
  bad: "text-danger-text",
};

function cell(value: ChatCell): string {
  return value === null || value === "" ? "—" : String(value);
}

/**
 * The data of an answer: counts, tables, alerts and bars, drawn from what the server sent. Nothing
 * is worked out here: every number was computed in Python, and this only lays it out.
 */
export function AnswerBlocks({ blocks }: { blocks: ChatBlock[] }) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      {blocks.map((block, i) => (
        <Block key={`${block.type}-${i}`} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "kpis":
      return (
        <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
          {block.items.map((k) => (
            <div key={k.label} className="rounded-control border border-border bg-sunken px-3 py-2">
              <dt className="text-xs text-muted">{k.label}</dt>
              <dd className={cn("m-0 text-lg font-semibold tabular-nums", TONE_TEXT[k.tone])}>
                {k.value}
              </dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <figure className="m-0">
          {block.title && (
            <figcaption className="mb-1 text-xs font-medium">{block.title}</figcaption>
          )}
          <div className="overflow-x-auto rounded-control border border-border">
            <table className="w-full min-w-max border-collapse text-xs">
              <thead>
                <tr className="bg-sunken text-left text-muted">
                  {block.columns.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      className={cn(
                        "px-2.5 py-1.5 font-medium whitespace-nowrap",
                        c.align === "right" && "text-right",
                      )}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-border">
                    {block.columns.map((c) => {
                      const value = row[c.key] ?? null;
                      const numeric = typeof value === "number";
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-2.5 py-1.5 whitespace-nowrap",
                            (c.align === "right" || numeric) && "tabular-nums",
                            c.align === "right" && "text-right",
                            value === null && "text-subtle",
                          )}
                        >
                          {cell(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </figure>
      );
    case "alerts":
      return (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {block.items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/todo?alert=${a.id}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-border px-3 py-2 text-xs transition-colors hover:bg-hover"
              >
                <SeverityChip severity={a.severity} />
                <span className="min-w-0 flex-1 basis-40 text-sm text-fg">{a.title}</span>
                <span className="text-muted">
                  {a.project ? `${a.project} · ` : ""}raised {a.raised}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case "bars":
      return (
        <figure className="m-0">
          {block.title && (
            <figcaption className="mb-1.5 text-xs font-medium">{block.title}</figcaption>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {block.items.map((b) => {
              const max = Math.max(b.of ?? b.value, 1);
              const width = Math.min(100, Math.round((b.value / max) * 100));
              return (
                <li
                  key={b.label}
                  className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs"
                >
                  <span className="truncate text-muted" title={b.detail ?? b.label}>
                    {b.label}
                  </span>
                  <span
                    role="img"
                    aria-label={`${b.label}: ${b.value}${b.of !== null ? ` of ${b.of}` : ""}`}
                    className="h-2 overflow-hidden rounded-full bg-(--track)"
                  >
                    <span
                      className="block h-full rounded-full bg-(--chart-strong)"
                      style={{ width: `${width}%` }}
                    />
                  </span>
                  <span className="tabular-nums">
                    {b.value}
                    {b.of !== null ? ` / ${b.of}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </figure>
      );
    case "note":
      return (
        <p
          role="note"
          className={cn(
            "m-0 flex items-start gap-2 rounded-control px-3 py-2 text-xs",
            block.tone === "warning"
              ? "bg-warning-soft text-warning-text"
              : "bg-info-soft text-info-text",
          )}
        >
          {block.tone === "warning" ? (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          {block.text}
        </p>
      );
  }
}
