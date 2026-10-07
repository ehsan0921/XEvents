# Contributing to XEvents

Bug fixes, accessibility improvements, clearer documentation and focused feature proposals are welcome. XEvents is a JavaScript Telegram bot and Mini App running on Cloudflare Workers with D1. Start with the [architecture](docs/architecture.md) and [self-hosting guide](docs/self-hosting.md).

## Set up development

Use Node.js 22 or newer. Fork and clone the repository, then install the locked dependencies:

```sh
npm ci
npm test
npm run test:worker
```

For the local Worker, copy `.dev.vars.example` to `.dev.vars`, use your own development values, then run:

```sh
npx wrangler d1 migrations apply xevents --local
npx wrangler dev
```

Open `/app` on the local server for the interface. Private data still requires signed Telegram launch data; normal browser access correctly shows an authentication message. The [development guide](docs/self-hosting.md#run-the-worker-locally) explains local testing and complete Telegram testing.

`npm start` is a separate polling process that deletes its bot's webhook. Use a development bot rather than the token of a hosted service. Production credentials, guest databases and private deployment configurations are not needed to contribute.

## Report bugs and suggest features

Search existing issues first. For a bug, include what you expected, what happened, concise reproduction steps and the relevant Telegram client/browser and operating system. Screenshots help for interface problems; replace real names, phone numbers, private venues, links and payment information with fictional data.

For a feature, describe the organiser or guest problem and a concrete example of the desired flow. Keep broader changes open for discussion before investing in a large implementation.

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md), rather than posting exploit details or private data in an issue.

## Submit a pull request

Create a branch in your fork and keep the change focused. Explain the problem, resulting behaviour and how you checked it. Include before/after screenshots for visible changes and note any limitations that a reviewer needs to assess.

For code changes, run `npm test` and `npm run test:worker`. Add or update meaningful regression coverage when changing behaviour, especially authentication, event permissions, invitation claims, payments or check-in. For documentation-only changes, check links, paths, commands and Markdown rendering; a full runtime test run is not normally necessary.

The unit and Worker tests mock Telegram requests. They do not make real purchases or verify notification delivery and mobile rendering. Describe any manual checks separately, using a development bot and fictional events.

Follow the surrounding ES-module style and reuse existing helpers for permissions, invitation state and payment confirmation. Keep server authorization checks intact; a hidden frontend button is not an access control. Avoid unrelated formatting, generated build files and dependency changes unless the task needs them. There are no `lint`, `build` or `dev` npm scripts in the current package; use the documented commands above.

Before sharing a diff, check that it contains no `.env`, `.dev.vars`, local databases, exports, tokens, administrator IDs, private invitation links or instance-specific deployment values. Use the ignored `wrangler.production.jsonc` for your own deployment configuration. Keep examples and test fixtures fictional.

## Licence

Contributions are distributed under the project's [MIT licence](LICENSE). Keep the existing copyright and permission notice when redistributing the project.
