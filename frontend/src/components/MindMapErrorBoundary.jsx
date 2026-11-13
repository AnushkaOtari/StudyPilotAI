import { Component } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Catches a failure to download or draw the lazily loaded graph viewer (for
 * example a dropped connection while fetching its code), so the rest of the
 * chat page keeps working.
 */
class MindMapErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Mind map viewer failed:", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="mindmap-state" role="alert">
        <div className="mindmap-state-icon tone-error">
          <AlertTriangle size={26} />
        </div>
        <h3>The mind map viewer could not be loaded</h3>
        <p>
          This is usually a dropped connection. Reload the page to try again.
          Your chat and uploaded PDFs are not affected.
        </p>
        <button
          type="button"
          className="mindmap-btn primary"
          onClick={() => window.location.reload()}
        >
          Reload page
        </button>
      </div>
    );
  }
}

export default MindMapErrorBoundary;
