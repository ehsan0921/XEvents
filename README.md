# XEvents — Free Open Source Event Management for Telegram

**Create events, share invitations, collect RSVPs and organise event photos in Telegram.** XEvents is a free, MIT-licensed event management project with a mobile Telegram Mini App for meetups, parties and community activities.

**[Try XEvents on Telegram](https://t.me/XEvents_bot)** · [Features](#event-management-features) · [Self-hosting](#self-host-your-own-telegram-event-planner) · [MIT licence](LICENSE)

## Free event planning for communities

Organising a gathering should be simple: create an event, send a link and see who is coming. XEvents brings invitations, attendance responses, local times, reminders and shared media into the messaging app your community already uses.

Built for friends, clubs, community organisers and volunteer groups, XEvents provides a free event planner and an open source RSVP system. Anyone can use, modify and self-host the source under MIT, including for commercial use.

## Event management features

| Feature | What you can do |
| --- | --- |
| Event invitations and RSVPs | Share invitation links; guests accept, decline, choose tentative or respond later. |
| Telegram Mini App | Create and edit events with mobile date and time pickers. |
| Local timezones | Save your timezone and view times locally, with daylight-saving validation. |
| Flexible schedules | Set a start, duration or finish time, and a response deadline. |
| Group attendance | Organisers can ask accepted guests how many people are attending, including themselves. Otherwise each response counts as one person. |
| Guest information | Collect names, optional phone numbers, comments and custom question answers. |
| Organiser approval | Review acceptance requests before releasing private location and invitation details. |
| Guest privacy | Choose whether guests can see the guest list, upload media or browse shared media. |
| Event reminders | Personal and default reminders, including 2, 3 or 4 hours before the event. |
| Event banners | Add an image to invitations and the Mini App. |
| Shared event media | Collect photos, videos and files; browse, save or send them to Telegram. |
| Upload links and QR codes | Optionally allow media contributions without an RSVP. |
| Public event discovery | Explore public events in your saved timezone; keep other events private. |
| Event management | View upcoming and past events, edit, share, cancel or delete events. |
| Administrator dashboard | A separately configured administrator can review all events and users. |

## How to use XEvents

1. Open **[@XEvents_bot](https://t.me/XEvents_bot)** and press **Start**.
2. Choose **Open app**, set your timezone and create an event.
3. Add the schedule, banner, guest permissions and any custom questions.
4. Share the invitation link with your guests.
5. Review responses in **My events** and approve guests when required.

Guests can change their response before the deadline. **Later** keeps invitations in the pending list. Organisers do not RSVP to their own events.

## Free event media storage: how it works

XEvents does not impose a built-in event media count quota. Telegram hosts uploaded photos, videos and files; the application stores file references and event metadata. This avoids maintaining a separate application media storage bucket.

**Unlimited free storage is not guaranteed.** Telegram restrictions, Cloudflare database and execution quotas, and provider policies still apply. Free tiers may suit small communities; larger deployments may need paid capacity. Telegram-hosted media is not an independent backup. Deleting an event cannot remove copies already delivered to someone’s chat.

Review the [Telegram Bot API](https://core.telegram.org/bots/api) and [Cloudflare platform limits](https://developers.cloudflare.com/workers/platform/limits/) before planning a large deployment.

## Self-host your own Telegram event planner

### Requirements

- Node.js 22 or newer and npm.
- Your own Telegram bot from [BotFather](https://t.me/BotFather).
- A Cloudflare account for Workers and D1.

### Install and verify

```sh
git clone https://github.com/ehsan0921/XEvents.git
cd XEvents
npm ci
npm test
npm run test:worker
```

Tests use mocked Telegram requests and local storage, without sending real bot messages.

### Configure and deploy

```sh
npx wrangler login
npx wrangler d1 create xevents
```

Update `wrangler.jsonc` with the returned database ID, your Worker name, your bot username without `@`, and your deployed HTTPS Mini App URL ending in `/app`. Checked-in values are placeholders and provide no access to the hosted XEvents service.

Set credentials through the interactive secret prompts:

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Choose a strong random webhook secret using letters, numbers, underscores or hyphens. To enable the administrator dashboard, set your numeric Telegram user ID as a separate secret:

```sh
npx wrangler secret put SUPER_ADMIN_ID
```

Administrator access is disabled when this secret is absent. Requests are checked against Telegram’s verified identity, not a username or a client-provided role.

```sh
npx wrangler d1 migrations apply xevents --remote
npm run deploy
```

Register the webhook with an HTTPS `POST` to your Worker’s `/setup` route, using the `X-Telegram-Bot-Api-Secret-Token` header with your webhook secret. Keep that header private. The route verifies bot identity and configures the webhook and commands. The app lives at `/app`; its bot menu is configured by the scheduled task.

### Local bot development

Copy `.env.example` to `.env`, set your own token and bot username, then run `npm start`. The local bot uses long polling and stores data in `data/`. Startup removes its webhook, so use a separate development bot. The Cloudflare deployment provides the hosted Mini App and scheduled reminders.

## Security and privacy

Production credentials, deployment configuration, databases and guest data are excluded from this public repository. Never commit tokens, webhook secrets, database exports or private user information. See [SECURITY.md](SECURITY.md).

The Mini App verifies signed Telegram authentication data. Server checks enforce ownership, guest permissions and administrator access. Guest phone numbers and custom answers are private to the organiser and configured administrator. Other guests can see responses only when the organiser enables the guest list.

The host controls the database and must protect personal information and backups. Public event listings expose titles, descriptions, banners and schedules; choose private visibility for sensitive gatherings.

## Architecture and limitations

- **Telegram bot:** button-driven invitations, RSVP conversations, reminders and uploads.
- **Telegram Mini App:** event creation, timezone preferences, media gallery and discovery.
- **Cloudflare Workers:** authenticated API, webhook and scheduled processing.
- **Cloudflare D1:** event metadata, responses, preferences and durable outgoing messages.
- **Telegram:** media hosting through reusable file IDs.

The implementation targets small communities. It loads event records during processing and serialises writes; larger deployments should improve queries and capacity planning. Delivery is best effort, and retries can occasionally duplicate messages. People who never open an invitation cannot be listed or contacted.

Invitation tickets confirm attendance. Payments, calendar synchronisation and ticket scanning are not implemented.

## Frequently asked questions

### Is XEvents a free event management tool?

Yes. The source is free under MIT, and you can try the linked Telegram bot. Self-hosting costs depend on usage and provider pricing; the licence does not promise free hosting forever.

### Can I send event invitations without a separate RSVP website?

Yes. Guests open a Telegram invitation link and respond inside Telegram. The Mini App offers a convenient mobile interface.

### Can people upload event photos without accepting an invitation?

Yes, when the organiser enables the separate public media upload link. It opens a media-only flow. Browsing remains a separate permission.

### Can I use XEvents for private events?

Yes. Private events are absent from Explore. Organisers can restrict guest lists, shared media and locations, or require approval.

### Can I modify XEvents or use it commercially?

Yes. MIT permits use, modification, distribution and commercial use, subject to retaining its copyright and permission notice.

## Contributing

Bug reports, accessibility improvements, translations and focused pull requests are welcome. Run `npm test` and `npm run test:worker` before submitting code. Use fictional users and events in tests and examples.

## Licence

Copyright © 2026 XEvents contributors. Released under the [MIT licence](LICENSE).

**[Plan your next event on Telegram with XEvents](https://t.me/XEvents_bot).**

