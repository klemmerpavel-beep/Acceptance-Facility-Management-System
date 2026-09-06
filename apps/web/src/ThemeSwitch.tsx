import { useSyncExternalStore } from "react";
import { applyThemeMode, readThemeMode, subscribeThemeMode, type ThemeMode } from "./theme.js";

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
  // Состояние общее для всех копий переключателя: выбор в шапке обязан
  // отражаться и в настройках, где обе копии видны сразу.
  const mode = useSyncExternalStore<ThemeMode>(subscribeThemeMode, readThemeMode, () => "system");

  return (
    <div className="themeswitch" role="group" aria-label="Тема оформления">
      {MODES.map((option) => (
        <button
          key={option.mode}
          type="button"
          className="themeswitch__option"
          aria-pressed={mode === option.mode}
          title={option.label}
          onClick={() => { applyThemeMode(option.mode); }}
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
