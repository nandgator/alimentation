# Platform research, 2026-10-24

Evidence behind `DESIGN.md` sections 3 and 10. Each file assesses a group of
hosting platforms against the same ten-point rubric (free with no expiry,
per-tenant isolation, Postgres fit, compute, static hosting, free-tier rules,
logs, region, one-click deploy, overall fit). Every finding carries a verbatim
quote, the URL it came from and a confidence tag:

- PRIMARY: a vendor page (pricing, documentation, terms) fetched on 2026-10-24.
- SECONDARY: a search summary or a third-party page.
- UNKNOWN: not found. Nothing is guessed.

Neon and Cloudflare were read directly and are cited in `DESIGN.md` section 3.
Vendor terms and limits change often; re-verify anything here before relying on it
for a commercial decision. Rows marked UNKNOWN are open questions, not findings.

| File                                             | Platforms                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| [platforms-backends.md](platforms-backends.md)   | Appwrite, Firebase, Convex                                                                                     |
| [platforms-compute.md](platforms-compute.md)     | Render, Koyeb, Cloud Run, Deno Deploy, Vercel, Netlify, Fly.io, Railway, Northflank, Zeabur, Sevalla, Back4app |
| [platforms-databases.md](platforms-databases.md) | Aiven, CockroachDB, Xata, Nile, Turso, Prisma Postgres, Tiger Data, Crunchy Bridge, PlanetScale                |
| [platforms-vms.md](platforms-vms.md)             | Oracle Always Free, Google Compute Engine, AWS, Azure, Cloudflare Containers, Codespaces                       |
