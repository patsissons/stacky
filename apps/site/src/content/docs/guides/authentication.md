---
title: Sign-in and security
description: Local login, two-factor authentication, single sign-on (OIDC), API tokens and the activity log.
sidebar:
  order: 5
---

Stacky has one admin account, created on the first visit (or seeded with `STACKY_ADMIN_USER` and `STACKY_ADMIN_PASSWORD`). Sessions last 30 days. Repeated failed sign-ins are rate limited.

## Two-factor authentication

Under **Settings → Two-factor authentication**:

1. Confirm your password, then scan the QR code with any authenticator app (1Password, Bitwarden, Aegis, Google Authenticator...).
2. Store the backup codes somewhere safe. Each one works once if you lose your device.
3. Enter the 6-digit code to turn two-factor authentication on.

When you sign in, you can choose to trust the device for 30 days.

## Single sign-on (OIDC)

Stacky can sign you in through any OpenID Connect provider. Create a client in your provider with this redirect URI:

```
https://<your stacky URL>/api/auth/oauth2/callback/oidc
```

Then configure stacky:

```yaml
environment:
  STACKY_BASE_URL: https://stacky.example.com # needed so the redirect URI is right behind a proxy
  STACKY_OIDC_ISSUER: https://auth.example.com/application/o/stacky/
  STACKY_OIDC_CLIENT_ID: stacky
  STACKY_OIDC_CLIENT_SECRET: ${OIDC_SECRET}
  STACKY_OIDC_NAME: Authentik # button label
  # optional
  STACKY_OIDC_ALLOWED_GROUPS: homelab-admins # only these groups (from the `groups` claim) may sign in
  STACKY_OIDC_AUTO_REDIRECT: 'true' # skip the login form; /login?local=1 still shows it
```

| Provider  | Issuer example                                       | Notes                                                                      |
| --------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Authentik | `https://auth.example.com/application/o/<app-slug>/` | Add the `groups` scope mapping if you use `STACKY_OIDC_ALLOWED_GROUPS`     |
| Authelia  | `https://auth.example.com`                           | Add `groups` to the client's scopes and set `STACKY_OIDC_SCOPES`           |
| Pocket ID | `https://id.example.com`                             | Groups are sent in the `groups` claim when the `groups` scope is requested |
| Keycloak  | `https://kc.example.com/realms/<realm>`              | Add a group mapper to the client                                           |

To request groups, add the scope: `STACKY_OIDC_SCOPES: openid profile email groups`.

The local admin password keeps working alongside SSO, so you can't lock yourself out.

## API tokens

**Settings → API tokens** creates long-lived tokens for scripts and integrations. A token is shown only once; stacky stores just a hash of it.

```sh
curl -H "Authorization: Bearer stk_…" https://stacky.example.com/api/stacks
curl -X POST -H "Authorization: Bearer stk_…" https://stacky.example.com/api/stacks/media/actions/update
```

A token can do everything the admin can, except create or revoke tokens.

## Activity log

**Settings → Activity log** lists every change made through stacky: who made it (the admin, or `token:<name>`), the request, and whether it succeeded. Entries are kept for 90 days.

## Running behind an authenticating proxy

If a proxy such as Authelia or Authentik already handles authentication, you can set `STACKY_AUTH_DISABLED=true` to turn off stacky's own login. Only do this if nothing can reach stacky without going through the proxy. Stacky shows a permanent banner while auth is disabled.
