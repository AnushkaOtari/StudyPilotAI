import { describe, it, expect } from "vitest";
import {
  formatCitationLabel,
  getCitationChips,
  normalizeCitations,
} from "../src/utils/citations";

describe("formatCitationLabel", () => {
  it("formats filename and page", () => {
    expect(formatCitationLabel({ filename: "Understanding Companies.pdf", page: 9 }))
      .toBe("Understanding Companies.pdf — p. 9");
  });
  it("keeps the backend's 1-based page number unchanged", () => {
    expect(formatCitationLabel({ filename: "A.pdf", page: 1 })).toBe("A.pdf — p. 1");
  });
  it("handles missing page", () => {
    expect(formatCitationLabel({ filename: "A.pdf", page: null })).toBe("A.pdf");
    expect(formatCitationLabel({ filename: "A.pdf" })).toBe("A.pdf");
  });
  it("handles missing filename", () => {
    expect(formatCitationLabel({ filename: null, page: 4 })).toBe("p. 4");
  });
  it("returns null when nothing is displayable", () => {
    expect(formatCitationLabel({ filename: null, page: null, text: "x" })).toBeNull();
    expect(formatCitationLabel({ filename: "  ", page: "" })).toBeNull();
    expect(formatCitationLabel(null)).toBeNull();
    expect(formatCitationLabel("nope")).toBeNull();
  });
});

describe("normalizeCitations", () => {
  it("returns [] for anything that is not an array", () => {
    for (const v of [undefined, null, {}, "x", 5]) expect(normalizeCitations(v)).toEqual([]);
  });
  it("drops non-object entries and keeps the rest untouched", () => {
    const good = { id: "source_1", filename: "A.pdf", page: 2, text: "t" };
    expect(normalizeCitations([good, null, "x", 3, []])).toEqual([good]);
  });
});

describe("getCitationChips", () => {
  it("keeps backend order and collapses same filename+page", () => {
    const chips = getCitationChips([
      { id: "source_1", filename: "A.pdf", page: 9, text: "one" },
      { id: "source_2", filename: "B.pdf", page: 2, text: "two" },
      { id: "source_3", filename: "A.pdf", page: 9, text: "another chunk, same page" },
      { id: "source_4", filename: "A.pdf", page: 10, text: "three" },
    ]);
    expect(chips.map((c) => c.label)).toEqual(["A.pdf — p. 9", "B.pdf — p. 2", "A.pdf — p. 10"]);
  });
  it("same page number in different PDFs stays separate", () => {
    expect(getCitationChips([
      { filename: "A.pdf", page: 1 }, { filename: "B.pdf", page: 1 },
    ])).toHaveLength(2);
  });
  it("does not mutate its input", () => {
    const input = [{ id: "source_1", filename: "A.pdf", page: 1, text: "t" }];
    const copy = JSON.parse(JSON.stringify(input));
    getCitationChips(input);
    expect(input).toEqual(copy);
  });
  it("is empty for empty or missing citations", () => {
    expect(getCitationChips([])).toEqual([]);
    expect(getCitationChips(undefined)).toEqual([]);
  });
});
