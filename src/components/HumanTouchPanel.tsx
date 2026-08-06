import { Clock3, Coffee, MousePointer2, ShieldCheck } from "lucide-react";
import type { HumanTouchSettings } from "../types";

type HumanTouchPanelProps = {
  settings: HumanTouchSettings;
  onChange: (settings: HumanTouchSettings) => void;
};

type NumberSettingKey =
  | "dailyActionLimit"
  | "dailyInviteLimit"
  | "minDelaySeconds"
  | "maxDelaySeconds"
  | "batchSize"
  | "cooldownAfterBatchMinutes";

type BooleanSettingKey = "randomizeScroll" | "pauseOnReply";
type TextSettingKey = "workingHoursStart" | "workingHoursEnd";

export function HumanTouchPanel({ settings, onChange }: HumanTouchPanelProps) {
  function updateNumber(key: NumberSettingKey, value: string) {
    onChange({
      ...settings,
      [key]: Number(value)
    });
  }

  function updateBoolean(key: BooleanSettingKey, value: boolean) {
    onChange({
      ...settings,
      [key]: value
    });
  }

  function updateText(key: TextSettingKey, value: string) {
    onChange({
      ...settings,
      [key]: value
    });
  }

  return (
    <section className="human-touch-panel">
      <header>
        <div>
          <p className="eyebrow">Safety Limits</p>
          <h2>Human touch & cooldown</h2>
        </div>
        <div className="safety-summary-pill">
          <ShieldCheck size={18} />
          Same IP, local Chrome
        </div>
      </header>

      <div className="human-touch-grid">
        <label className="setting-field">
          <span>Daily actions</span>
          <input
            type="number"
            min="1"
            value={settings.dailyActionLimit}
            onChange={(event) => updateNumber("dailyActionLimit", event.target.value)}
          />
        </label>
        <label className="setting-field">
          <span>Daily invites</span>
          <input
            type="number"
            min="1"
            value={settings.dailyInviteLimit}
            onChange={(event) => updateNumber("dailyInviteLimit", event.target.value)}
          />
        </label>
        <label className="setting-field">
          <span>Min action delay</span>
          <input
            type="number"
            min="5"
            value={settings.minDelaySeconds}
            onChange={(event) => updateNumber("minDelaySeconds", event.target.value)}
          />
        </label>
        <label className="setting-field">
          <span>Max action delay</span>
          <input
            type="number"
            min={settings.minDelaySeconds}
            value={settings.maxDelaySeconds}
            onChange={(event) => updateNumber("maxDelaySeconds", event.target.value)}
          />
        </label>
        <label className="setting-field">
          <span>Batch size</span>
          <input
            type="number"
            min="1"
            value={settings.batchSize}
            onChange={(event) => updateNumber("batchSize", event.target.value)}
          />
        </label>
        <label className="setting-field">
          <span>Batch cooldown</span>
          <input
            type="number"
            min="1"
            value={settings.cooldownAfterBatchMinutes}
            onChange={(event) => updateNumber("cooldownAfterBatchMinutes", event.target.value)}
          />
        </label>
      </div>

      <div className="cooldown-row">
        <div className="cooldown-card">
          <Clock3 size={20} />
          <div>
            <strong>Working hours</strong>
            <div className="time-inputs">
              <input
                type="time"
                value={settings.workingHoursStart}
                onChange={(event) => updateText("workingHoursStart", event.target.value)}
              />
              <span>to</span>
              <input
                type="time"
                value={settings.workingHoursEnd}
                onChange={(event) => updateText("workingHoursEnd", event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="cooldown-card">
          <Coffee size={20} />
          <div>
            <strong>After every {settings.batchSize} actions</strong>
            <span>Cool down for {settings.cooldownAfterBatchMinutes} minutes before continuing.</span>
          </div>
        </div>
        <div className="cooldown-card">
          <MousePointer2 size={20} />
          <div>
            <strong>Profile dwell time</strong>
            <span>{settings.randomProfileViewSeconds[0]}-{settings.randomProfileViewSeconds[1]} seconds before action.</span>
          </div>
        </div>
      </div>

      <div className="toggle-row">
        <label>
          <input
            type="checkbox"
            checked={settings.randomizeScroll}
            onChange={(event) => updateBoolean("randomizeScroll", event.target.checked)}
          />
          Random scroll and small pauses
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.pauseOnReply}
            onChange={(event) => updateBoolean("pauseOnReply", event.target.checked)}
          />
          Pause follow-ups when a reply is found
        </label>
      </div>
    </section>
  );
}
