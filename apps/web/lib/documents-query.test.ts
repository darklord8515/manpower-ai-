import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENTS_QUERY,
  fromDocumentsSearch,
  toDocumentsSearch,
  type DocumentsQuery,
} from "./documents-query";

const view = (changes: Partial<DocumentsQuery>): DocumentsQuery => ({
  ...DEFAULT_DOCUMENTS_QUERY,
  ...changes,
});

describe("the Documents address", () => {
  it("is empty for the default view, and shows only what differs", () => {
    expect(toDocumentsSearch(DEFAULT_DOCUMENTS_QUERY)).toBe("");
    expect(toDocumentsSearch(view({ window: "expired", type: "residency_visa" }))).toBe(
      "?window=expired&type=residency_visa",
    );
  });

  it("round-trips a view and the worker whose sheet is open", () => {
    const v = view({ window: "d60", q: "khan", type: "medical_fitness", project: "RAK-03" });
    expect(fromDocumentsSearch(toDocumentsSearch(v, "EMP-0088"))).toEqual({
      query: v,
      open: "EMP-0088",
    });
  });

  it("ignores anything it does not recognise", () => {
    const parsed = fromDocumentsSearch(
      "?window=forever&type=DROP TABLE&project=<script>&worker=../../etc",
    );
    expect(parsed.query).toEqual(DEFAULT_DOCUMENTS_QUERY);
    expect(parsed.open).toBeNull();
  });
});
