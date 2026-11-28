/**
 * A destructive button that passes contrast in both themes. The ui Button's `destructive` variant is a 10% tint of the
 * red, whose text measures 4.4:1 on it in the light theme (4.5 is the line). Use this class on it until the variant is
 * changed in WP0's button.tsx.
 */
export const SOLID_DESTRUCTIVE =
  "bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90";
