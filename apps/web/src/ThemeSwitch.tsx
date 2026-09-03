import { useState } from "react";
import { applyThemeMode, readThemeMode, type ThemeMode } from "./theme.js";

/**
 * Порядок значим: слева направо — от «решает система» к «решаю я»,
 * от светлого к тёмному. Подпись у каждого состояния своя, потому что
 * различие передано не только цветом (§7 дизайн-системы).
 */
const MODES: readonly { mode: ThemeMode; label: string; icon: string }[] = [
  { mode: "system", label: "Как в системе", icon: "#i-theme-system" },
  { mode: "light", label: "Светлая тема", icon: "#i-theme-light" },
  { mode: "dark", label: "Тёмная тема", icon: "#i-theme-dark" },
];

export function ThemeSwitch(): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);

  const choose = (next: ThemeMode): void => {
    applyThemeMode(next);
    setMode(next);
  };

  return (
    <div className="themeswitch" role="group" aria-label="Тема оформления">
      {MODES.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="themeswitch__option"
          aria-pressed={mode === option.mode}
          title={option.label}
          onClick={() => choose(option.mode)}
        >
          <svg className="icon" aria-hidden="true">
            <use href={option.icon} />
          </svg>
          <span className="visually-hidden">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
