import {
  ArrowLeft,
  Check,
  ExternalLink,
  FileUp,
  Link,
  ListPlus,
  LoaderCircle,
  Navigation,
  Upload,
  X
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { CollectedProfileLink } from "../lib/chromeApi";
import {
  normalizeLinkedInProfileUrl,
  normalizeSalesNavigatorSourceUrl,
  parseLinkedInProfileUrls
} from "../lib/linkedinUrls";
import type { LeadSourceKind } from "../types";

export type LeadImportPayload = {
  name: string;
  kind: LeadSourceKind;
  sourceUrl?: string;
  profiles: CollectedProfileLink[];
};

type LeadSourceWizardProps = {
  onAddProfiles: (payload: LeadImportPayload) => { added: number; duplicates: number };
  onClose: () => void;
  onCollectSalesNavigator: (sourceUrl: string) => Promise<CollectedProfileLink[]>;
};

type SourceMode = "linkedin_urls" | "sales_navigator";

export function LeadSourceWizard({ onAddProfiles, onClose, onCollectSalesNavigator }: LeadSourceWizardProps) {
  const [mode, setMode] = useState<SourceMode>("linkedin_urls");
  const [individualUrl, setIndividualUrl] = useState("");
  const [bulkUrls, setBulkUrls] = useState("");
  const [listName, setListName] = useState("Custom LinkedIn list");
  const [salesSourceUrl, setSalesSourceUrl] = useState("");
  const [salesLeadUrls, setSalesLeadUrls] = useState("");
  const [isCollecting, setIsCollecting] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const customProfiles = useMemo(
    () => parseLinkedInProfileUrls(`${individualUrl}\n${bulkUrls}`),
    [bulkUrls, individualUrl]
  );
  const salesProfiles = useMemo(() => parseLinkedInProfileUrls(salesLeadUrls), [salesLeadUrls]);
  const normalizedSalesSource = useMemo(
    () => normalizeSalesNavigatorSourceUrl(salesSourceUrl),
    [salesSourceUrl]
  );

  function importProfiles(kind: LeadSourceKind, profiles = customProfiles, sourceUrl?: string) {
    if (profiles.length === 0) {
      setFeedback({ tone: "error", message: "Add at least one valid LinkedIn profile URL." });
      return;
    }

    const result = onAddProfiles({
      name: listName.trim() || (kind === "sales_navigator" ? "Sales Navigator list" : "LinkedIn URL list"),
      kind,
      sourceUrl,
      profiles: profiles.map((profile) => ({ url: profile.url, name: "" }))
    });
    setFeedback({
      tone: "success",
      message: `${result.added} profile${result.added === 1 ? "" : "s"} added${
        result.duplicates > 0 ? `, ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""
      }.`
    });
    if (kind === "sales_navigator") setSalesLeadUrls("");
    else {
      setIndividualUrl("");
      setBulkUrls("");
    }
  }

  async function collectSalesNavigator() {
    if (!normalizedSalesSource) {
      setFeedback({
        tone: "error",
        message: "Enter a Sales Navigator people search, people list, or lead URL."
      });
      return;
    }

    setIsCollecting(true);
    setFeedback(null);
    try {
      const collected = await onCollectSalesNavigator(normalizedSalesSource);
      if (collected.length === 0) {
        setFeedback({
          tone: "error",
          message: "No visible lead links were found. Let the page load, scroll the list, then collect again."
        });
        return;
      }
      const result = onAddProfiles({
        name: listName.trim() || "Sales Navigator list",
        kind: "sales_navigator",
        sourceUrl: normalizedSalesSource,
        profiles: collected
      });
      setFeedback({
        tone: "success",
        message: `${result.added} visible profile${result.added === 1 ? "" : "s"} collected from Sales Navigator${
          result.duplicates > 0 ? `; ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped` : ""
        }.`
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Could not collect profiles from Sales Navigator."
      });
    } finally {
      setIsCollecting(false);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setBulkUrls((current) => `${current}${current.trim() ? "\n" : ""}${content}`);
    if (listName === "Custom LinkedIn list") {
      setListName(file.name.replace(/\.[^.]+$/, ""));
    }
    setFeedback(null);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="lead-source-title">
      <section className="wide-modal lead-source-modal">
        <header className="modal-header">
          <div className="modal-title-row">
            <button className="icon-button" title="Close" onClick={onClose}>
              <ArrowLeft size={18} />
            </button>
            <div>
              <h2 id="lead-source-title">Add profiles to campaign</h2>
              <p>Import LinkedIn URLs directly or collect visible leads from Sales Navigator.</p>
            </div>
          </div>
          <button className="icon-button" title="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div className="source-tabs compact-source-tabs">
          <button className={mode === "linkedin_urls" ? "active" : ""} onClick={() => setMode("linkedin_urls")}>
            <Link size={17} />
            LinkedIn URLs
          </button>
          <button className={mode === "sales_navigator" ? "active" : ""} onClick={() => setMode("sales_navigator")}>
            <Navigation size={17} />
            Sales Navigator
          </button>
        </div>

        <label className="source-field source-name-field">
          <span>List name</span>
          <input value={listName} onChange={(event) => setListName(event.target.value)} />
        </label>

        {mode === "linkedin_urls" ? (
          <div className="lead-import-layout">
            <section className="lead-import-form">
              <div className="section-heading">
                <Link size={19} />
                <div>
                  <h3>Individual profile</h3>
                  <p>Add one standard LinkedIn or Sales Navigator lead URL.</p>
                </div>
              </div>
              <div className="inline-source-input">
                <input
                  aria-label="Individual LinkedIn profile URL"
                  placeholder="https://www.linkedin.com/in/profile-name/"
                  value={individualUrl}
                  onChange={(event) => {
                    setIndividualUrl(event.target.value);
                    setFeedback(null);
                  }}
                />
                <span className={normalizeLinkedInProfileUrl(individualUrl) ? "valid" : ""}>
                  {normalizeLinkedInProfileUrl(individualUrl) ? <Check size={16} /> : "URL"}
                </span>
              </div>

              <div className="section-divider" />

              <div className="section-heading">
                <ListPlus size={19} />
                <div>
                  <h3>Custom URL list</h3>
                  <p>Paste one URL per line or paste CSV/TXT content containing profile links.</p>
                </div>
              </div>
              <textarea
                className="source-textarea"
                placeholder={"https://www.linkedin.com/in/first-profile/\nhttps://www.linkedin.com/in/second-profile/"}
                value={bulkUrls}
                onChange={(event) => {
                  setBulkUrls(event.target.value);
                  setFeedback(null);
                }}
              />
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
              <div className="lead-import-actions">
                <button className="ghost-button" onClick={() => fileInputRef.current?.click()}>
                  <FileUp size={17} />
                  Upload CSV or TXT
                </button>
                <button
                  className="primary-button"
                  disabled={customProfiles.length === 0}
                  onClick={() => importProfiles("linkedin_urls")}
                >
                  <Upload size={17} />
                  Add {customProfiles.length || ""} profile{customProfiles.length === 1 ? "" : "s"}
                </button>
              </div>
            </section>

            <ImportSummary count={customProfiles.length} />
          </div>
        ) : (
          <div className="lead-import-layout">
            <section className="lead-import-form">
              <div className="section-heading">
                <Navigation size={19} />
                <div>
                  <h3>Sales Navigator search or list</h3>
                  <p>Open the source in managed Chrome and collect profile links currently visible on the page.</p>
                </div>
              </div>
              <div className="inline-source-input sales-source-input">
                <input
                  aria-label="Sales Navigator source URL"
                  placeholder="https://www.linkedin.com/sales/lists/people/..."
                  value={salesSourceUrl}
                  onChange={(event) => {
                    setSalesSourceUrl(event.target.value);
                    setFeedback(null);
                  }}
                />
                <span className={normalizedSalesSource ? "valid" : ""}>
                  {normalizedSalesSource ? <Check size={16} /> : "Sales URL"}
                </span>
              </div>
              <button
                className="primary-button collect-button"
                disabled={!normalizedSalesSource || isCollecting}
                onClick={() => void collectSalesNavigator()}
              >
                {isCollecting ? <LoaderCircle className="spin" size={17} /> : <ExternalLink size={17} />}
                {isCollecting ? "Collecting visible profiles" : "Open and collect visible profiles"}
              </button>

              <div className="section-divider" />

              <div className="section-heading">
                <ListPlus size={19} />
                <div>
                  <h3>Sales Navigator lead URLs</h3>
                  <p>Paste individual `/sales/lead/` URLs when you already have the exact leads.</p>
                </div>
              </div>
              <textarea
                className="source-textarea"
                placeholder="https://www.linkedin.com/sales/lead/sample-lead"
                value={salesLeadUrls}
                onChange={(event) => {
                  setSalesLeadUrls(event.target.value);
                  setFeedback(null);
                }}
              />
              <div className="lead-import-actions align-right">
                <button
                  className="primary-button"
                  disabled={salesProfiles.length === 0}
                  onClick={() => importProfiles("sales_navigator", salesProfiles, normalizedSalesSource ?? undefined)}
                >
                  <Upload size={17} />
                  Add {salesProfiles.length || ""} lead{salesProfiles.length === 1 ? "" : "s"}
                </button>
              </div>
            </section>

            <ImportSummary count={salesProfiles.length} salesNavigator />
          </div>
        )}

        {feedback ? <div className={`source-feedback ${feedback.tone}`}>{feedback.message}</div> : null}

        <footer className="modal-actions source-modal-footer">
          <button className="ghost-button" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function ImportSummary({ count, salesNavigator = false }: { count: number; salesNavigator?: boolean }) {
  return (
    <aside className="import-summary">
      <span className="summary-label">Ready to add</span>
      <strong>{count}</strong>
      <span>{salesNavigator ? "pasted Sales Navigator leads" : "unique LinkedIn profiles"}</span>
      <div className="summary-rule" />
      <p>Duplicates already in this campaign are skipped automatically.</p>
      {salesNavigator ? <p>Search/list collection reads only links currently loaded in managed Chrome.</p> : null}
    </aside>
  );
}
