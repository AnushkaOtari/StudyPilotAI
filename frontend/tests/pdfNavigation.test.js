import { describe, it, expect } from "vitest";
import { canOpenCitation, parseCitationPage, resolveTargetPage } from "../src/utils/pdfNavigation";

describe("canOpenCitation", () => {
  it("needs a non-empty filename", () => {
    expect(canOpenCitation({ filename: "A.pdf", page: 1 })).toBe(true);
    expect(canOpenCitation({ filename: "A.pdf" })).toBe(true);
    for (const c of [null, undefined, {}, { filename: "" }, { filename: "  " }, { filename: 5 }]) {
      expect(canOpenCitation(c)).toBe(false);
    }
  });
});

describe("parseCitationPage", () => {
  it("accepts positive integers (number or numeric string)", () => {
    expect(parseCitationPage(9)).toBe(9);
    expect(parseCitationPage("9")).toBe(9);
    expect(parseCitationPage(1)).toBe(1);
  });
  it("rejects everything else", () => {
    for (const p of [null, undefined, "", " ", 0, -2, 1.5, "abc", NaN]) {
      expect(parseCitationPage(p)).toBeNull();
    }
  });
});

describe("resolveTargetPage (1-based, no conversion)", () => {
  it("keeps a valid page unchanged", () => {
    expect(resolveTargetPage(9, 20)).toEqual({ page: 9, notice: null });
    expect(resolveTargetPage(1, 1)).toEqual({ page: 1, notice: null });
    expect(resolveTargetPage(20, 20)).toEqual({ page: 20, notice: null });
  });
  it("clamps a page past the end and explains", () => {
    const r = resolveTargetPage(99, 3);
    expect(r.page).toBe(3);
    expect(r.notice).toMatch(/Page 99 is not in this document \(3 pages\)/);
  });
  it("uses singular wording for one page", () => {
    expect(resolveTargetPage(2, 1).notice).toMatch(/\(1 page\)/);
  });
  it("falls back to page 1 for a missing page", () => {
    const r = resolveTargetPage(null, 5);
    expect(r.page).toBe(1);
    expect(r.notice).toMatch(/No page number was recorded/);
  });
  it("falls back to page 1 for an invalid page (0, negative, text)", () => {
    for (const bad of [0, -1, "x"]) {
      const r = resolveTargetPage(bad, 5);
      expect(r.page).toBe(1);
      expect(r.notice).toMatch(/not a valid page number/);
    }
  });
});
