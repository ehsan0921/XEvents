# XEvents features and examples

XEvents is an open-source event planner for Telegram. The bot handles event creation, invitations, responses, uploads, and guest notifications; the Mini App provides event forms, management, profiles, discovery, and shared media.

[Try XEvents](https://t.me/XEvents_bot) · [Invitations](invitations.md) · [Payments](payments.md) · [Self-hosting](self-hosting.md)

Use **App** in Telegram's bot menu or on an inline message button to open the authenticated Mini App. The reply-keyboard **App** shortcut first sends an inline launcher, which supplies the signed identity needed for private API access. Every launcher opens the same app and database; a normal browser URL alone does not authenticate a Telegram user.

## Events and schedules

Create an event with a title, location, description, optional banner, and optional custom invitation message. Choose a local date and time with the Mini App's pickers, and optionally set either a duration or a finish date and time. Clock times that are missing or repeated during a daylight-saving change are rejected so the host can choose another time.

### Create directly in Telegram

Tap **🎉 Create event** in the bot's main menu when you prefer chat or cannot open the Mini App. Type a title, choose a day and time, add a location or choose to provide it later, then review and create. Date and time choices use buttons, with text input for another date or a custom time. The displayed timezone comes from your profile when available; otherwise it is explicitly UTC, with a **Change timezone** option.

The short flow creates a free, private event with a shared ticket link. **More options** lets you change the details, use a named guest list, add a description, invitation message or banner, enable guest options, and set a duration, response deadline or reminder. Phone collection, comments, media and QR codes start off. The Mini App is optional for this flow; `/new` remains available for the older text sequence.

Guests can save their timezone in Profile. XEvents displays the event locally and includes the organiser's time when it differs. Changing a profile timezone does not move the event's actual start time.

Set a response deadline under RSVP settings when you need replies before a particular date and time. Optional settings are grouped into collapsible sections. Editing fetches the latest event details, guest list, payment settings, and current banner; saving without a replacement image keeps that banner.

### Home, Explore, and My events

- **Home** shows ongoing and upcoming plans, followed by future public events or ideas for a new gathering.
- **Explore** searches public events by title and description in the user's saved timezone. This is timezone matching, rather than GPS distance or city-based search.
- **Create** opens the event form.
- **My events** groups upcoming and past events, with co-hosted events identified. Guests do not see cancelled events or rejected invitations in My events.
- **Profile** holds the name, optional photo and phone number, timezone, and price-display currency.

Named invitation events stay private and are absent from Explore. Public event listings expose their titles, descriptions, banners, schedules, and price labels; use private visibility for sensitive gatherings.

## Invitations and responses

Choose the workflow that fits the event:

| Mode | Guest experience | Host control |
| --- | --- | --- |
| Ticket booking | Open a shared link, enter a ticket name, and book or request a ticket. | Optional individual approval, group-size selection, payment, and private joining details. |
| Named invitations | Open a personal link showing the assigned name; Accept, Reject, Maybe, or Respond later. | Per-guest counts, response deadlines, and optional one-time links. No second approval step. |

The host does not respond to their own event. Phone collection and comments start off for new events. When phone collection is off, the response flow never asks for a number. Hosts can enable either option when needed; profile contact details do not automatically become an RSVP phone response. Custom guest questions are no longer offered in the creation or response flow.

Group-size selection uses buttons for 1–5 people and **More** for 6–10. Counts include the responding guest. A named invitation can instead ask for a count (`Alex = ?`), confirm a reserved count (`Alex = 2!`), use an editable preset (`Alex = 2`), or fix the count with no guest changes (`Alex = 2*`). Editable count buttons show the current selection, such as **2 people · Change**, and invitations emphasize the reserved count in bold. With no count setting, one response means one person.

**Respond later** keeps an unanswered named invitation in the pending list. The Pending button is hidden when none remain. After acceptance, guests see Change response and the extra actions enabled by the host. Declined and tentative responses do not gain accepted-guest actions. Hosts receive response notifications; guests receive approval/rejection notifications when ticket booking requires review.

In Telegram, **Manage → Invitation links** shows ten guests per page with their names on the buttons. Short invitations copy the complete message and personal link directly. Longer invitations open the selected guest in App, where a name button copies the full text. Without App, the bot displays the full invitation to select, copy or share. The Mini App also supports guest search and a selectable-text fallback if clipboard access is unavailable.

Read the [invitation guide](invitations.md) for link ownership, response changes, deadlines, and co-hosts. Existing events keep their original links and responses; older events can retain legacy defaults rather than adopting every new-event default.

## Guest management and co-hosting

Hosts can review accepted responses and total people, with approval requests and unpaid acceptances counted separately from confirmed attendance. Filters distinguish accepted, pending, maybe, rejected, and unanswered guests. Named lists also show unopened guest placeholders; a shared booking link cannot identify people who never open it.

**Guest invitations** combines personal links with response details, comments, attendee totals, response filters and guest-name search. Owners and co-hosts can add names without changing existing invitations, or remove an invitation with a choice to notify the guest or remove silently. Removal revokes the link and ticket; payment records are retained for separate refund handling.

The main event actions include opening the event in chat, editing, copying the invite link, and shared media when available. Secondary actions sit under the three-dot menu.

An owner can create multiple co-host links with optional labels. Each private link works once; after it is claimed, the owner sees the claimant's Telegram name, @handle when available, and numeric ID beside its label. Cancel an unused link or revoke a particular co-host without affecting other hosts. Revoked entries retain their status for the owner to review.

Co-hosts can edit event details, manage responses, share personal invitations, use shared media, and check guests in. The owner controls payment settings, co-host access, cancellation, and deletion. Revocation removes management access immediately and preserves existing guest responses and tickets. Host tools expose submitted guest contact details to co-hosts, so invite people you trust.

Cancelling or deleting asks for confirmation and notifies accepted and tentative guests. Paid orders remain available for refund handling after event deletion; see [payments and refunds](payments.md).

## Tickets and check-in

Confirmed guests receive a unique ticket code. Confirmation requires an accepted response plus any required approval and verified payment. Private locations and ticket instructions stay locked until those requirements are satisfied.

Hosts can enter a code to check its validity, then check in the entire group. The result shows the guest name and participant count. A repeat check reports the existing check-in; a newly recorded check-in notifies the guest in Telegram.

Ticket validation checks the current event, acceptance, approval, and payment state. Cancelled or no-longer-confirmed tickets fail validation. An event with a saved finish time also rejects tickets after that time; an event without a finish time has no automatic end-time ticket expiry.

### Optional QR codes

QR codes start **off** for new events. Enabling them adds a scannable ticket and permits media upload QR generation. Ticket QR payloads contain an event identifier and ticket code, with no hosting URL. A ticket QR is a credential: share it only with the intended guest.

Manual codes, code-based check-in, and media upload links work with QR codes off. Existing events without a saved QR setting retain their QR functionality until edited. QR scanning depends on the Telegram client supporting it; manual code entry remains available.

## Reminders

Hosts can set a default reminder for confirmed guests. Choices include Off, 15 minutes, 1 hour, 2 hours, 3 hours, 4 hours, or 1 day before the event. Accepted guests can choose a personal reminder or turn it off.

Default reminders wait for required approval and payment. New default reminders attach only while their scheduled time is still in the future; personal reminder choices reject times that have already passed. The hosted Worker checks reminders through its scheduled task; delivery is best effort and can be delayed. Reminder state records the event start time to avoid intentionally sending the same reminder again for that start.

## Shared media

Hosts can separately allow guest uploads and gallery browsing. Collect photos, videos, and files through Telegram, then use **Shared media** in the Mini App to browse previews. Supported images sent as documents and videos can use Telegram thumbnails or supported file previews.

The gallery supports **Save** and **Send to my Telegram**. Sending delivers the chosen item to the user's bot chat. Mini App file downloads are capped at 20 MB; larger files can be sent to Telegram for retrieval in chat. Preview and download support depends on the file format and Telegram's available file data.

Enable a media-only upload link when people should contribute without an RSVP. It opens the event banner, title, and permitted media actions rather than invitation response buttons. Anyone-with-link uploading is a separate host option; viewing shared media remains a separate permission. QR codes are optional for sharing these links.

### Storage model

Telegram hosts uploaded photos, videos, and files, including banners and profile images. XEvents stores file references and event metadata, avoiding a separate media storage bucket. There is no built-in event media count quota.

This does **not** guarantee unlimited free storage: Telegram restrictions, Cloudflare database and execution quotas, and provider policies apply. Files may not remain retrievable forever, and Telegram-hosted media is not an independent backup. Deleting an event cannot delete copies already sent to a guest's chat. Read [architecture and operating limits](architecture.md#operational-constraints) before choosing a deployment size.

## Profiles, branding, and privacy

Users can save a name, optional profile photo and phone number, timezone, and preferred currency. Their profile image and name appear in the header. Sharing a phone number with an event host is a separate response choice.

An administrator configured through the server-side `SUPER_ADMIN_ID` secret can access the admin panel inside Profile, review events and users, set a home-page bot icon, and set default Stars pricing. Missing admin configuration disables this access; no personal administrator ID is part of the public source.

The Mini App verifies signed Telegram identity. Server checks enforce ownership, co-host access, guest permissions, and administrator access. Event phone responses are available to trusted hosts and the configured administrator. Other guests see responses and comments only when the guest-list permission is enabled. Hosts must protect their database and backups.

Approval applies to ticket booking. Hosts can require it before releasing the location and private joining instructions. Location privacy can also restrict details to confirmed guests without a separate approval step. XEvents controls disclosure through the app; it cannot stop recipients forwarding information they receive.

See [SECURITY.md](../SECURITY.md) for sensitive-data handling and private vulnerability reporting.

## Payments

Events can be Free or Paid. Paid events support a price written as text with bank transfer instructions or an HTTPS payment link, and numeric Telegram Stars prices per person or per group. Manual payments need organiser verification; Stars payments need Telegram's successful-payment confirmation.

Stars go to the bot's balance. The bot owner handles organiser payouts manually; there is no automatic split-payment system or direct card processing. Local currency estimates represent organiser reward value, not the guest's Stars purchase cost. Read the [payment guide](payments.md) for terms, currency estimates, refund states, and provider restrictions.

## Examples for clubs and communities

| Gathering | A practical setup |
| --- | --- |
| Sports club training or a friendly match | Use named invitations for the roster. Add “Bring your training kit; arrive 15 minutes early” and a two-hour reminder. Use ticket booking with approval if you need to review requests before sharing a private venue. |
| Club family day | Use `Alex = 4` for four reserved places, or `Alex = ?` when the family size is unknown. Enable shared media for photos afterwards. |
| Cycling ride or hike | Set a start and expected duration, add route difficulty and equipment instructions, and set a response deadline. Ticket booking with approval can keep the meeting point private until reviewed. |
| Volunteer day or community cleanup | Publish a ticket booking event for discovery in the saved timezone. Enable a media-only upload link for photos, and optionally a QR code for a printed upload poster. |
| Photography workshop, language exchange, or study group | Add preparation instructions. Enable comments only if a note is useful, and enable media permissions for participants to exchange documents or photos. |
| Private party or members-only dinner | Send personal named invitations with reserved counts, or use a private booking link with individual approval. Add a banner and keep the address available only to confirmed guests. |

## Frequently asked questions

### Is XEvents a free event management tool?

The source is free under MIT, and you can try [the public Telegram bot](https://t.me/XEvents_bot). Hosting costs depend on usage and provider pricing; the licence does not promise free hosting forever.

### Do guests need a separate RSVP website or app?

No. Guests open the Telegram invitation link and respond in the bot chat. The Mini App provides the forms, management views, and gallery inside Telegram.

### Can someone upload photos without accepting an invitation?

Yes, when the host enables the media-only upload link and allows anyone with it to contribute. Gallery browsing has its own permission.

### Can I keep an event private?

Yes. Private events are absent from Explore. Hosts can restrict locations, guest lists, and shared media; ticket booking can require individual approval.

### Can I modify XEvents or use it commercially?

Yes. [MIT](../LICENSE) permits use, modification, distribution, and commercial use while retaining the copyright and permission notice.

### What is not implemented?

Direct card processing, automatic organiser payouts, calendar synchronisation, and GPS-distance discovery are not implemented. The architecture targets small communities; see [technical limits](architecture.md#operational-constraints) and [UX verification boundaries](UX-review.md).
