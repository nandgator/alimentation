/** A value that has to be there: what a lookup the caller has already made sure of hands back. */
export function must<T>(value: T | null | undefined, what = "a value that should be there"): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}
