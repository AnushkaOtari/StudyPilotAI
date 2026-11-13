import { useRef } from "react";
import { MessageSquare, Network } from "lucide-react";
import {
  VIEW_CHAT,
  VIEW_MINDMAP,
  viewPanelId,
  viewTabId,
} from "../utils/knowledgeGraph";
import "./ViewTabs.css";

const TABS = [
  { id: VIEW_CHAT, label: "Chat", Icon: MessageSquare },
  { id: VIEW_MINDMAP, label: "Mind Map", Icon: Network },
];

/**
 * "Chat | Mind Map" tabs under the header. Arrow keys, Home and End move
 * between tabs, as expected of an ARIA tablist.
 */
function ViewTabs({ activeView, onChange }) {
  const refs = useRef({});

  const move = (index) => {
    const next = TABS[(index + TABS.length) % TABS.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };

  const onKeyDown = (event, index) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(index - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(TABS.length - 1);
        break;
      default:
    }
  };

  return (
    <div className="view-tabs" role="tablist" aria-label="Study view">
      {TABS.map(({ id, label, Icon }, index) => {
        const selected = id === activeView;

        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[id] = el;
            }}
            id={viewTabId(id)}
            type="button"
            role="tab"
            className={`view-tab${selected ? " active" : ""}`}
            aria-selected={selected}
            aria-controls={viewPanelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ViewTabs;
