import { Clock3, RefreshCw, Save, Send, X } from "lucide-react";
import { useMemo, useState } from "react";
import { seedLeads } from "../data/seed";
import { insertVariable, renderTemplate, templateVariables } from "../lib/templateEngine";
import type { WorkflowDelay, WorkflowDelayUnit } from "../types";

type MessageTemplateEditorProps = {
  actionLabel: string;
  allowSendNow?: boolean;
  initialDelay?: WorkflowDelay;
  initialTemplate: string;
  maxLength: number;
  onClose: () => void;
  onSave: (template: string, delay?: WorkflowDelay) => void;
};

export function MessageTemplateEditor({
  actionLabel,
  allowSendNow = false,
  initialDelay,
  initialTemplate,
  maxLength,
  onClose,
  onSave
}: MessageTemplateEditorProps) {
  const [template, setTemplate] = useState(initialTemplate);
  const [deliveryMode, setDeliveryMode] = useState<"now" | "delay">(
    allowSendNow && initialDelay?.amount === 0 ? "now" : "delay"
  );
  const [delayAmount, setDelayAmount] = useState(
    initialDelay && initialDelay.amount > 0 ? initialDelay.amount : 1
  );
  const [delayUnit, setDelayUnit] = useState<WorkflowDelayUnit>(initialDelay?.unit ?? "days");
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewLead = seedLeads[previewIndex % seedLeads.length];
  const preview = useMemo(() => renderTemplate(template, previewLead), [previewLead, template]);
  const isOverLimit = template.length > maxLength;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="template-editor-title">
      <section className="template-modal compact-template-modal">
        <header className="modal-header">
          <div>
            <h2 id="template-editor-title">{actionLabel}</h2>
            <p>Profile variables are filled automatically for every lead.</p>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="template-layout">
          <section className="template-editor">
            <div className="editor-section-label">Insert profile variable</div>
            <div className="variable-chip-row">
              {templateVariables.map((variable) => (
                <button
                  className="variable-chip"
                  key={variable.key}
                  onClick={() => setTemplate((current) => insertVariable(current, variable.key))}
                >
                  {"{"}{variable.key}{"}"}
                </button>
              ))}
            </div>

            <label className="message-editor-field">
              <span>Message</span>
              <textarea
                className="template-textarea"
                value={template}
                onChange={(event) => setTemplate(event.target.value)}
              />
            </label>
            <div className={`template-count ${isOverLimit ? "over-limit" : ""}`}>
              {template.length}/{maxLength}
            </div>

            {initialDelay ? (
              <section className="message-delay-editor">
                <div className="editor-section-label">Delivery timing</div>
                {allowSendNow ? (
                  <div className="delivery-mode-control" aria-label="Message delivery timing">
                    <button
                      className={deliveryMode === "now" ? "active" : ""}
                      type="button"
                      onClick={() => setDeliveryMode("now")}
                    >
                      <Send size={16} />
                      Send now
                    </button>
                    <button
                      className={deliveryMode === "delay" ? "active" : ""}
                      type="button"
                      onClick={() => setDeliveryMode("delay")}
                    >
                      <Clock3 size={16} />
                      Add delay
                    </button>
                  </div>
                ) : null}
                {deliveryMode === "delay" ? (
                  <div className="delay-control-row">
                    <label className="input-with-icon delay-amount-field">
                      <Clock3 size={18} />
                      <input
                        aria-label="Delay amount"
                        min="1"
                        max="365"
                        type="number"
                        value={delayAmount}
                        onChange={(event) =>
                          setDelayAmount(Math.max(1, Math.min(365, Number(event.target.value) || 1)))
                        }
                      />
                    </label>
                    <select
                      aria-label="Delay unit"
                      className="delay-unit-select"
                      value={delayUnit}
                      onChange={(event) => setDelayUnit(event.target.value as WorkflowDelayUnit)}
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                ) : null}
                <p>
                  {deliveryMode === "now"
                    ? "No workflow delay. Global safety pacing still applies."
                    : "Wait after the previous workflow step before this message is eligible to send."}
                </p>
              </section>
            ) : null}
          </section>

          <aside className="template-preview">
            <div className="preview-heading">
              <h3>Preview</h3>
              <button
                className="icon-button"
                title="Show another profile"
                onClick={() => setPreviewIndex((current) => current + 1)}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            <div className="preview-card">
              <pre>{preview}</pre>
              <span>{preview.length}/{maxLength}</span>
            </div>

            <h3>Resolved variables</h3>
            <div className="preview-variable-list compact-variable-list">
              {templateVariables.slice(0, 8).map((variable) => (
                <div key={variable.key}>
                  <span>{"{"}{variable.key}{"}"}</span>
                  <strong>{variable.getValue(previewLead)}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <footer className="modal-actions">
          <button
            className="primary-button"
            disabled={!template.trim() || isOverLimit}
            onClick={() =>
              onSave(
                template.trim(),
                initialDelay
                  ? deliveryMode === "now"
                    ? { amount: 0, unit: "minutes" }
                    : { amount: delayAmount, unit: delayUnit }
                  : undefined
              )
            }
          >
            <Save size={18} />
            Save message
          </button>
          <button className="ghost-button" onClick={onClose}>Cancel</button>
        </footer>
      </section>
    </div>
  );
}
