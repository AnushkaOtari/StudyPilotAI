import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import ConceptDetails from "../src/components/ConceptDetails";

const baseNode = {
  id: "a",
  label: "Photosynthesis",
  description: "Process by which plants make food.",
  type: "main_topic",
  sources: [{ document: "Biology.pdf", pages: [4, 5], description: "Process by which plants make food." }],
};

const edge = (id, relationship, label = "") => ({ id, relationship, label });

function setup(props = {}) {
  const handlers = {
    onClose: vi.fn(),
    onSelectNeighbor: vi.fn(),
    onOpenSource: vi.fn(),
  };
  render(<ConceptDetails node={baseNode} neighbors={[]} {...handlers} {...props} />);
  return handlers;
}

describe("ConceptDetails", () => {
  it("shows the concept's name, type and description", () => {
    setup();

    expect(screen.getByRole("heading", { name: "Photosynthesis" })).toBeInTheDocument();
    expect(screen.getByText("Main topic")).toBeInTheDocument();
    expect(screen.getByText("Process by which plants make food.")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Details for Photosynthesis" })).toBeInTheDocument();
  });

  it("says so when the material gives no definition", () => {
    setup({ node: { ...baseNode, description: "" } });

    expect(screen.getByText(/does not define this concept/i)).toBeInTheDocument();
  });

  describe("sources", () => {
    it("lists the PDF with one button per page", () => {
      setup();

      expect(screen.getByText("Biology.pdf")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open Biology.pdf at page 4" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open Biology.pdf at page 5" })).toBeInTheDocument();
    });

    it("opens the PDF viewer at the clicked page", () => {
      const { onOpenSource } = setup();

      fireEvent.click(screen.getByRole("button", { name: "Open Biology.pdf at page 5" }));

      expect(onOpenSource).toHaveBeenCalledWith({ filename: "Biology.pdf", page: 5 });
    });

    it("keeps every PDF a merged concept came from, each with its own pages", () => {
      const onOpenSource = vi.fn();
      setup({
        node: {
          ...baseNode,
          sources: [
            { document: "Biology.pdf", pages: [4], description: "Process by which plants make food." },
            { document: "Botany.pdf", pages: [12, 13], description: "How leaves turn light into sugar." },
          ],
        },
        onOpenSource,
      });

      expect(screen.getByText("Biology.pdf")).toBeInTheDocument();
      expect(screen.getByText("Botany.pdf")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Open Botany.pdf at page 13" }));
      expect(onOpenSource).toHaveBeenCalledWith({ filename: "Botany.pdf", page: 13 });
    });

    it("shows a PDF's own wording only when it differs from the main description", () => {
      setup({
        node: {
          ...baseNode,
          sources: [
            { document: "Biology.pdf", pages: [4], description: "Process by which plants make food." },
            { document: "Botany.pdf", pages: [12], description: "How leaves turn light into sugar." },
          ],
        },
      });

      expect(screen.getAllByText("Process by which plants make food.")).toHaveLength(1);
      expect(screen.getByText("How leaves turn light into sugar.")).toBeInTheDocument();
    });

    it("offers 'Open PDF' (page 1) when no page was recorded", () => {
      const { onOpenSource } = setup({
        node: { ...baseNode, sources: [{ document: "Notes.pdf", pages: [], description: "" }] },
      });

      fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));

      expect(onOpenSource).toHaveBeenCalledWith({ filename: "Notes.pdf", page: 1 });
    });

    it("sorts pages, drops duplicates and caps very long lists", () => {
      const pages = [30, 2, 2, ...Array.from({ length: 30 }, (_, i) => i + 3)];
      setup({ node: { ...baseNode, sources: [{ document: "Big.pdf", pages, description: "" }] } });

      const buttons = screen.getAllByRole("button", { name: /^Open Big\.pdf at page/ });
      expect(buttons).toHaveLength(20);
      expect(buttons[0]).toHaveTextContent("2");
      expect(buttons[1]).toHaveTextContent("3");
      expect(screen.getByText("+11 more")).toBeInTheDocument(); // pages 2..32 = 31 distinct, 20 shown
    });

    it("handles a concept without sources", () => {
      setup({ node: { ...baseNode, sources: [] } });

      expect(screen.getByText("No source recorded.")).toBeInTheDocument();
    });
  });

  describe("connected concepts", () => {
    const neighbors = [
      { direction: "out", edge: edge("e1", "PART_OF", "is part of"), node: { id: "b", label: "Plant biology" } },
      { direction: "in", edge: edge("e2", "PART_OF", "is part of"), node: { id: "c", label: "Chlorophyll" } },
      { direction: "out", edge: edge("e3", "LEADS_TO"), node: { id: "d", label: "Glucose" } },
    ];

    it("reads as a sentence in the direction of the relationship", () => {
      setup({ neighbors });

      expect(screen.getByRole("button", { name: "is part of Plant biology" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Chlorophyll is part of this" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "leads to Glucose" })).toBeInTheDocument(); // default wording
    });

    it("shows how many there are", () => {
      setup({ neighbors });

      const heading = screen.getByRole("heading", { name: /Connected concepts/ });
      expect(within(heading).getByText("3")).toBeInTheDocument();
    });

    it("selects the other concept when clicked", () => {
      const { onSelectNeighbor } = setup({ neighbors });

      fireEvent.click(screen.getByRole("button", { name: "Chlorophyll is part of this" }));

      expect(onSelectNeighbor).toHaveBeenCalledWith("c");
    });

    it("says when there are none", () => {
      setup({ neighbors: [] });

      expect(screen.getByText(/No connections were found/)).toBeInTheDocument();
    });
  });

  describe("closing", () => {
    it("closes with the close button", () => {
      const { onClose } = setup();

      fireEvent.click(screen.getByRole("button", { name: "Close details" }));

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("closes with Escape", () => {
      const { onClose } = setup();

      fireEvent.keyDown(screen.getByRole("heading", { name: "Photosynthesis" }), { key: "Escape" });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("ignores other keys", () => {
      const { onClose } = setup();

      fireEvent.keyDown(screen.getByRole("heading", { name: "Photosynthesis" }), { key: "a" });

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
