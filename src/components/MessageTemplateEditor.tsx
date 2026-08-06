import { Bot, Copy, RefreshCw, Save, Shuffle, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { seedLeads } from "../data/seed";
import { insertVariable, renderTemplate, templateVariables } from "../lib/templateEngine";

type MessageTemplateEditorProps = {
  onClose: () => void;
};

const defaultTemplate = "Hi {firstName},\n\nI would like to join your professional network.\n\nCheers!";

export function MessageTemplateEditor({ onClose }: MessageTemplateEditorProps) {
  const [template, setTemplate] = useState(defaultTemplate);
  const [previewIndex, setPreviewIndex] = useState(0);
  const previewLead = seedLeads[previewIndex % seedLeads.length];
  const preview = useMemo(() => renderTemplate(template, previewLead), [previewLead, template]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="template-modal">
        <header className="modal-header">
          <div>
            <h2>Message Template Editor</h2>
            <p>Variables are filled from each profile automatically.</p>
          </div>
          <button className="icon-text-button" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="template-layout">
          <section className="template-editor">
            <div className="risk-line">
              <Sparkles size={18} />
              Almost safe - more diverse messages mean less risk.
            </div>

            <div className="variation-tabs">
              <button className="active">1</button>
              <button>2</button>
              <button>+ Add variation</button>
            </div>

            <div className="template-toolbar">
              <button><Bot size={17} /> AI Message</button>
              <button><Shuffle size={17} /> Spintax</button>
              <button>Variables</button>
              <button><Copy size={17} /></button>
            </div>

            <div className="variable-chip-row">
              {templateVariables.slice(0, 7).map((variable) => (
                <button
                  className="variable-chip"
                  key={variable.key}
                  onClick={() => setTemplate((current) => insertVariable(current, variable.key))}
                >
                  {"{"}{variable.key}{"}"}
                </button>
              ))}
            </div>

            <textarea
              className="template-textarea"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            />
            <div className="template-count">{template.length}/300</div>

            <div className="spintax-box">
              <h3>Spintax</h3>
              <p>Use short variations for greeting or phrasing, such as {"{Hello|Hi|Greetings}"}.</p>
              <div className="spintax-inputs">
                <input placeholder="Enter variation" />
                <input placeholder="Enter variation" />
              </div>
            </div>
          </section>

          <aside className="template-preview">
            <div className="preview-tabs">
              <button className="active">Preview</button>
              <button>Templates gallery</button>
            </div>
            <button
              className="ghost-button full-width"
              onClick={() => setPreviewIndex((current) => current + 1)}
            >
              <RefreshCw size={17} />
              Show a different preview
            </button>
            <div className="preview-card">
              <pre>{preview}</pre>
              <span>{preview.length}/300</span>
            </div>

            <h3>LinkedIn variables</h3>
            <div className="preview-variable-list">
              {templateVariables.map((variable) => (
                <div key={variable.key}>
                  <span>{"{"}{variable.key}{"}"}</span>
                  <strong>{variable.getValue(previewLead)}</strong>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <footer className="modal-actions">
          <button className="primary-button">
            <Save size={18} />
            Save & Close
          </button>
          <button className="ghost-button" onClick={onClose}>
            Close without changes
          </button>
        </footer>
      </section>
    </div>
  );
}
