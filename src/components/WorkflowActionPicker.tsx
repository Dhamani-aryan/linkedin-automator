import { ArrowRight, MessageSquare, ShieldCheck, UserPlus, X } from "lucide-react";

type WorkflowActionPickerProps = {
  onAdd: (type: "connection_request" | "message") => void;
  onClose: () => void;
};

export function WorkflowActionPicker({ onAdd, onClose }: WorkflowActionPickerProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="action-picker-title">
      <section className="action-picker-modal">
        <header className="modal-header">
          <div>
            <h2 id="action-picker-title">Add workflow action</h2>
            <p>Start with the two core outreach actions. Safety checks are added automatically.</p>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="action-picker-list">
          <button onClick={() => onAdd("connection_request")}>
            <span className="action-picker-icon"><UserPlus size={22} /></span>
            <span>
              <strong>Send connection request</strong>
              <small>Invite a 2nd or 3rd-degree contact with an optional personalized note.</small>
              <em><ShieldCheck size={14} /> Wait for acceptance is added next</em>
            </span>
            <ArrowRight size={19} />
          </button>

          <button onClick={() => onAdd("message")}>
            <span className="action-picker-icon"><MessageSquare size={22} /></span>
            <span>
              <strong>Send message</strong>
              <small>Message a 1st-degree connection using profile variables.</small>
              <em><ShieldCheck size={14} /> Check for replies is added next</em>
            </span>
            <ArrowRight size={19} />
          </button>
        </div>
      </section>
    </div>
  );
}
