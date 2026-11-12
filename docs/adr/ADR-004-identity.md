# ADR-004: Identity behind an adapter

Status: Proposed (11-Nov-2026).

## Decision
- People sign in with Google Workspace (OIDC). The domain is enforced on the server after the provider returns the identity (`allowedEmail`), not trusted from the `hd` query parameter.
- The allowed domains are a list, `AUTH_ALLOWED_DOMAINS`, by default the three domains of the same Google Workspace organization: `axexo.com`, `emida.com` and `emida.net` (decided by Yamil on 11-Nov-2026; Kore has admitted the same three since 1-Jul-2026). The match is exact on the part after the last "@". `empowerretailers.com` is not in the list. A domain in the list does not grant access by itself: the second condition below still applies.
- `src/server/adapters/identity.ts` defines `IdentityProvider { startLogin, completeLogin }`. Staging implements it with Supabase Auth acting only as OIDC broker. The provider session is discarded right after the callback.
- CONTIGO keeps its own session: an opaque random token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 hash is stored. Sessions last 12 hours.
- A verified identity gets in only if an active user with that email already has a membership, or the email is listed in `BOOTSTRAP_ADMIN_EMAILS` (first admin of an environment).

## AWS implementation
Replace the adapter with Amazon Cognito (Google as federated IdP) or direct OIDC against Google. Nothing else changes: sessions, memberships and RLS do not depend on the provider.

## Open
- MFA is an IdP policy `[pending: Google Workspace admin]`.
- Deprovisioning by Google Directory sync (AUTHZ-09) is not built. Today: end the membership in Administration; sessions expire within 12 hours.
- Synthetic personas exist only outside production and are documented in the README.
