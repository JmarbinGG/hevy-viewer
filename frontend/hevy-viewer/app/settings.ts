export type UnitSystem = "kg" | "lb";
export type ColorTheme = "coffee" | "blue" | "cream" | "mono";

export type ViewerSettings = {
  unitSystem: UnitSystem;
  colorTheme: ColorTheme;
  startDate: string;
};

export const DEFAULT_SETTINGS: ViewerSettings = {
  unitSystem: "kg",
  colorTheme: "coffee",
  startDate: "",
};

export const SETTINGS_STORAGE_KEY = "hevy-viewer-settings";

export function readSettings(): ViewerSettings {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as Partial<ViewerSettings>;
    return {
      unitSystem: stored.unitSystem === "lb" ? "lb" : DEFAULT_SETTINGS.unitSystem,
      colorTheme: stored.colorTheme === "blue" || stored.colorTheme === "cream" || stored.colorTheme === "mono"
        ? stored.colorTheme
        : DEFAULT_SETTINGS.colorTheme,
      startDate: typeof stored.startDate === "string" ? stored.startDate : DEFAULT_SETTINGS.startDate,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: ViewerSettings): void {
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("hevy-settings-change", { detail: settings }));
}

export function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
}
