import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MindMapCanvas from "../src/components/MindMapCanvas";

// Real React Flow, with the two browser APIs jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.DOMMatrixReadOnly = class {
    constructor() {
      this.m22 = 1;
    }
  };
});

const graph = {
  nodes: [
    { id: "a", label: "Cell", description: "", type: "main_topic", sources: [] },
    { id: "b", label: "Mitochondria", description: "", type: "concept", sources: [] },
    { id: "c", label: "Nucleus", description: "", type: "concept", sources: [] },
  ],
  edges: [
    { id: "e1", source: "b", target: "a", relationship: "PART_OF", label: "is part of", documents: [] },
    { id: "e2", source: "c", target: "a", relationship: "PART_OF", label: "is part of", documents: [] },
  ],
};

function setup(props = {}) {
  const onSelect = vi.fn();
  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <MindMapCanvas graph={graph} selectedId={null} focusTick={0} onSelect={onSelect} {...props} />
    </div>
  );
  return { onSelect, ...view };
}

describe("MindMapCanvas (real React Flow)", () => {
  it("renders a node for every concept", () => {
    setup();

    expect(screen.getByText("Cell")).toBeInTheDocument();
    expect(screen.getByText("Mitochondria")).toBeInTheDocument();
    expect(screen.getByText("Nucleus")).toBeInTheDocument();
  });

  it("exposes zoom controls", () => {
    setup();

    expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument();
  });

  it("selects a concept when its node is clicked", () => {
    const { onSelect } = setup();

    fireEvent.click(screen.getByText("Mitochondria"));

    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("clears the selection when the background is clicked", () => {
    const { onSelect, container } = setup();

    fireEvent.click(container.querySelector(".react-flow__pane"));

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks the selected node", () => {
    setup({ selectedId: "a" });

    expect(screen.getByText("Cell").closest(".react-flow__node")).toHaveClass("selected");
  });
});
