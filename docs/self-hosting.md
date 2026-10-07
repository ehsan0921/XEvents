# Self-host XEvents

Run your own Telegram event planner with your own bot, Cloudflare Worker and D1 database. The public repository contains placeholder configuration; it does not grant access to the hosted [XEvents bot](https://t.me/XEvents_bot).

The **complete application** runs on Cloudflare Workers: the Mini App, authenticated API, Telegram webhook, scheduled reminders and outgoing message delivery. `npm start` runs a separate, local polling bot with JSON-file storage. It does not serve the Mini App or run the Worker's scheduled tasks.

See [architecture and limitations](architecture.md) and the [security policy](../SECURITY.md) before hosting real guest data.

## Requirements

- Node.js 22 or newer and npm.
- Your own bot created through [BotFather](https://t.me/BotFather).
- A Cloudflare account with Workers and D1 for a hosted deployment.
- An HTTPS URL for the Mini App and webhook, normally supplied by your Worker deployment.

Use a separate development bot when testing. Telegram sends a bot's updates to one webhook or polling consumer at a time.

## Install and check the source

```sh
git clone https://github.com/ehsan0921/XEvents.git
cd XEvents
npm ci
npm test
npm run test:worker
```

`npm test` uses Node's test runner. `npm run test:worker` bundles the Worker with a Wrangler dry run, then exercises it in Miniflare with local D1 and mocked outbound Telegram requests. These checks do not deploy the app or send real Telegram messages.

## Run the Worker locally

Copy the local secret template:

```sh
cp .dev.vars.example .dev.vars
```

In PowerShell, `Copy-Item .dev.vars.example .dev.vars` is the equivalent command. Enter your development values in `.dev.vars`; the file is ignored by Git.

The checked-in `BOT_USERNAME` and `APP_URL` are placeholders. For bot-connected testing, set them to your development bot and HTTPS development app in your own Wrangler configuration; keep instance-specific values in an ignored config as described below. Local HTTP preview alone does not configure a usable Telegram launcher or webhook.

Apply all migrations to local D1, then start the development server:

```sh
npx wrangler d1 migrations apply xevents --local
npx wrangler dev
```

The checked-in database ID is a placeholder. Wrangler's default local development uses a local D1 database; `--local` migrations do not initialise your remote database. Keep the D1 binding named `DB` and the database name consistent with the commands. Local state persists under `.wrangler/` by default. See [Cloudflare's local D1 guide](https://developers.cloudflare.com/d1/best-practices/local-development/).

Open the address printed by Wrangler with `/app` appended, normally `http://localhost:8787/app`. A normal browser has no signed Telegram identity, so private data will show an authentication prompt. This is expected; do not bypass authentication for a preview. Use the automated tests for simulated authenticated requests, and a separate HTTPS development deployment for the complete Telegram flow.

Local scheduled tasks do not run automatically. If you need to exercise them, start `npx wrangler dev --test-scheduled`, then request `/cdn-cgi/local/scheduled` on the local server. This handler can configure your bot's menu and webhook and send queued messages, so use development credentials and a development `APP_URL`. See the [Wrangler development options](https://developers.cloudflare.com/workers/wrangler/commands/workers/).

## Configuration reference

| Setting | Where to configure it | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | `.dev.vars` locally; Worker secret when hosted | Your bot's BotFather token. |
| `TELEGRAM_WEBHOOK_SECRET` | `.dev.vars` locally; Worker secret when hosted | Private header used by `/setup` and Telegram webhook requests. Use a strong random value containing letters, numbers, `_` or `-`. |
| `SUPER_ADMIN_ID` | Optional local value or Worker secret | Your own numeric Telegram user ID. Blank or absent disables the super admin panel. It is checked against verified Telegram identity. |
| `BOT_USERNAME` | Wrangler `vars` | Your bot's username without `@`; it must match the token's bot. |
| `APP_URL` | Wrangler `vars` | Your complete HTTPS Mini App URL ending in `/app`, on the same origin as the Worker webhook. |
| `DB` | Wrangler D1 binding | Event, user, preference and delivery state. Keep the binding name unchanged. |
| `ASSETS` | Wrangler assets binding | Serves the files in `public/`; keep the binding and directory configuration. |
| `DATA_DIR` | `.env` for `npm start` only | Local polling-bot data directory; defaults to `./data`. It is not the Worker's database. |

`.env.example` is for the standalone polling process; `.dev.vars.example` is for local Worker development. Neither sample configures production. Worker secrets are stored separately in Cloudflare. Local `.dev.vars` takes precedence over `.env` in Wrangler development; see [Cloudflare's secret handling](https://developers.cloudflare.com/workers/configuration/secrets/).

## Configure your own hosted instance

### 1. Keep deployment values in an ignored config

Copy `wrangler.jsonc` to `wrangler.production.jsonc`. This filename is already ignored by Git. Keep the checked-in file generic, and use the private copy for your Worker name, database ID and hosting URL.

In the private copy, set:

- `name` to your own Worker name.
- `vars.BOT_USERNAME` to your bot's username without `@`.
- `vars.APP_URL` to your Worker's HTTPS URL followed by `/app`.
- The D1 `database_name` and `database_id` to your own database's values.

Preserve the existing Worker entry point, asset binding, migrations directory, compatibility settings and every-minute cron. Every command below that acts on the Worker uses this private config. The database name `xevents` is an example; replace it consistently if you choose another name.

### 2. Create and initialise D1

```sh
npx wrangler login
npx wrangler d1 create xevents --config wrangler.production.jsonc
```

Copy the returned database ID into the private config, then apply the migrations to that remote database:

```sh
npx wrangler d1 migrations apply xevents --remote --config wrangler.production.jsonc
```

Review the target database and migrations before confirming. All three files in `migrations/` are required. The `--remote` flag selects the hosted database; local migrations and test fixtures do not create its schema. See the [D1 command reference](https://developers.cloudflare.com/d1/wrangler-commands/).

### 3. Set Worker secrets

Use the interactive prompts; do not put secret values in command arguments, source files or screenshots:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.production.jsonc
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --config wrangler.production.jsonc
```

For an administrator panel, also set your own numeric Telegram user ID:

```sh
npx wrangler secret put SUPER_ADMIN_ID --config wrangler.production.jsonc
```

Leave this optional secret unset if you do not need an administrator. If Wrangler offers to create a new Worker while adding its first secret, confirm only after checking the Worker name. Secret updates are deployment operations; `.dev.vars` is not uploaded by the commands above.

### 4. Deploy

```sh
npm run deploy -- --config wrangler.production.jsonc
```

The `deploy` npm script is `wrangler deploy`; npm forwards the config argument to it. If the deployed origin differs from `APP_URL`, update the private config and redeploy before registering the webhook.

### 5. Register the Telegram webhook

Use an HTTP client to send this request to your own deployed Worker. Set the header privately in the client rather than including its real value in a command line or saved public request:

```http
POST https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/setup
X-Telegram-Bot-Api-Secret-Token: <your webhook secret>
```

No request body is required. The route verifies the header, checks that the bot token and configured username match, and registers `/telegram` as the webhook. A successful response includes `configured: true`; the response can also include your webhook URL, so keep it out of public logs or screenshots.

The scheduled task configures Telegram's **App** menu, payment-support commands and webhook update types, and processes reminders and message retries. The cron is declared as `* * * * *`. New cron configuration can take time to propagate; see [Cloudflare's cron documentation](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Open your bot in a private Telegram chat, press **Start**, then use **App** from its menu or inline launcher. These launchers supply the signed identity required by the Mini App. Each test guest should start the development bot before you expect private messages or uploads to reach them.

## Verify your deployment

With fictional events and a second Telegram account, check that you can create an event, share an invitation, respond, see the organiser's guest list and receive a notification. Check a private location before and after acceptance, and approval if enabled in ticket mode. If relevant, test an optional QR ticket, check-in notification and shared media with guest permissions both on and off.

Automated tests cover bot flows, authentication, permissions, D1 state and mocked payment updates. They do not verify real Telegram mobile rendering, provider limits, delivery to a particular device, payment collection or refunds. The current runtime uses Telegram's regular Bot API endpoints and has no configuration switch for Telegram's separate test-server API. A test-server payment setup therefore needs separate development changes; do not assume that a test token alone redirects requests there.

## Standalone polling bot

For bot-only development, copy `.env.example` to `.env`, set a development bot token, and run:

```sh
npm start
```

This process reads `TELEGRAM_BOT_TOKEN` and `DATA_DIR`, discovers the bot username from Telegram, and saves `events.json` under the chosen data directory. The sample `BOT_USERNAME` is not read by this entry point. Its `SUPER_ADMIN_ID` sample is for reference only; the polling process does not serve the Mini App administrator panel.

**Startup deletes that bot's webhook.** Running it with the hosted bot's token disconnects webhook delivery until the hosted webhook is restored. Use a separate bot and keep only one polling process per data directory. After an unexpected stop, confirm no process is still running before removing a stale `data/bot.lock`. Polling data and D1 are separate; there is no built-in synchronisation or import between them.

## Maintenance and troubleshooting

| Symptom | What to check |
| --- | --- |
| Mini App says to open it inside Telegram | Use the bot's **App** menu or inline launcher. Close and reopen an old session; signed authentication expires after an hour. |
| No events or database error | Confirm the Worker uses your intended `DB`, all migrations were applied with `--remote`, and the same bot token signs the Mini App identity. Local and remote D1 contain different data. |
| `/setup` returns 401 | Check the private header value against the deployed webhook secret. |
| `/setup` reports a username mismatch | Set `BOT_USERNAME` to the token's actual username without `@`, then redeploy. |
| App menu or reminders are missing | Check `APP_URL`, the every-minute cron and Worker logs. A new cron may still be propagating. Reminders need a scheduled event start and an eligible response. |
| Hosted bot stopped responding after local work | Stop the polling process and register the hosted webhook again. |
| Admin panel is absent | Set `SUPER_ADMIN_ID` on the correct Worker and reopen **Profile** using that Telegram account. Editing a sample file has no production effect. |
| A large file will not preview or download in the Mini App | Browser retrieval is limited to 20 MB by the application. Use **Send to Telegram**. Banner and profile-photo uploads accept JPG, PNG or WebP up to 5 MB. |
| Currency estimate is unavailable | Estimates depend on online providers and supported currencies. Stars checkout does not require an estimate. |
| Temporary busy or save error | Writes use a shared database lease. Retry after a moment; repeated failures warrant checking Worker logs and quotas. |

Use `npx wrangler tail --config wrangler.production.jsonc` to inspect your instance's logs, and redact guest information, identifiers and private links before sharing diagnostics. Protect database backups: they contain personal information and payment/refund records. Telegram-hosted media is not an independent backup, and deleting an event cannot remove files already delivered to someone else's chat.

There is no built-in event media count quota, but Telegram restrictions and Cloudflare database, execution and usage limits still apply. Free hosting and unlimited storage are not guaranteed. Larger communities should review the [architecture constraints](architecture.md#operational-constraints) and provider capacity before relying on the service.
