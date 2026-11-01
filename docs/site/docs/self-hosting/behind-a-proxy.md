---
title: Behind a proxy
description: Putting the app and its API reference at one address, for a machine or a test deployment, with Caddy, and the same two routes for Nginx, HAProxy or Traefik.
---

# Behind a proxy

The app, its documentation and the [API reference](/docs/api/reference/) are different programs. The app and the documentation are one, at the address you chose. The API reference is a small site of its own, so that a change to a sentence in it is not a new version of the server. To reach them at one address, put a proxy in front with two routes:

| Path          | Goes to                  | Notes                                                                                           |
| ------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `/reference/` | the reference, port 8788 | The prefix is taken off on the way in, and `/reference` is sent on to `/reference/` with a 308. |
| everything    | the app, port 8787       | As it is. Nothing about the app needs to know there is a proxy.                                 |

## With Compose, and Caddy

This is shipped, and it is off unless you ask for it: the plain `docker compose up` stays one app and one database.

```console
$ docker compose -f compose.yaml -f compose.proxy.yaml up -d --build
```

Then `http://localhost:8787` is the app and its documentation as before, and `http://localhost:8787/reference/` is the reference. The address is the one you already had, so `APP_ORIGIN` does not change. The reference is reached only through the proxy, and the app no longer publishes a port of its own. (It is a second file and not a profile because a profile cannot take away a port the app publishes by itself. For a domain with HTTPS use `compose.https.yaml`, which has Caddy get and renew the certificate.)

The proxy's whole configuration is `deploy/Caddyfile.local`:

```text file=deploy/Caddyfile.local#L6-L21

```

## With something else

Any proxy that does the two routes works. These are the same routes for the others, written from each one's documentation; only Caddy, above, has been run against this app.

**Nginx.** The slash after the address in `proxy_pass` is what takes the prefix off.

```text title="nginx.conf"
server {
  listen 80;
  location = /reference { return 308 /reference/; }
  location /reference/ { proxy_pass http://reference:8788/; }
  location / {
    proxy_pass http://app:8787;
    proxy_set_header Host $host;
  }
}
```

**HAProxy.**

```text title="haproxy.cfg"
frontend web
  bind *:80
  acl reference path_beg /reference/
  http-request redirect location /reference/ code 308 if { path /reference }
  http-request set-path %[path,regsub(^/reference,)] if reference
  use_backend reference if reference
  default_backend app

backend app
  server app app:8787

backend reference
  server reference reference:8788
```

**Traefik**, with labels on the two services (the redirect comes first in the chain, so a bare `/reference` is sent on before the prefix is stripped):

```text title="Labels in compose.yaml"
reference:
  labels:
    - traefik.enable=true
    - traefik.http.routers.reference.rule=PathPrefix(`/reference`)
    - traefik.http.routers.reference.priority=100
    - traefik.http.routers.reference.middlewares=reference-slash,reference-strip
    - traefik.http.middlewares.reference-slash.redirectregex.regex=^(https?://[^/]+/reference)$$
    - traefik.http.middlewares.reference-slash.redirectregex.replacement=$${1}/
    - traefik.http.middlewares.reference-strip.stripprefix.prefixes=/reference
    - traefik.http.services.reference.loadbalancer.server.port=8788
app:
  labels:
    - traefik.enable=true
    - traefik.http.routers.app.rule=PathPrefix(`/`)
    - traefik.http.routers.app.priority=1
    - traefik.http.services.app.loadbalancer.server.port=8787
```

Whatever the proxy, three things hold. `APP_ORIGIN` is the address people type, as the browser sends it, because the app refuses a write that comes from any other address. The proxy may add its own headers, but must keep the `Origin` the browser sent. And the reference is served by its own small server (`serve.mjs`) with its own security policy, which allows no script but its own: leave its headers alone.
