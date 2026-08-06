import { ArrowLeft, Building2, FileUp, Linkedin, ListChecks, Navigation, Search, Upload, Users } from "lucide-react";

type LeadSourceWizardProps = {
  onClose: () => void;
};

const sourceTabs = ["LinkedIn", "Sales Navigator", "Recruiter (Talent)", "Upload Profiles", "Lists"] as const;

const linkedInSources = [
  "Search page",
  "My network page",
  "School alumni page",
  "Company people page",
  "My group page",
  "My event page",
  "Who's viewed your profile page",
  "Sent invitations page",
  "Followers page",
  "Following page",
  "LinkedIn URL"
];

export function LeadSourceWizard({ onClose }: LeadSourceWizardProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="wide-modal">
        <header className="modal-header">
          <button className="icon-text-button" onClick={onClose}>
            <ArrowLeft size={18} />
          </button>
          <h2>Choose a source to fill your campaign with profiles</h2>
        </header>

        <div className="source-tabs">
          {sourceTabs.map((tab, index) => (
            <button className={index === 0 ? "active" : ""} key={tab}>
              {tab}
            </button>
          ))}
        </div>

        <div className="source-grid">
          <nav className="source-list">
            {linkedInSources.map((source, index) => (
              <button className={index === 0 ? "active" : ""} key={source}>
                {source}
              </button>
            ))}
          </nav>

          <section className="source-preview-panel">
            <div>
              <h3>Fill with profiles from Search page</h3>
              <p>Search and filter by position, company, industry, location, and more.</p>
            </div>
            <button className="primary-button">Continue</button>
            <div className="browser-preview">
              <div className="browser-topbar">
                <Linkedin size={22} />
                <span>Search people by filters</span>
              </div>
              {[1, 2, 3, 4].map((row) => (
                <div className="browser-result-row" key={row}>
                  <div className="profile-avatar small">in</div>
                  <div>
                    <strong>Target profile result</strong>
                    <span>2nd connection - current company - location</span>
                  </div>
                  <button>Connect</button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="source-secondary-grid">
          <div className="source-card">
            <Search size={20} />
            <strong>Sales Navigator</strong>
            <span>Search page or saved list page.</span>
          </div>
          <div className="source-card">
            <Building2 size={20} />
            <strong>Recruiter</strong>
            <span>Talent search sources can plug into the same queue.</span>
          </div>
          <div className="source-card">
            <FileUp size={20} />
            <strong>Upload profiles</strong>
            <span>CSV, TXT, HTML, pasted URLs, or Linked Helper exports.</span>
          </div>
          <div className="source-card">
            <ListChecks size={20} />
            <strong>Existing lists</strong>
            <span>Profiles to process, accepted, replied, failed, excluded.</span>
          </div>
        </section>

        <section className="upload-strip">
          <div>
            <Upload size={19} />
            <span>Select CSV, TXT, HTML, or paste LinkedIn profile URLs.</span>
          </div>
          <div>
            <Users size={19} />
            <span>Add from selected campaign sub-list.</span>
          </div>
          <div>
            <Navigation size={19} />
            <span>Use managed Chrome to collect from the current LinkedIn page later.</span>
          </div>
        </section>
      </section>
    </div>
  );
}
