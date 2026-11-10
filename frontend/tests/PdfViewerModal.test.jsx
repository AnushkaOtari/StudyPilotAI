import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pdf = vi.hoisted(() => ({ getPage: vi.fn(), render: vi.fn(), destroy: vi.fn(), numPages: 12 }));
const service = vi.hoisted(() => ({ fetchChatPdf: vi.fn() }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: pdf.numPages,
      destroy: pdf.destroy,
      getPage: async (n) => {
        pdf.getPage(n);
        return {
          getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
          render: (args) => {
            pdf.render(n, args);
            return { promise: Promise.resolve(), cancel: vi.fn() };
          },
        };
      },
    }),
    destroy: vi.fn(),
  })),
}));
vi.mock("../src/services/pdfservice", () => service);

import PdfViewerModal from "../src/components/PdfViewerModal";

const open = (props = {}) =>
  render(<PdfViewerModal chatId="chat-1" filename="Companies.pdf" page={9} onClose={vi.fn()} {...props} />);

beforeEach(() => {
  pdf.getPage.mockClear(); pdf.render.mockClear(); pdf.destroy.mockClear(); pdf.numPages = 12;
  service.fetchChatPdf.mockReset().mockResolvedValue(new ArrayBuffer(8));
});

describe("PdfViewerModal", () => {
  it("fetches the cited document from the right chat and opens the cited 1-based page", async () => {
    open();
    expect(await screen.findByText("Page 9 of 12")).toBeInTheDocument();
    expect(service.fetchChatPdf).toHaveBeenCalledWith("chat-1", "Companies.pdf");
    await waitFor(() => expect(pdf.render).toHaveBeenCalled());
    expect(pdf.getPage).toHaveBeenCalledWith(9);          // no off-by-one conversion
    expect(screen.queryByRole("status", { name: "" })?.textContent ?? "").not.toMatch(/Showing page/);
  });

  it("shows the file name and is an accessible dialog", async () => {
    open({ filename: "Tax Basics.pdf" });
    const dialog = await screen.findByRole("dialog", { name: "PDF viewer: Tax Basics.pdf" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Tax Basics.pdf")).toBeInTheDocument();
  });

  it("a different document and page opens that document and page", async () => {
    open({ chatId: "chat-2", filename: "Tax.pdf", page: 2 });
    expect(await screen.findByText("Page 2 of 12")).toBeInTheDocument();
    expect(service.fetchChatPdf).toHaveBeenCalledWith("chat-2", "Tax.pdf");
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(2));
  });

  it("clamps a page beyond the document and tells the user", async () => {
    pdf.numPages = 3;
    open({ page: 99 });
    expect(await screen.findByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText(/Page 99 is not in this document \(3 pages\)/)).toBeInTheDocument();
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(3));
  });

  it("missing or invalid page opens page 1 with a notice", async () => {
    open({ page: null });
    expect(await screen.findByText("Page 1 of 12")).toBeInTheDocument();
    expect(screen.getByText(/No page number was recorded/)).toBeInTheDocument();
  });

  it("next / previous move by one page and disable at the ends", async () => {
    open({ page: 1 });
    await screen.findByText("Page 1 of 12");
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(await screen.findByText("Page 2 of 12")).toBeInTheDocument();
    await waitFor(() => expect(pdf.getPage).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByLabelText("Previous page"));
    expect(await screen.findByText("Page 1 of 12")).toBeInTheDocument();
  });

  it("shows a clear message when the document no longer exists", async () => {
    service.fetchChatPdf.mockRejectedValue(Object.assign(new Error("x"), { code: "not_found" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer available in this chat/);
    expect(screen.queryByLabelText("Next page")).toBeNull();
  });

  it("shows a generic message for other failures", async () => {
    service.fetchChatPdf.mockRejectedValue(Object.assign(new Error("x"), { code: "failed" }));
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Could not load this PDF/);
  });

  it("closes with the button, Escape, and a click on the backdrop", async () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });
    await screen.findByText("Page 9 of 12");
    fireEvent.click(screen.getByLabelText("Close PDF viewer"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.mouseDown(container.querySelector(".pdf-viewer-overlay"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("clicking inside the dialog does not close it", async () => {
    const onClose = vi.fn();
    open({ onClose });
    await screen.findByText("Page 9 of 12");
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases the PDF document when closed", async () => {
    const { unmount } = open();
    await screen.findByText("Page 9 of 12");
    unmount();
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
