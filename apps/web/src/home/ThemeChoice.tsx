import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { THEME_LABEL, THEMES, type Theme, useTheme } from "../theme.ts";

/**
 * The theme choice on the home page's close: automatic, light or dark. It is a group named "Theme" holding three
 * radios, the same choice the account menu and the documentation make, kept under the same key (src/theme.ts).
 */
export function ThemeChoice({ className }: { className?: string }) {
  const [theme, set] = useTheme();
  return (
    <fieldset className={className ? `foot-theme ${className}` : "foot-theme"}>
      <legend>Theme</legend>
      <RadioGroup
        className="foot-opts"
        aria-label="Colour theme"
        value={theme}
        onValueChange={(v) => set(v as Theme)}
      >
        {THEMES.map((t) => (
          <Radio.Root key={t} value={t}>
            {THEME_LABEL[t]}
          </Radio.Root>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
