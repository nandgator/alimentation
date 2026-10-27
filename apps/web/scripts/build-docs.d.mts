export function buildDocs(options?: { src?: string; dist?: string }): {
  pages: string[];
  sites: { dir: string; pages: string[] }[];
  dist: string;
};
