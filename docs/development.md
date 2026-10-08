# Development and production

XEvents uses one application with two deployment branches. Work on `dev`, test with a separate Telegram bot and Cloudflare D1 database, then promote the reviewed code to `main`. Production invitations, payments and guest data stay in the production database.

| Branch | Purpose | Cloudflare target | Private local configuration |
| --- | --- | --- | --- |
| `main` | Production releases | Production Worker and production D1 | `wrangler.production.jsonc` |
| `dev` | Development and testing | Development Worker and `xevents-dev` D1 | `wrangler.development.jsonc` |

The development bot runs the same bot, Mini App and API code as production. Telegram verifies Mini App launches using that bot's own token. A person can use the same Telegram account in both bots, but their events, profiles, invitations and uploads are stored separately. Start the development bot before testing private messages or uploads.

## Day-to-day workflow

1. Switch to `dev` and make a focused change. Short-lived feature branches can merge into `dev` when useful.
2. Push `dev`, then deploy it explicitly using the private development configuration. GitHub does not deploy either environment. Dependency installation, configuration isolation, migrations and the service health check still apply.
3. Run local tests when useful while developing; they are not required before every development push. Use fictional events and mocked payments in automated tests.
4. Test the relevant Telegram and Mini App flows through the development bot.
5. Open a pull request from `dev` to `main`. The **Production tests** workflow runs the required **Regression and Worker checks** job: `npm test` and `npm run test:worker` on every PR targeting `main`, and again on `main` pushes or manual runs from `main`. Merge after those checks and development testing pass. Deploy production explicitly only after checks pass for that exact commit, using production configuration and compatible production migrations.
6. After a production-only fix, merge `main` back into `dev` in a normal checkout. Resolve conflicts and review the result before pushing.

Keep changes small so that `main` remains releasable. Do not treat development database contents as something to promote: promotion moves code and migrations, not test events or users.

Development pushes and PRs targeting `dev` do not trigger automated test jobs. Run manual production tests from `main`. Production checks include authentication, access and permission boundaries, invitation compatibility, payment/refund handling and local Worker/D1 integration. A failed, skipped or cancelled production check must be resolved before production deployment.

## GitHub Actions

There are two workflows:

- **Production tests** validates pull requests targeting `main`, pushes to `main`, and manual runs from `main`. It requires no Cloudflare secrets and does not deploy.
- **Copy production database to dev** is a manual database-only operation from `main`. It does not synchronize code or deploy Workers.

The canonical database-refresh repository is [ehsan0921/Telegram-event-management](https://github.com/ehsan0921/Telegram-event-management). Set its repository variable `XEVENTS_DATABASE_REFRESH_ENABLED` to `true`. The [ehsan0921/XEvents](https://github.com/ehsan0921/XEvents) mirror runs production checks only; leave its database-refresh variable unset or `false`. A database action attempted in a disabled mirror reports an error directing you to the canonical repository instead of silently skipping.

In the canonical repository, create the GitHub environment `development-refresh`, restrict it to `main`, and configure these four **environment secrets**:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A dedicated Cloudflare API token permitting production D1 export and development D1 import. |
| `CLOUDFLARE_ACCOUNT_ID` | The private Cloudflare account identifier. |
| `WRANGLER_CONFIG_JSON` | The complete private development Wrangler configuration as valid JSON. |
| `PRODUCTION_CONFIG_JSON` | The complete private production configuration as valid JSON, used for read-only export and to reject resource collisions. |

The two configurations must use different Worker names, D1 identifiers, bot usernames and app URLs. `PRODUCTION_CONFIG_JSON` must match the actual production target. Keep private configuration in GitHub secrets, never repository variables, checked-in files or workflow text. The action checks required secrets before installing database tools and reports missing secret names without their values.

Branch policies should keep `main` changes going through pull requests and the successful **Regression and Worker checks** job. The database-copy workflow and its environment are restricted to `main`.

See [GitHub environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## Explicit deployments

Deployment is separate from GitHub Actions and database refresh. Install dependencies with `npm ci`, then use the existing CLI helper from a private authenticated shell:

```sh
node scripts/deploy-environment.mjs
```

Supply `DEPLOY_ENVIRONMENT=development` and `GH_REF_NAME=dev` for development, or `DEPLOY_ENVIRONMENT=production` and `GH_REF_NAME=main` for production. Load `WRANGLER_CONFIG_JSON`, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` privately; development also requires `PRODUCTION_CONFIG_JSON` to validate resource isolation. Do not put secret values in shell history or committed scripts.

The helper validates the environment, applies its migrations, builds and deploys with `--keep-vars`, then checks the service health endpoint. Production requires successful regression and Worker checks for the selected commit before running this command. The temporary private configuration must never become a build artifact or committed file. Keep existing production bindings and secrets intact, and avoid deploying development while its database refresh is running.

## Separate development configuration

Keep the real development configuration in an ignored local file, such as `wrangler.development.jsonc`. The following values are examples and placeholders:

```json
{
  "name": "YOUR_DEVELOPMENT_WORKER",
  "main": "src/worker.js",
  "compatibility_date": "2026-10-05",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": true,
  "preview_urls": false,
  "vars": {
    "BOT_USERNAME": "YOUR_DEVELOPMENT_BOT_USERNAME",
    "APP_URL": "https://YOUR_DEVELOPMENT_WORKER.YOUR_SUBDOMAIN.workers.dev/app",
    "TEST_WHITELIST_ENABLED": "false"
  },
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": true
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "xevents-dev",
    "database_id": "00000000-0000-0000-0000-000000000000",
    "migrations_dir": "migrations"
  }],
  "triggers": {"crons": []},
  "observability": {"enabled": true, "head_sampling_rate": 1}
}
```

Replace placeholders privately. Keep the binding names `DB` and `ASSETS`, the Worker entry point, public assets and migrations directory. The development D1 identifier and Worker name must differ from production. A development deployment must never receive production bot credentials or production database bindings.

Leave development cron triggers empty until the development bot is ready. Scheduled tasks can register a webhook and App menu, deliver queued messages and process reminders. Once the correct development bot is configured, enable the normal `* * * * *` schedule in the private development configuration to test those features.

## Connect the development bot

Create a separate bot with [BotFather](https://t.me/BotFather). Supply its token only for the development environment when it is available. Production continues using its current bot.

Store these secrets on the **development Cloudflare Worker**, using private interactive prompts or the Cloudflare dashboard:

- `TELEGRAM_BOT_TOKEN`: the development bot's token.
- `TELEGRAM_WEBHOOK_SECRET`: a new random secret for the development webhook.
- `SUPER_ADMIN_ID`: your administrator Telegram identity, if needed.
- `WHITELIST_USER_IDS`: optional initial allowed Telegram IDs for development, separated by commas or whitespace. Leave it blank to permit everyone.

These bot secrets do not belong in GitHub source or `WRANGLER_CONFIG_JSON`, and GitHub Actions does not need copies of them. Set `vars.BOT_USERNAME` to the development bot and `vars.APP_URL` to the development Mini App URL. The [self-hosting guide](self-hosting.md#3-set-worker-secrets) explains interactive secret setup and webhook registration.

Do not connect production's bot to the development Worker. Telegram uses a single webhook per bot, so doing that would redirect production updates. A separate bot is also necessary for authentication and media isolation: Telegram [`file_id` values are specific to each bot](https://core.telegram.org/bots/api#sending-files).

Stars payments use Telegram's real Bot API endpoints in the current application. A separate regular bot does not create a payment sandbox. Keep payment/refund verification mocked unless deliberately performing a controlled real transaction; never reuse production charge IDs or payment records in development.

## Restrict development access

Set `vars.TEST_WHITELIST_ENABLED` to `"true"` in the private development configuration to enable the test whitelist. The deployment helper sets `APP_ENV` to `development` and defaults this flag to `"false"` when omitted. Production always ignores the whitelist, and the deployment helper writes `"false"` for production even if its input enables the flag. For local testing, set `APP_ENV=development` and `TEST_WHITELIST_ENABLED=true` in the ignored `.dev.vars` file.

An empty whitelist permits everyone. Once it contains IDs, the development bot and authenticated Mini App APIs allow only those users and the superadmin configured by the `SUPER_ADMIN_ID` Worker secret. The superadmin always retains access so they can manage the list.

Send these commands to the development bot as the configured superadmin:

| Command | Effect |
| --- | --- |
| `/whitelist` | Show the current access setting and allowed IDs. |
| `/whitelist add ID...` | Add one or more numeric Telegram user IDs. |
| `/whitelist remove ID...` | Remove one or more IDs. |
| `/whitelist clear` | Empty the list and permit everyone. |

Keep real IDs in private Worker secrets or bot commands. `WHITELIST_USER_IDS` supplies the initial list and is never serialized into generated deployment configuration. The first command that changes the list saves an override in that environment's D1 database; subsequent requests and commands use that override instead of the secret seed. `/whitelist clear` saves an empty override, so it keeps access open even if the seed secret still contains IDs. Development and production use separate D1 databases, so these settings do not cross environments.

Removing the final tester also opens access to everyone; every change confirms whether access is restricted or open. Invalid configuration restricts access until the superadmin resets it. Payment and refund confirmations already issued by Telegram are still recorded after a tester is removed. Existing queued notifications are preserved.

In the development Mini App, open **Profile → Super admin → Dev access** to turn the whitelist on or off and add or remove numeric Telegram user IDs. The panel warns before enabling restrictions or removing the last allowed user. The superadmin always retains access. Turning it off keeps the saved IDs and permits everyone; turning it on restricts access when the list contains IDs. An empty ordinary whitelist still permits everyone. These changes apply immediately to the development bot and Mini App and survive redeployment. The `TEST_WHITELIST_ENABLED` variable is the initial default; the saved panel setting takes precedence. Production does not expose these controls or honor the development setting.

When development contains a production snapshot, its protection takes priority: the panel cannot turn access off, and removing the last tester leaves admin-only access. Database refresh retains the saved switch and whitelist together with the other development settings.

This restriction applies to the Cloudflare Worker, including its webhook and Mini App APIs. Use `wrangler dev` for local access-control testing; the standalone `npm start` polling process does not enforce this hosted feature. The whitelist command is advertised only in the configured superadmin's private chat.

## Copy production data to dev

In [ehsan0921/Telegram-event-management](https://github.com/ehsan0921/Telegram-event-management/actions/workflows/copy-production-db-to-dev.yml), open **Actions → Copy production database to dev → Run workflow**, select `main`, and run it whenever you need the latest production records in development. This replaces the existing development database contents. It does not merge either branch, deploy a Worker, change bot credentials, or write to production.

Enable this action only in the canonical repository by setting the repository variable `XEVENTS_DATABASE_REFRESH_ENABLED=true`. Leave it unset or `false` in mirrors. The `development-refresh` environment needs all four secrets listed above, including its own `CLOUDFLARE_API_TOKEN` with D1 export and import access. A disabled repository or missing secret produces an actionable failure before database operations; it does not silently skip the copy.

The action exports production, prepares the snapshot privately, and imports one replacement SQL file into the verified development D1. It copies events, users, profiles, guest responses, invitation links, ticket/check-in records, payment audits and media references. Development settings, including the test whitelist, are retained; production settings are not copied. Sessions, queued deliveries, processed-update markers and coordination locks are cleared. Already-applied migrations are preserved, and pending migrations from the current `dev` checkout are applied offline before import. An incompatible migration set stops the refresh before writing development data.

The development Worker must already include the database-refresh safeguards; the action checks its health capability before exporting. A copied database is restricted to the superadmin and explicitly allowed testers, even if the normal whitelist switch is disabled. An empty whitelist means **admin only** for a production snapshot; `/whitelist clear` cannot expose it to everyone. Add testers with `/whitelist add ID...` as usual. Copied reminders are paused, outbound messages are limited to these permitted accounts, and Stars invoices, checkout and refunds are disabled while the snapshot marker is present. Stored financial audit records remain intact.

Telegram media references are copied, but their `file_id` values belong to the production bot. Some existing images or files will need to be uploaded again through the development bot. Never use the production bot token to work around this isolation.

Exports and prepared SQL files are temporary, private files deleted after the run. They are never printed or uploaded as artifacts. D1 export can briefly block production database requests; import can briefly block development requests. A failed D1 file import rolls back the replacement. Database-copy runs share a concurrency group so copies cannot overlap. Keep explicit development deployments separate from an active refresh. See Cloudflare's [D1 import and export guide](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Automated tests continue to use fictional local fixtures and mocked Telegram calls. Production snapshots are private operational data, never test fixtures or public artifacts.

## Before promoting a change

- Verify that development uses its own bot, Worker and D1 before testing.
- Run the project's regression tests and Worker integration checks. Include compatibility coverage for existing invitation modes and stored records when those paths change.
- Check the affected Mini App flow on a mobile Telegram client, including errors and permission boundaries.
- Use compatible migrations and preserve active invitations, media references, ticket/check-in state and payment audit records in production.
- Review the pull request diff and keep all private configuration, credentials and data out of commits and workflow logs.

Follow [AGENTS.md](../AGENTS.md) and the [security policy](../SECURITY.md) for every environment.
