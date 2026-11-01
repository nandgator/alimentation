---
title: Try sign-in on your machine
description: Run the app against a real identity provider on your own computer, which providers can be used, and what the app needs of one.
---

# Try sign-in on your machine

Production sign-in goes through an OpenID Connect provider. To try that without a domain or an account anywhere, `dev/idp/idp.sh` starts a provider beside the app on your computer, makes two people in it, and prints how to sign in.

```sh
dev/idp/idp.sh up authelia      # the first time builds the app, which takes a few minutes
dev/idp/idp.sh test authelia    # signs in through it in a real browser, as a person would
dev/idp/idp.sh down authelia    # stops it; the people and keys are kept
dev/idp/idp.sh reset authelia   # stops it and forgets everything it made
```

It needs Docker with Compose, `openssl` and `curl`. Nothing is installed on your computer beyond the containers and a git-ignored folder, `dev/idp/.state`, where it keeps a certificate authority of its own, every secret it made, and the test people's passwords.

## What it starts

```mermaid title="The app, the provider and the directory of people, on one machine"
flowchart LR
  Browser["<b>Your browser</b>"]
  App["<b>Alimentation</b><br/>localhost:8787"]
  Authelia["<b>Authelia</b><br/>authelia.localhost:9091<br/>the identity provider"]
  Lldap[("<b>LLDAP</b><br/>the directory:<br/>alice and bina")]
  Browser -->|Sign in| App
  App -->|redirects to| Authelia
  Authelia -->|asks who they are| Lldap
  Authelia -->|code, then identity| App
```

Two things are worth knowing about how they are joined, because both come from how a provider names itself.

- **The app and the browser use one address for the provider.** An identity token names the address of the provider that made it, and the app checks that name. So the app reaches Authelia under the same name and port the browser does, `https://authelia.localhost:9091`: a `*.localhost` name is your own machine to a browser, and inside Compose it is a network alias of Authelia's container.
- **Authelia insists on https.** It refuses to start with an `http` address of its own. So it is served over a certificate from the local authority, which the app is told to trust with `NODE_EXTRA_CA_CERTS`, and a browser is not, so it warns once. The test ignores that, for this one machine.

If you run the app on the host instead of in Compose (`npm run dev:api`), a `*.localhost` name does not resolve outside a browser on most systems, so add `127.0.0.1 authelia.localhost` to your hosts file, and start the app with `NODE_EXTRA_CA_CERTS=dev/idp/.state/ca.pem`.

## Which providers can be used

Not everything with "auth" in its name is a provider. A provider is something an app can send a person to and get back who they are, over OpenID Connect.

| Product       | Can it be one?                                                                  | Here                                                                                                              |
| ------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Authelia      | Yes.                                                                            | **Run and tested**: `dev/idp/idp.sh up authelia`. A browser signs in through its real pages.                      |
| LLDAP         | **No**: it is a directory of people over LDAP, with no sign-in.                 | Used as Authelia's directory in the same kit. It could equally sit behind authentik or Zitadel.                   |
| authentik     | Yes.                                                                            | Not run here: its images and database were too big for the machine this was built on. Settings below.             |
| Zitadel       | Yes.                                                                            | Not run here. Settings below.                                                                                     |
| Supabase Auth | Yes, as an OAuth 2.1 and OpenID Connect server (in beta when this was written). | Not run here. You must host the consent page it sends people to, with its SDK; there is nothing to click through. |
| Appwrite      | Yes, as an OAuth2 server.                                                       | Not run here. Also needs a consent screen you host.                                                               |
| Nhost         | Yes, in its Auth service.                                                       | Not run here. Also needs a consent page you build, and an RSA signing key.                                        |
| PocketBase    | **No**: it signs people in with other providers.                                | Nothing to do.                                                                                                    |
| Convex        | **No**: it checks tokens that others issue.                                     | Nothing to do.                                                                                                    |

"Not run here" means exactly that: the app is written to the standard and the settings below come from each product's own documentation, but nobody has watched a person sign in through them. Treat them as a starting point. The three that need a consent page you host are possible, but they are not a quick local trial.

## What the app asks of a provider

Any provider that does all of this works, with no code written for it.

1. **Authorisation code with PKCE** (`S256`), and a **client secret**. The secret is sent in the body of the token request, or in a Basic header if the provider says that is the only way it takes it. A provider that lists both is sent it in the body, which is what it always was.
2. The scopes `openid email profile`, and the redirect address `$APP_ORIGIN/auth/callback`, exactly.
3. An **email address that the provider says is verified** (`email_verified` true), in the identity token or, failing that, from the userinfo endpoint. Some providers keep the email out of the identity token unless told otherwise (Authelia and Zitadel do); the userinfo endpoint answers for them, and must be answering about the same person. An unverified email is always refused: the email is how a person is found by an invitation.
4. A signed identity token with the provider's issuer address, the app's client id as audience, and the nonce the app sent.

An account is an email. If the same verified email arrives from another provider (you pointed the instance at a new one), it is the same account, and keeps its kitchens. A person whose email at the provider has become someone else's here is refused with a clear message.

## Providers it has met

| Provider  | Result                                                                                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google    | Works. Its published document is in the tests, and what is sent to it and what is decided are pinned.                                                                                                                                                                      |
| Microsoft | **Refused.** Entra's identity tokens carry no `email_verified`, and its own document does not list it. This is how it was before. Supporting it means deciding to trust `xms_edov`, the optional claim that says the email's domain is owned by the person's organisation. |
| Apple     | **Refused.** Apple writes `email_verified` as the string `"true"`, which is not accepted. It would also need the `profile` scope left out, a client secret that is a signed token, and its form-post callback.                                                             |
| Meta      | **Not possible.** Its OpenID document has no token endpoint: it offers the implicit flow only. The app now says so, plainly, where it used to fail on an address that was not there.                                                                                       |

These were checked against each provider's own published document, with the requests the app sends before and after the changes that made the provider kits possible: Google's were identical in every case.

## If you want to use another provider

Make a confidential client of type "web", with the redirect address above, the three scopes, PKCE `S256`, and token authentication by `client_secret_post` (or `client_secret_basic` if that is all it offers). Then set the three `OIDC_` settings and add your own address to `OPERATOR_EMAILS`.

- **authentik**: an OAuth2/OpenID provider with a confidential client, a signing key, and the issuer `https://<host>/application/o/<slug>/`.
- **Zitadel**: a project with a Web application using the code flow and PKCE, and the user's email marked verified. Zitadel has a setting to put user information in the identity token; if it is off the app asks the userinfo endpoint instead, so either should work, but that has not been run.
