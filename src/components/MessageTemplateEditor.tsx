import { RefreshCw, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { seedLeads } from "../data/seed";
import { insertVariable, renderTemplate, templateVariables } from "../lib/templateEngine";

type MessageTemplateEditorProps = {
  actionLabel: string;
  initialTemplate: string;
  maxLength: number;
  onClose: () => void;
  onSave: (template: string) => void;
};

export function MessageTemplateEditor({
  actionLabel,
  initialTemplate,
  maxLength,
  onClose,
  onSave
}: MessageTemplateEditorProps) {
  const [template, setTemplate] = useState(initialTemplate);
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
            onClick={() => onSave(template.trim())}
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
