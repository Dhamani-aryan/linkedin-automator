import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
const safetyTabs = ["Limits", "Working hours", "Actions", "Interface", "External CRMs"] as const;

type SafetyTab = (typeof safetyTabs)[number];
type WorkingDayMode = "24-hours" | "do-not-work";

export function SafetyLimitsPage({ settings, onChange }: SafetyLimitsPageProps) {
  const [activeTab, setActiveTab] = useState<SafetyTab>("Limits");
  const [workingDayModes, setWorkingDayModes] = useState<Record<string, WorkingDayMode>>(() =>
    Object.fromEntries(workingDays.map((day) => [day, "24-hours" as const]))
  );

  function setWorkingDayMode(day: string, mode: WorkingDayMode) {
    setWorkingDayModes((currentModes) => ({
      ...currentModes,
      [day]: mode
    }));
    if (mode === "24-hours") {
      onChange({
        ...settings,
        workingHoursStart: "00:00",
        workingHoursEnd: "00:00"
      });
    }
  }

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
        {safetyTabs.map((tab) => (
          <button
            className={activeTab === tab ? "active" : ""}
            key={tab}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Limits" ? (
        <section className="limits-panel">
          <h2>Daily activity limit</h2>
          <div className="daily-limit-row">
            <label>
              <input type="checkbox" checked readOnly />
              <span>Max actions per 24 hours</span>
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
                <div className="limit-title-cell">
                  <strong>{limit.action}</strong>
                  <span>Smart Daily Limit Adjustment</span>
                </div>
                <input type="number" defaultValue={limit.limit} />
                <div className="limit-period-cell">
                  <span>per</span>
                  <input type="text" defaultValue={limit.window} />
                </div>
                <div className="limit-icon-actions">
                  <button className="icon-button run" title="Add limit">
                    <Plus size={16} />
                  </button>
                  <button className="icon-button stop" title="Delete limit">
                    <Trash2 size={16} />
                  </button>
                </div>
                <em>{limit.used}</em>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Working hours" ? (
        <section className="working-hours-panel">
          <h2>Working hours</h2>
          <div className="timezone-select">UTC +5:30</div>
          <div className="daily-limit-row">
            <label>
              <input
                type="checkbox"
                checked={settings.workingHoursStart === settings.workingHoursEnd}
                onChange={(event) => {
                  onChange({
                    ...settings,
                    workingHoursStart: event.target.checked ? "00:00" : "09:30",
                    workingHoursEnd: event.target.checked ? "00:00" : "18:30"
                  });
                }}
              />
              <span>Run 24 hours</span>
            </label>
            <strong>
              {settings.workingHoursStart === settings.workingHoursEnd
                ? "Always allowed"
                : `${settings.workingHoursStart}-${settings.workingHoursEnd}`}
            </strong>
          </div>
          <div className="working-day-list">
            {workingDays.map((day) => (
              <div className="working-day-row" key={day}>
                <strong>{day}</strong>
                <button
                  className={`pill ${workingDayModes[day] === "24-hours" ? "active" : ""}`}
                  onClick={() => setWorkingDayMode(day, "24-hours")}
                >
                  24 hours
                </button>
                <button
                  className={`pill ${workingDayModes[day] === "do-not-work" ? "active danger-pill" : ""}`}
                  onClick={() => setWorkingDayMode(day, "do-not-work")}
                >
                  Do not work
                </button>
                <button className="icon-button run" title={`Add ${day} range`}>
                  <Plus size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Actions" ? <HumanTouchPanel settings={settings} onChange={onChange} /> : null}

      {activeTab === "Interface" ? (
        <section className="placeholder-page">
          <p className="eyebrow">Interface</p>
          <h1>Interface</h1>
          <p className="muted">Theme, display density, and notification preferences will live here.</p>
        </section>
      ) : null}

      {activeTab === "External CRMs" ? (
        <section className="placeholder-page">
          <p className="eyebrow">External CRMs</p>
          <h1>External CRMs</h1>
          <p className="muted">CRM exports and sync settings will live here.</p>
        </section>
      ) : null}
    </section>
  );
}
