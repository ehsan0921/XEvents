# Contributor instructions

XEvents is an open-source Telegram bot and Mini App. Protect deployment secrets,
existing invitations, and users' private event data when making changes.

## Security and configuration

- Never commit real bot tokens, credentials, administrator IDs, private endpoints,
  production database or account identifiers, or event and user data.
- Keep deployment configuration and credentials outside tracked source. Examples,
  documentation, fixtures, and screenshots must use placeholders or fictional data.
- Configure administrator identity through the existing environment secret; never
  hard-code an administrator identity or grant privileges from client input.
- Do not print secrets or private identifiers in command output, logs, reports,
  errors, or commit messages. Errors shown to users must remain useful and safe.
- Enforce authorization and privacy on the server. Hiding a control in the Mini App
  does not authorize an API request or protect locations, tickets, or shared media.
- If a secret is exposed, stop its propagation and report the finding without
  reproducing the value. Removing it from the latest file does not clear history.

## Backward compatibility

- Preserve existing event schemas and invitation modes. Add compatible defaults or
  migrations when a field changes; do not reinterpret stored responses silently.
- Public event selection is a UI choice mapped to ticket mode and public visibility.
  Existing legacy events retain legacy mode when their visibility changes. Named
  invitations remain private. Do not store a new invitation mode just for this UI.
- Preserve invitation tokens, claim ownership, one-time link behavior, attendee
  rules, response deadlines, and the ability of the same guest to update an RSVP.
- Keep existing callback formats, deep links, and legacy command handlers working
  even when their visible menu entries change. Old Telegram messages remain usable.
- Preserve media references, ticket codes, check-in records, payment and refund
  audit records, request idempotency, and concurrency protections.
- Preserve owner and co-host boundaries and all guest privacy checks, including
  access to locations and invitation details after acceptance or approval.
- Do not alter payment terms, prices, or attendance rules around active payments
  without the existing validation and refund protections.

## Implementation and validation

- Read applicable repository instructions before editing. Prefix shell commands
  with `rtk` when the workspace requires it; keep these instructions portable.
- Make focused changes and preserve unrelated work. Use the project's existing
  APIs and helpers for permissions, invitations, payments, and state mutations.
- Test with fictional events, mocked Telegram calls, and local database fixtures.
  Never send real notifications, make real payments, or use production guest data
  as a test fixture.
- Maintain regression tests appropriate to the change and the project's required
  production checks. Invitation, visibility, or schema changes need coverage for existing
  events, legacy modes, privacy, and stored response preservation.
- Keep development deployments fast: automated test jobs run for PRs targeting
  `main` and for `main` pushes/manual runs, not for `dev`. Local tests during
  development are optional when useful; require the full regression and Worker
  checks before production promotion and deployment. Keep development builds,
  environment isolation validation and deployment health checks enabled.
- Run Worker integration and static-import checks before production promotion
  when changing Worker modules, bindings, API behavior, or asset imports.
  Include every new imported asset in
  deployment and verify that it can load.
- Check important Mini App flows on mobile when changing forms or navigation.
  Keep visible errors, keyboard access, and understandable button states working.

## Publishing and deployment

- Work on `dev` and verify the affected flows there before promoting to `main`.
  `main` deploys production; `dev` deploys the separate development Worker and D1.
  Keep all bot credentials, app URLs and database bindings isolated by environment.
- Keep code synchronization and database refresh separate. The user explicitly
  authorizes the manual production-to-dev database snapshot workflow to copy real
  business records into the private development D1. Replace development data,
  preserve its settings/whitelist, clear sessions and delivery/coordination state,
  and require the development snapshot access/payment/notification safeguards.
  Never merge code, deploy Workers, write production data or publish database
  exports as part of this database-only workflow. Automated tests still use
  fictional local fixtures, never actual production snapshots.
- Run deployment automation from one canonical repository; mirrors run checks
  only. Store private configuration in GitHub environment secrets and ignored files.

- Inspect the final diff and stage explicit intended files. Keep local credentials,
  generated private data, deployment logs, and machine-specific helpers untracked.
- Scan staged content and repository history for secrets before a public push.
  Verify sample configuration remains placeholder-only. Do not rewrite shared
  history or force-push as a routine cleanup step.
- Deploy only to the target authorized by the user. Preserve deployed variables
  and secrets, using the deployment tool's keep-vars option where applicable.
  Do not replace production bindings with sample configuration.
- Respect authorization already given in the session; do not introduce blanket
  approval requirements. Report completed checks and any remaining limitations
  without exposing private deployment details.
