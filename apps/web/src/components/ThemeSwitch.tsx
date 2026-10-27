import { useId } from 'react';
import { THEMES, THEME_LABEL, useTheme } from '../theme.ts';

/** Automatic, light or dark: three choices in one group, set on the system's setting until someone picks. */
export function ThemeSwitch({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  const name = useId();
  return (
    <fieldset className={className ? `theme-switch ${className}` : 'theme-switch'}>
      <legend>Colours</legend>
      <div className="theme-opts">
        {THEMES.map((t) => (
          <label key={t}>
            <input
              type="radio"
              name={name}
              value={t}
              checked={theme === t}
              onChange={() => set(t)}
            />
            <span>{THEME_LABEL[t]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
