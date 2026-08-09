import { safetyDefaults } from "./safety";
import type { HumanTouchSettings } from "../types";

const SAFETY_SETTINGS_KEY = "linkedin-automator.safety-settings-v1";

export function loadSafetySettings(): HumanTouchSettings {
  try {
    const stored = window.localStorage.getItem(SAFETY_SETTINGS_KEY);
    return stored ? { ...safetyDefaults, ...(JSON.parse(stored) as Partial<HumanTouchSettings>) } : safetyDefaults;
  } catch {
    return safetyDefaults;
  }
}

export function saveSafetySettings(settings: HumanTouchSettings) {
  window.localStorage.setItem(SAFETY_SETTINGS_KEY, JSON.stringify(settings));
}
