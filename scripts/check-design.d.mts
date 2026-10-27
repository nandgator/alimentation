export interface Problem {
  file: string;
  line: number;
  rule: string;
  why: string;
  text: string;
}
export function check(): Problem[];
export function checkCssText(text: string, file?: string, rules?: string): Problem[];
export function checkTsxText(text: string, file?: string): Problem[];
