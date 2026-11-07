// @ts-check

/**
 * MD018, for prose wrapped at 80 columns. A line that starts a paragraph and
 * reads "#Heading" is a heading missing its space, as MD018 says, and the fix
 * is that space. A line that continues a paragraph never is: prettier's
 * proseWrap "always" can break "Board #5" so "#5)" starts a line, and MD018's
 * fix there makes "# 5)" a heading, cutting the paragraph in two.
 *
 * @type {import("markdownlint").Rule}
 */
export default {
  names: ["HYM018", "no-missing-space-atx-paragraph"],
  description: "No space after hash on atx style heading (paragraph start)",
  tags: ["headings", "atx", "spaces"],
  parser: "micromark",
  function: (params, onError) => {
    /** @type {number[]} */
    const starts = [];
    /** @param {import("markdownlint").MicromarkToken[]} tokens */
    const visit = (tokens) => {
      for (const token of tokens) {
        if (token.type === "paragraph") starts.push(token.startLine);
        else visit(token.children);
      }
    };
    visit(params.parsers.micromark.tokens);
    for (const lineNumber of starts) {
      const line = params.lines[lineNumber - 1];
      const hashes = /^#+(?=[^# \t])/.exec(line);
      if (!hashes || /#\s*$/.test(line) || line.startsWith("#️⃣")) continue;
      onError({
        lineNumber,
        context: line.trim(),
        range: [1, hashes[0].length + 1],
        fixInfo: { editColumn: hashes[0].length + 1, insertText: " " },
      });
    }
  },
};
