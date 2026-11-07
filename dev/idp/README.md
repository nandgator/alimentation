# Sign in through a real identity provider, on this machine

```sh
dev/idp/idp.sh up authelia       # the provider, its directory of people, and the app
dev/idp/idp.sh test authelia     # signs in through it in a real browser
dev/idp/idp.sh down authelia
dev/idp/idp.sh reset authelia    # forget everything it made
```

Authelia, with LLDAP as its directory, is the one that is run and tested. What the others need
(authentik, Zitadel, Supabase Auth, Appwrite, Nhost), which products cannot be a provider at all
(LLDAP on its own, PocketBase, Convex), and what the app asks of any provider, are in the
documentation: `docs/site/docs/self-hosting/sign-in-locally.md`, hosted at
`/docs/self-hosting/sign-in-locally/`.

- `idp.sh` is the entry point; `lib.sh` makes the certificate authority and the secrets;
  `providers/<name>/` holds a provider's compose overlay, its configuration and `provider.sh` (what
  to make before it starts, how to make the people, what to print).
- Everything it makes is in `.state/`, which git and the Docker build both ignore.
- To add a provider: a directory under `providers/`, and its sign-in page in
  `apps/web/e2e-idp/providers.ts`, so that the one spec, `signin.spec.ts`, runs against it.
