import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUERY,
  fromSearch,
  toApiParams,
  toSearch,
  type WorkersQuery,
} from "./workers-query";

const query = (changes: Partial<WorkersQuery>): WorkersQuery => ({ ...DEFAULT_QUERY, ...changes });

describe("toApiParams", () => {
  it("sends only the filters that are set, plus sorting and the page window", () => {
    expect(toApiParams(DEFAULT_QUERY).toString()).toBe("sort=name&dir=asc&limit=25&offset=0");
    const params = toApiParams(
      query({ q: "  sanjeev ", trade: "Mason", status: "deployed", documents: "30", page: 3 }),
    );
    expect(params.get("q")).toBe("sanjeev");
    expect(params.get("trade")).toBe("Mason");
    expect(params.get("status")).toBe("deployed");
    expect(params.get("expiring_within")).toBe("30");
    expect(params.get("offset")).toBe("50");
  });

  it("asks for expired documents and leaves the page window out of an export", () => {
    const params = toApiParams(query({ documents: "expired" }), false);
    expect(params.get("expired")).toBe("true");
    expect(params.has("limit")).toBe(false);
  });
});

describe("the address bar", () => {
  it("round-trips a view and the worker whose sheet is open", () => {
    const view = query({ q: "khan", project: "RAK-03", sort: "docs", dir: "desc", page: 2 });
    expect(fromSearch(toSearch(view, "EMP-0088"))).toEqual({ query: view, open: "EMP-0088" });
  });

  it("is empty for the default view", () => {
    expect(toSearch(DEFAULT_QUERY)).toBe("");
  });

  it("ignores anything it does not recognise", () => {
    const { query: parsed, open } = fromSearch(
      "?status=hacked&sort=drop-table&dir=sideways&page=-4&documents=all&worker=<script>",
    );
    expect(parsed).toEqual(DEFAULT_QUERY);
    expect(open).toBeNull();
  });
});
