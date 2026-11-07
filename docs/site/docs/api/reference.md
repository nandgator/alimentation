---

title: API reference
description:
Where the reference for every route is, how it is made from the server itself, and why it is a
site of its own.
---

# API reference

The reference for every route (who may call it, what it takes, what it returns and how it fails) is
**a site of its own**, drawn by [Scalar](https://github.com/scalar/scalar) from the server's own
routes. It is not among these pages. What these pages explain is how the system is built and run;
the reference is what a person writing a client reads, and it is kept apart so that each can change
without the other.

[**Open the API reference**](/reference/) when the instance you are reading this on serves it (see
the first row below); the link is the same address with `/reference/` after it.

## Where it is

| Where            | How                                                                                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Behind a proxy   | `docker compose -f compose.yaml -f compose.proxy.yaml up -d --build`: the app and the reference at one address, the reference at `/reference/`. [Behind a proxy](/docs/self-hosting/behind-a-proxy/) says how, and how to do it with Nginx, HAProxy or Traefik. |
| On a machine     | `npm run dev:reference` builds it and serves it at `http://localhost:8788`.                                                                                                                                                                                     |
| In a container   | `docker compose --profile reference up -d --build reference`, then `http://localhost:8788`. It is a small image of its own.                                                                                                                                     |
| On Cloudflare    | The built files are static assets: `npm run build:reference`, then `npx wrangler deploy -c apps/reference/wrangler.jsonc`.                                                                                                                                      |
| For another tool | `openapi.json` beside the page is an OpenAPI 3.1 document. Load it into any viewer, or read it with a program.                                                                                                                                                  |

Nothing is fetched from anywhere when it is read: Scalar's own files are served with it, and the
page is served under a policy that allows no script but its own and no request to any other site.

## How it is made

Every route the server answers is listed once, in `apps/api/src/openapi.ts`, with the very schema
the route reads its body or query with (`apps/api/src/schemas.ts`). So a body the reference shows is
a body the server takes, with the same limits.

`npm run build:reference` writes the document, checks it with the parser Scalar reads it with, and
copies Scalar's browser files beside it. A test fails if:

- the server answers a route the reference does not list, or the reference lists one the server does
  not answer;
- the server can send an error code, with a given status, that the reference does not list;
- the document is one Scalar's own parser finds wrong.

## Why it is apart

- **Its policy is different.** Scalar writes its own style element, so its page allows inline
  styles. The app's does not, and does not need to be weakened for a page of documentation.
- **It cannot send requests, and says so.** The API answers a browser on its own site, with its own
  cookie, and refuses a write from anywhere else ([Security](/docs/security/overview/)). A button
  that sends a request from another site could never work, so it is left out. The reference is for
  reading.
- **It is deployed on its own.** A change to a sentence in the reference does not mean a new version
  of the server.
