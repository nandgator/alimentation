// Starts Scalar on the document the build wrote beside this file. It is a file of its own, not a
// script in the page, so the page can be served with a policy that allows no inline script. Every address
// here is relative to the page, so the site works at the top of a host and under a path alike.
Scalar.createApiReference("#app", {
  // Beside this page, wherever it is served from: at the top of its own address, or under /reference/ behind a proxy.
  url: "openapi.json",
  metaData: { title: "Alimentation API reference" },
  // The API answers only a browser on its own site, with its cookie, so a request sent from here
  // could not work. This reference is for reading.
  hideTestRequestButton: true,
  hideClientButton: true,
  showDeveloperTools: "never",
  // Nothing is fetched from outside this site: no fonts, no telemetry, no assistant.
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  customCss:
    ".light-mode { --scalar-color-accent: #1f4d3a; } .dark-mode { --scalar-color-accent: #8cc7a6; }",
});
