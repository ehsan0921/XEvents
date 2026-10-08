# Development and production

XEvents uses one application with two deployment branches. Work on `dev`, test with a separate Telegram bot and Cloudflare D1 database, then promote the reviewed code to `main`. Production invitations, payments and guest data stay in the production database.

| Branch | Purpose | Cloudflare target | GitHub environment |
| --- | --- | --- | --- |
| `main` | Production releases | Production Worker and production D1 | `production` |
| `dev` | Development and testing | Development Worker and `xevents-dev` D1 | `development` |

The development bot runs the same bot, Mini App and API code as production. Telegram verifies Mini App launches using that bot's own token. A person can use the same Telegram account in both bots, but their events, profiles, invitations and uploads are stored separately. Start the development bot before testing private messages or uploads.

## Day-to-day workflow

1. Switch to `dev` and make a focused change. Short-lived feature branches can merge into `dev` when useful.
2. Run `npm test` and `npm run test:worker`. Use fictional events and mocked payments in automated tests.
3. Push `dev`. When deployment is enabled and its credentials are configured, GitHub checks and deploys the development environment.
4. Test the relevant Telegram and Mini App flows through the development bot.
5. Open a pull request from `dev` to `main`. Merge after the checks and development testing pass. The `main` deployment uses production configuration and applies compatible production migrations.
6. After a production-only fix, run **Sync production code to development** to bring `main` changes back into `dev`.

Keep changes small so that `main` remains releasable. Do not treat development database contents as something to promote: promotion moves code and migrations, not test events or users.

## Enable GitHub deployment

The canonical deployment repository is [ehsan0921/XEvents](https://github.com/ehsan0921/XEvents). Keep mirrored repositories in checks-only mode so they cannot race to deploy the same Worker or run its migrations twice.

In the canonical repository, set the GitHub Actions repository variable `XEVENTS_DEPLOY_ENABLED` to `true` once Cloudflare credentials and both environment configurations are ready. Leave it unset or `false` in mirrors. Without the Cloudflare token and environment configuration, checks can run but hosted deployment is not ready.

Create GitHub environments named `production` and `development`. Configure these **environment secrets** separately for each:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with the permissions needed to deploy the intended Worker and manage its D1 migrations. Use a dedicated, suitably scoped token. |
| `CLOUDFLARE_ACCOUNT_ID` | The private Cloudflare account identifier for that environment. |
| `WRANGLER_CONFIG_JSON` | The complete private Wrangler configuration for that environment, as valid JSON. Use different Worker names, D1 IDs, bot usernames and app URLs. |
| `PRODUCTION_CONFIG_JSON` | Development only: the private production configuration used to reject production resource collisions. It is a workflow reference, never the development Worker's runtime configuration. |

`PRODUCTION_CONFIG_JSON` must match the actual production target. Also create the `development-refresh` environment with the same four secrets as development; restrict this environment to `main`. It is used only for the optional schema-copy job. Production needs only the first three secrets. Keep private configuration in GitHub secrets, never repository variables, checked-in files or workflow text.

The deployment helper, `scripts/deploy-environment.mjs`, applies migrations to the selected environment and deploys with `--keep-vars`. The private configuration is materialized for that run and must not become a build artifact or committed file. Keep existing production bindings and secrets intact.

Branch policies should keep `main` changes going through pull requests and successful checks. Restrict the production environment to `main` and development deployment to `dev`; allow the guarded refresh job from `main` to target development. Workflow branch checks also enforce their intended targets.

See [GitHub environment secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets) and [Cloudflare API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

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
    "APP_URL": "https://YOUR_DEVELOPMENT_WORKER.YOUR_SUBDOMAIN.workers.dev/app"
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

These bot secrets do not belong in GitHub source or `WRANGLER_CONFIG_JSON`, and the deployment workflow does not need copies of them in GitHub. Set `vars.BOT_USERNAME` to the development bot and `vars.APP_URL` to the development Mini App URL. The [self-hosting guide](self-hosting.md#3-set-worker-secrets) explains interactive secret setup and webhook registration.

Do not connect production's bot to the development Worker. Telegram uses a single webhook per bot, so doing that would redirect production updates. A separate bot is also necessary for authentication and media isolation: Telegram [`file_id` values are specific to each bot](https://core.telegram.org/bots/api#sending-files).

Stars payments use Telegram's real Bot API endpoints in the current application. A separate regular bot does not create a payment sandbox. Keep payment/refund verification mocked unless deliberately performing a controlled real transaction; never reuse production charge IDs or payment records in development.

## Sync production to dev

Run **Sync production code to development** manually from GitHub Actions on `main`. It merges production code into `dev` without resetting the branch or force-pushing. It preserves development work and stops if there is a merge conflict. Resolve that conflict in a normal checkout and push the reviewed result. After the merge, it explicitly starts development checks because a push using GitHub's workflow token does not start another push workflow.

The `copy_database_schema` input defaults to `false`. With that default, the workflow syncs code only and leaves the development database unchanged.

Select `copy_database_schema` only when the development database is empty and you want to initialize it from production's schema. `scripts/refresh-development.mjs` verifies the separate targets and refuses a nonempty development database, preserving existing test data. It exports **schema only**, imports it into development, and applies reviewed `main` migrations; the subsequent development deployment applies any additional `dev` migrations. Schema export can briefly block production database requests, so use it deliberately. Cloudflare documents the supported [D1 schema export and import](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

Only schema and applied migration filenames are transferred, so already-applied schema changes are not replayed. This workflow never copies production users, events, invitations, sessions, payment or refund records, queued notifications, reminders, configuration rows or media references. It does not promote development data to production. Create fictional test events in the development bot after initialization. A production database backup is private operational data and must never be uploaded as a public workflow artifact or committed as a test fixture.

## Before promoting a change

- Verify that development uses its own bot, Worker and D1 before testing.
- Run the project's regression tests and Worker integration checks. Include compatibility coverage for existing invitation modes and stored records when those paths change.
- Check the affected Mini App flow on a mobile Telegram client, including errors and permission boundaries.
- Use compatible migrations and preserve active invitations, media references, ticket/check-in state and payment audit records in production.
- Review the pull request diff and keep all private configuration, credentials and data out of commits and workflow logs.

Follow [AGENTS.md](../AGENTS.md) and the [security policy](../SECURITY.md) for every environment.
