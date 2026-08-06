import { Check, Plus, Trash2 } from "lucide-react";
import { HumanTouchPanel } from "./HumanTouchPanel";
import type { HumanTouchSettings } from "../types";

type SafetyLimitsPageProps = {
  settings: HumanTouchSettings;
  onChange: (settings: HumanTouchSettings) => void;
};

const actionLimits = [
  { action: "Invite 2nd and 3rd level contacts", limit: 50, window: "24 hours", used: "0 of 50" },
  { action: "Send message to 1st level contacts", limit: 75, window: "24 hours", used: "0 of 75" },
  { action: "View profiles", limit: 100, window: "24 hours", used: "0 of 100" },
  { action: "Follow or unfollow profiles", limit: 40, window: "24 hours", used: "0 of 40" }
];

const workingDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function SafetyLimitsPage({ settings, onChange }: SafetyLimitsPageProps) {
  return (
    <section className="safety-page">
      <header className="manager-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Safety Limits</h1>
        </div>
        <button className="primary-button">
          <Check size={18} />
          Format and save
        </button>
      </header>

      <div className="settings-tabs">
        <button className="active">Limits</button>
        <button>Working hours</button>
        <button>Actions</button>
        <button>Interface</button>
        <button>External CRMs</button>
      </div>

      <div className="safety-page-grid">
        <section className="limits-panel">
          <h2>Daily activity limit</h2>
          <div className="daily-limit-row">
            <label>
              <input type="checkbox" checked readOnly />
              Max actions per 24 hours
            </label>
            <input
              type="number"
              min="1"
              value={settings.dailyActionLimit}
              onChange={(event) =>
                onChange({
                  ...settings,
                  dailyActionLimit: Number(event.target.value)
                })
              }
            />
          </div>

          <h2>Action limits</h2>
          <div className="limit-list">
            {actionLimits.map((limit) => (
              <article className="limit-row" key={limit.action}>
                <div>
                  <strong>{limit.action}</strong>
                  <span>Smart Daily Limit Adjustment</span>
                </div>
                <input type="number" defaultValue={limit.limit} />
                <span>per</span>
                <input type="text" defaultValue={limit.window} />
                <button className="icon-button run" title="Add limit">
                  <Plus size={16} />
                </button>
                <button className="icon-button stop" title="Delete limit">
                  <Trash2 size={16} />
                </button>
                <em>{limit.used}</em>
              </article>
            ))}
          </div>
        </section>

        <section className="working-hours-panel">
          <h2>Working hours</h2>
          <div className="timezone-select">UTC +5:30</div>
          <div className="working-day-list">
            {workingDays.map((day) => (
              <div className="working-day-row" key={day}>
                <strong>{day}</strong>
                <button className="pill active">24 hours</button>
                <button className="pill">Do not work</button>
                <button className="icon-button run" title={`Add ${day} range`}>
                  <Plus size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <HumanTouchPanel settings={settings} onChange={onChange} />
    </section>
  );
}
