# Security

Self-host XEvents with your own bot and infrastructure. Public source does not grant access to the hosted XEvents service. Deployment instructions are in the [self-hosting guide](docs/self-hosting.md); implementation boundaries are in the [architecture guide](docs/architecture.md).

## Report a vulnerability privately

If the repository's **Security** tab offers **Report a vulnerability**, use that private reporting flow. Availability depends on the repository's GitHub settings. If no private reporting option is offered, open an issue asking the maintainer for a private contact channel, without publishing the vulnerability, an exploit, credentials or guest data. Do not assume an email address or a response deadline that is not published here.

In the private report, include affected code or a commit, expected versus actual behaviour, and minimal reproduction steps using fictional accounts and events. Redact tokens, signed Telegram authentication data, phone numbers, payment receipts and private invitation links. Coordinate disclosure with the maintainer so a fix can be reviewed before exploit details become public.

## Protect credentials and deployment data

Keep bot tokens and webhook secrets server-side. Configure an optional administrator through the `SUPER_ADMIN_ID` Worker secret; access is disabled unless it contains a valid numeric ID matching verified Telegram identity. A Telegram username or client-provided role does not confer administrator access. Keep your administrator ID and instance-specific deployment metadata private as well.

Never include credentials or signed Mini App launch data in frontend code, URLs, logs, screenshots, issues or commits. Use interactive `wrangler secret put` prompts for deployed secrets. `.env`, `.dev.vars`, `data/`, `.wrangler/` and `wrangler.production.jsonc` are ignored; verify your diff before sharing it, because `.gitignore` does not remove already tracked files or protect files outside those patterns.

Use a separate development bot and database. The standalone `npm start` process deletes its bot's webhook on startup, which interrupts a hosted instance if the same token is used. Keep database exports, provider credentials, private configuration and backups outside public repositories.

## Understand who can see guest data

Event records can contain guest names, Telegram identifiers, responses, group sizes, optional phone numbers/comments and payment or check-in state. Phone collection and comments are opt-in when creating current events. Older records may also contain legacy answers. The database operator can access stored records and must protect them and their backups.

An event owner and their trusted co-host can access guest information needed to manage the event, including contact details provided by guests. The configured super administrator has an overview of events and users. Guest-list visibility does not publish guest phone numbers to other guests. Other permitted guests can see response information and comments when the organiser enables that list.

Invite a co-host only through a private channel: the first valid account to claim an unused co-host link receives management access. The owner can revoke access, but cannot retract information the co-host already copied. Payment control, co-host access, cancellation and deletion remain with the event owner.

Review event visibility, guest-list permissions, media permissions and location restrictions before sharing an invitation. Named invitations are private; public listings expose the event's title, description, schedule, price and banner to Mini App users. Put sensitive joining instructions in the restricted invitation details rather than the public description or custom invitation message.

Optional one-time invitation links bind to the first completed response, not the first person who opens them; **Respond later** does not consume an unused link. A link identifies an invitation, not a person's real-world identity. Reusable invitation and media upload links may be forwarded. Check-in QR codes and manual ticket codes should also be treated as private ticket information.

## Media, payments and retention

Telegram hosts shared files; the application stores file references and metadata. XEvents checks permissions before serving files through the Worker. Telegram-hosted media is not an independent backup, and removing an event or revoking access cannot remove copies already downloaded or delivered to another chat.

Tickets and private joining details are released only when the required response, approval and payment conditions are met. A manual payment report is not proof of receipt: the owner must verify it with their bank or provider. Stars confirmation comes from Telegram payment updates. Keep payment and refund records safe; deleting an event preserves records needed for support and does not erase all stored user history.

## If something is exposed

Revoke an exposed bot token through BotFather immediately and replace the deployed secret. For an exposed webhook secret, set a new secret and register the webhook again. Revoke an exposed co-host invitation or active co-host as appropriate; disable or replace affected invitation/upload links where the available controls permit it. Review access and notify affected people through an appropriate private channel.

Removing a value from the latest file does not remove it from Git history, forks, clones or cached views. Rotate credentials first, then arrange any required history cleanup and hosting-provider cache removal. Do not paste the exposed values into a public cleanup request.
