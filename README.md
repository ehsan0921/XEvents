# XEvents — Free Open Source Event Management for Telegram

**Create events, share invitations, collect RSVPs and organise event photos in Telegram.** XEvents is a free, MIT-licensed event management project with a mobile Telegram Mini App for meetups, parties and community activities.

**[Try XEvents on Telegram](https://t.me/XEvents_bot)** · [Features](#event-management-features) · [Self-hosting](#self-host-your-own-telegram-event-planner) · [MIT licence](LICENSE)

## Free event planning for communities

Organising a gathering should be simple: create an event, send a link and see who is coming. XEvents brings invitations, attendance responses, local times, reminders and shared media into the messaging app your community already uses.

Built for sports clubs, friends, community organisers and volunteer groups, XEvents provides a free event planner and an open source RSVP system. Anyone can use, modify and self-host the source under MIT, including for commercial use.

## Event management features

| Feature | What you can do |
| --- | --- |
| Ticket booking links | Share one event link. Guests enter their name and get a ticket or request organiser approval, without RSVP options. |
| Named invitations and RSVPs | Enter a guest list and share an individual link for each name. Guests accept, decline, choose tentative or respond later without entering their name again. |
| Telegram Mini App | Create and edit events with mobile date and time pickers. |
| Local timezones | Save your timezone and view times locally, with daylight-saving validation. |
| Flexible schedules | Set a start, duration or finish time, and a response deadline. |
| Group attendance | Choose 1–5 people with buttons, or tap More for 6–10. New responses allow a maximum of 10 people per ticket. Otherwise each response counts as one person. |
| Organiser guest list | View accepted response and people totals, distinguish confirmed attendance from approval/payment requests, and filter accepted, pending, maybe, rejected and unanswered guests. |
| Ticket QR and check-in | Confirmed guests get a unique ticket code and QR. The organiser scans it in the Mini App or enters the code to verify current approval and payment, then check in the whole group. Repeat scans flag an existing check-in. Cancelled, revoked and finished tickets fail validation. QR codes contain no hosting URL. |
| Guest information | Collect names, optional phone numbers, comments and custom question answers. |
| Individual request approval | Approve or reject each acceptance request separately before issuing an invitation ticket. |
| Location for approved ticket holders only | Enable approval and location privacy to withhold the address and private invitation details until the organiser approves the guest. |
| Guest privacy | Choose whether guests can see the guest list, upload media or browse shared media. |
| Event reminders | Personal and default reminders, including 2, 3 or 4 hours before the event. |
| Paid events | Organisers can show any price as text, accept manual bank transfers, use an external payment link or collect Telegram Stars. Approval and verified payment protect private tickets and locations. |
| Event banners | Add an image to invitations and the Mini App. |
| Shared event media | Collect photos, videos and files; browse, save or send them to Telegram. |
| Upload links and QR codes | Optionally allow media contributions without an RSVP. |
| Public event discovery | Explore public events in your saved timezone; keep other events private. |
| Event management | View upcoming and past events, edit, share, cancel or delete events. |
| Administrator dashboard | A separately configured administrator can review all events and users. |

## How to use XEvents

1. Open **[@XEvents_bot](https://t.me/XEvents_bot)** and press **Start**.
2. Choose **App**, set your timezone and create an event.

Use **App** in Telegram's bot menu or on an inline message button to open the authenticated Mini App. The reply-keyboard **App** shortcut sends an inline launcher first: Telegram's reply-keyboard Web App launch does not include signed identity data, which private database access requires. Every launcher uses the same app and database.
3. Add the schedule, banner, guest permissions and any custom questions.
4. Choose **Ticket booking** and share one link, or choose **Named invitations**, enter your guest list and use **Guest invitations** to copy or share each personal link.
5. Review responses in **My events** and approve guests when required.

Named guests can change their response before the deadline. **Later** keeps these invitations in the pending list. Ticket guests use **Get ticket** or **Request ticket** and enter their ticket name. Organisers do not respond to their own events. Existing events retain their original RSVP links and responses.

The initial RSVP message shows only **Accept**, **Reject**, **Maybe**, and **Respond later**, plus any response deadline. Enabled guest-list, media, reminder and other event buttons appear after acceptance. **Ask for phone number** and **Ask for comments** are off by default for new events; organisers can turn them on under Guest options. With those options, group size and custom questions off, a named guest's Accept, Reject or Maybe response saves immediately. Existing events keep their saved options.

### Two ways to invite people

**Ticket booking** suits open workshops, community activities and paid events. Guests use a shared link, enter their name, optionally provide contact details and answer custom questions. A free booking can issue its ticket immediately; approval and payment requirements hold the ticket and private location until satisfied.

**Named invitations** suit a club roster, wedding guest list or private team dinner. Enter up to 100 unique guest names, one per line. XEvents generates a separate link for each person and shows their organiser-assigned name when they open it. Accept, Decline, Tentative and Later do not ask for a name again. Send each link only to its intended guest: it binds to the first Telegram account that opens it, rather than verifying a person's real-world identity. Another account cannot claim that link. Names and unused links stay private to the organiser. Saved personal links remain stable during edits; removing an unopened guest revokes their link. Claimed invitations cannot be removed or renamed through the guest-list editor. Named invitation events are private and do not appear in Explore.

Editing fetches the latest event data, including title, address, description, questions, guest list and payment settings, and previews the existing banner. Saving without a new image preserves the banner.

## Approve guests before sharing the event location

For an invitation-only gathering, enable **Approve acceptance requests**. Guests can request to attend, but accepting does not immediately confirm their place. The organiser can **approve or reject each request individually**.

With approval required, the event location and private invitation instructions are shared only after approval. Approved guests receive a personalised invitation ticket and can see their invitation details in the Mini App. Guests awaiting approval see a message explaining that the organiser will send the details after reviewing their response.

This is useful for private training venues, members-only gatherings and events where the organiser wants to review attendance first. Invitation tickets confirm attendance; they are not paid tickets or a venue check-in system. Recipients can still forward information they receive, so this controls disclosure through XEvents rather than preventing sharing outside the app.

## Examples: sports clubs, meetups and community events

### Sports club training and friendly matches

A football, basketball or running club can organise a training session or friendly match, share its invitation in the club's Telegram group and collect player RSVPs. Add a custom question such as “Which team or training group are you joining?” and set a reminder two hours before the start. For a private venue, approve each request before sharing the meeting location with confirmed ticket holders.

### Club family days and social gatherings

A tennis club or community sports association can enable group attendance so a member enters the total number coming, including themselves. One response for a family of four counts as four people. Use custom questions for dietary preferences or activity choices, and collect photos through the event's shared media gallery.

### Cycling rides, hikes and outdoor meetups

Create a ride or hike with a start time, timezone and expected duration. Ask about experience level or equipment, review acceptance requests individually and release the meeting point after approval. A response deadline helps the organiser prepare the attendance list before departure.

### Volunteer activities and community cleanups

Share a public event for a park cleanup or volunteer day. Participants can find it through Explore when their saved timezone matches the event's timezone. Ask which task they prefer, set reminders and optionally share a media upload QR code for photos from the day.

### Workshops, hobby clubs and study groups

A photography club, language exchange or study group can invite members to a workshop, collect questions in advance and keep the guest list private. Enable media uploads and browsing when participants should share photos, videos or documents afterwards.

### Private parties and members-only events

Create a private birthday party, club dinner or community gathering with a banner and invitation link. Require individual approval to keep the address unavailable until a guest's request is approved. Set a response deadline, ask how many people are attending and review accepted and tentative responses in My events.

## Free event media storage: how it works

XEvents does not impose a built-in event media count quota. Telegram hosts uploaded photos, videos and files; the application stores file references and event metadata. This avoids maintaining a separate application media storage bucket.

**Unlimited free storage is not guaranteed.** Telegram restrictions, Cloudflare database and execution quotas, and provider policies still apply. Free tiers may suit small communities; larger deployments may need paid capacity. Telegram-hosted media is not an independent backup. Deleting an event cannot remove copies already delivered to someone’s chat.

Review the [Telegram Bot API](https://core.telegram.org/bots/api) and [Cloudflare platform limits](https://developers.cloudflare.com/workers/platform/limits/) before planning a large deployment.

## Paid events with Telegram Stars

Every organiser can enable **Paid event** when creating or editing an event in the Mini App. Choose **Manual bank transfer**, **External payment link**, or **Built-in Telegram Stars**, and write payment and refund terms. Manual methods accept prices as text, such as `AUD $20 each`, `£15 per family`, or `Members $10 / guests $15`. These prices are displayed as entered; XEvents does not convert or multiply them. External payment links must use HTTPS.

For bank transfers and external links, guests receive payment instructions after approval when required. **I have paid — request review** sends the organiser a request to check receipt in their bank or payment provider. Only the organiser can confirm payment and release the ticket and private location. Clearing a payment record does not move or refund money; organisers handle these refunds outside XEvents.

For Stars, choose a whole-number price per person or per group. For example, a workshop priced at 50 Stars per person costs 150 Stars for a group of three.

**Admin → Owner fee settings** lets the owner set a default admission price and pricing unit for new events. A default of zero means Free. Existing event prices are unchanged. Free and Stars price tags appear in event views, Explore, settings and management.

Local currency estimates update automatically from [Frankfurter's online exchange rates](https://frankfurter.dev/) and [Telegram's published USD reward value per Star](https://telegram.org/tos/bot-developers#6-2-4-rewards-for-stars). The app selects currency from the user's saved timezone when it identifies one currency, with a manual currency override for travel or ambiguous timezones. No currency-rate entry is required. Estimates show **organiser reward value**, not the guest's Stars purchase price, which varies by region and purchase channel. The rate date appears beside the price. Online data refreshes every six hours; a provider outage preserves recent cached data for up to seven days without blocking event creation or payments. Unsupported currencies have no monetary estimate. Checkout remains in Stars, and prices entered as text are unchanged.

When approval is required, the organiser approves the guest before requesting payment. Guests review the terms and tap **Agree & pay with Stars** to receive a Telegram invoice. Tickets and private joining details unlock only after Telegram confirms successful payment, not simply after a checkout attempt.

Stars payments go to the bot's balance, not directly to individual organisers. Stars are available to all organisers where Telegram permits their use. The bot owner handles organiser payouts manually; XEvents does not provide automatic payouts or split payments. Free events remain available to everyone. Event creation has no digital-only checkbox or event-type restriction. Hosts are responsible for checking the payment rules applicable to the goods or services they sell. See [Telegram's Stars payment documentation](https://core.telegram.org/bots/payments-stars).

Use **Payments & refunds** in the event's three-dot menu or `/paysupport` in chat to review purchases. The seller can request a full refund with confirmation. Cancelling or deleting an event requests full refunds for its recorded paid orders. Refunds are marked complete only after confirmation; failed refunds can be retried through payment support. Payment records survive event deletion, but hosts must keep their database and backups safe.

Paid bookings cannot change their RSVP or group size before a refund. Pricing, terms and group attendance settings cannot be changed while relevant payments are active. Provider balance and refund availability still apply. No real payment is made by the automated test suite; test your own checkout in Telegram's dedicated test environment before collecting payments.

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

`SUPER_ADMIN_ID` is listed blank in `.env.example` and `.dev.vars.example`; no personal admin ID is included in the public source. For local Worker development, copy `.dev.vars.example` to `.dev.vars` and enter your own values. `.dev.vars` is ignored by Git. Production reads the Cloudflare secret, so editing a sample file does not change the deployed administrator.

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

Invitation tickets confirm attendance. Paid admission supports Telegram Stars and organiser-verified bank transfers or external payment links. Direct card processing, automatic organiser payouts, calendar synchronisation and ticket scanning are not implemented.

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

