import { ArrowRight, MessageSquare, ShieldCheck, UserPlus, X } from "lucide-react";
import { useEffect } from "react";

type WorkflowActionPickerProps = {
  onAdd: (type: "connection_request" | "message") => void;
  onClose: () => void;
};

export function WorkflowActionPicker({ onAdd, onClose }: WorkflowActionPickerProps) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="action-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="action-picker-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="action-picker-drawer-header">
          <div>
            <span className="section-kicker">Workflow blocks</span>
            <h2 id="action-picker-title">Add action</h2>
          </div>
          <button type="button" className="icon-button" title="Close action drawer" aria-label="Close action drawer" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="action-picker-list" aria-label="Available workflow actions">
          <button type="button" onClick={() => onAdd("connection_request")}>
            <span className="action-picker-icon"><UserPlus size={22} /></span>
            <span>
              <strong>Send connection request</strong>
              <small>Invite a 2nd or 3rd-degree contact with an optional personalized note.</small>
              <em><ShieldCheck size={14} /> Wait for acceptance is added next</em>
            </span>
            <ArrowRight size={19} />
          </button>

          <button type="button" onClick={() => onAdd("message")}>
            <span className="action-picker-icon"><MessageSquare size={22} /></span>
            <span>
              <strong>Send message</strong>
              <small>Message a 1st-degree connection using profile variables.</small>
              <em><ShieldCheck size={14} /> Check for replies is added next</em>
            </span>
            <ArrowRight size={19} />
          </button>
        </div>
      </aside>
    </div>
  );
}
