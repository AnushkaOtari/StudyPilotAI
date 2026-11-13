import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ViewTabs from "../src/components/ViewTabs";

function setup(activeView = "chat") {
  const onChange = vi.fn();
  render(<ViewTabs activeView={activeView} onChange={onChange} />);
  return onChange;
}

describe("ViewTabs", () => {
  it("renders a Chat tab and a Mind Map tab in an accessible tablist", () => {
    setup();

    expect(screen.getByRole("tablist", { name: "Study view" })).toBeInTheDocument();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Chat", "Mind Map"]);
  });

  it("marks the active tab and gives only it a tab stop", () => {
    setup("mindmap");

    const chat = screen.getByRole("tab", { name: "Chat" });
    const mindMap = screen.getByRole("tab", { name: "Mind Map" });

    expect(mindMap).toHaveAttribute("aria-selected", "true");
    expect(chat).toHaveAttribute("aria-selected", "false");
    expect(mindMap).toHaveAttribute("tabindex", "0");
    expect(chat).toHaveAttribute("tabindex", "-1");
    expect(mindMap).toHaveClass("active");
  });

  it("points each tab at its panel", () => {
    setup();

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-controls", "view-panel-chat");
    expect(screen.getByRole("tab", { name: "Mind Map" })).toHaveAttribute("aria-controls", "view-panel-mindmap");
    expect(screen.getByRole("tab", { name: "Mind Map" })).toHaveAttribute("id", "view-tab-mindmap");
  });

  it("reports a click", () => {
    const onChange = setup("chat");

    fireEvent.click(screen.getByRole("tab", { name: "Mind Map" }));

    expect(onChange).toHaveBeenCalledWith("mindmap");
  });

  it("moves with the arrow keys, wrapping around, and focuses the new tab", () => {
    const onChange = setup("chat");
    const chat = screen.getByRole("tab", { name: "Chat" });

    fireEvent.keyDown(chat, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("mindmap");
    expect(screen.getByRole("tab", { name: "Mind Map" })).toHaveFocus();

    fireEvent.keyDown(chat, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("mindmap"); // wraps from the first to the last
  });

  it("jumps with Home and End", () => {
    const onChange = setup("chat");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("mindmap");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Mind Map" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("chat");
  });

  it("ignores other keys", () => {
    const onChange = setup();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "x" });

    expect(onChange).not.toHaveBeenCalled();
  });
});
