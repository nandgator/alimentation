---
title: What setting up sign-in costs
description: The money, time and effort of each way to sign people in, written for the administrator who has to choose one.
---

# What setting up sign-in costs

Alimentation never sees a password. Someone else, an OpenID Connect provider, vouches for a person's email, and you choose who. This page is for the technical administrator making that choice, so it puts a rough price on each: money, time and effort.

Read the figures as estimates. **Time** is for a technical person doing it for the first time, from nothing to one successful sign-in. **Money** is what the provider charges for what you need, and is a published price only where the last column says it was checked. Prices and rules change, so confirm anything that matters before you commit to it.

| Provider                | Money                                                                                                       | First-time time | Effort                                                                                                       | Works with the app             | How sure                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Google**              | Nothing to Google. No paid plan is needed to make a sign-in client.                                         | 20 to 40 min    | Low. A Cloud project, a consent screen, one web client.                                                      | Yes, always has.               | General knowledge. Google's help pages could not be reached when this was written; confirm them.       |
| **Microsoft (Entra)**   | Nothing for the app registration. You need a tenant; your organisation's, or a free one.                    | 30 to 60 min    | Medium. Two optional claims, one tenant address, a secret that expires.                                      | Only by choice, for one tenant | General knowledge, plus Microsoft's optional-claims reference for `xms_edov`.                          |
| **Apple**               | USD 99 a year for the Apple Developer Program; fee waiver for eligible nonprofits, schools and government.  | 3 to 6 hours    | High. A service identifier, a key, a verified domain, and a client secret you must regenerate on a schedule. | **No.** Not built.             | The price is from Apple's own page. The steps are general knowledge.                                   |
| **Meta (Facebook)**     | Free to register.                                                                                           | Not applicable  | Not applicable.                                                                                              | **No.** Cannot be.             | Its published OpenID document offers no code flow, which this app needs. Checked against the document. |
| **Authelia with LLDAP** | The software is free. You need somewhere to run it: a small server of your own, about USD 5 to 10 a month.  | Half a day      | Medium. A domain, https, a directory of people, backups, and updates when security fixes come out.           | Yes. Run and tested here.      | Run on a development machine. The hosting price is an estimate.                                        |
| **authentik**           | The software is free. Its documentation asks for a host with at least 2 CPU cores and 2 GB of RAM.          | Half a day      | Medium to high. More to learn and more to keep running than Authelia, in return for more features.           | Should. Not run here.          | The hardware line is from its documentation. The rest is an estimate.                                  |
| **Zitadel**             | The software is free to self-host. A hosted plan exists; check its current price.                           | Half a day      | Medium to high.                                                                                              | Should. Not run here.          | An estimate.                                                                                           |
| **Another hosted one**  | Many have a free tier for a small number of people. The terms change often, so check before you rely on it. | 30 to 60 min    | Low to medium.                                                                                               | Should, if it meets the list.  | An estimate.                                                                                           |

## Choosing

- **If your people already have Google accounts, use Google.** It costs nothing, it is the quickest, and it is the one this app has always been used with. If you are unsure, start here.
- **If your organisation lives in Microsoft 365, use Microsoft for that tenant.** It costs nothing, but it is the only choice here that asks you to trust a claim on purpose, and you must add two optional claims to the registration. [The steps are here.](/docs/self-hosting/sign-in-locally/#microsoft)
- **If you do not want a large company in the path, run Authelia with LLDAP.** The software costs nothing but you take on its upkeep: a server, a certificate, backups and updates. It suits an organisation that already has someone doing that.
- **Apple and Meta cannot be used, and you should not pay for either to use this app.** Apple would need building first, and Meta's sign-in is not the kind this app speaks.

## What it costs after the first day

Setting up is the small part. Plan for these.

- **Secrets expire.** A Microsoft client secret has a life you choose when you make it, up to two years, and sign-in stops on the day it runs out. Put the date in a calendar when you make it. Google's do not expire by default; check the console when you make one.
- **The redirect address is exact.** If the address of the app changes, change it in the provider as well, or sign-in breaks until you do.
- **Your own sign-in provider is a thing you run.** Self-hosting one means you now have a second service to update, back up and keep reachable, and if it is down nobody signs in. The app's own pages still load, and a signed-in session lasts until it expires.
- **Someone must be the operator.** Whichever provider you use, the first person to make kitchens signs in with an address listed in `OPERATOR_EMAILS`. That is a setting, not a cost, but it is the step people forget.

## What the app asks of any provider

The list is in [Try sign-in on your machine](/docs/self-hosting/sign-in-locally/#what-the-app-asks-of-a-provider). A provider that does all of it needs no code written for it, which is why a hosted service or a self-hosted one you have not seen listed here can very likely be used.
