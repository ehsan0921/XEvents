# Paid events and payment support

XEvents supports free admission, organiser-verified bank transfers, external payment links and Telegram Stars. Each event uses one payment method. Payment records control ticket confirmation; they are not a general accounting or payout system.

[Invitations and approvals](invitations.md) · [All features](features.md) · [Self-hosting](self-hosting.md) · [Project overview](../README.md)

## Choose a payment method

Every organiser can enable **Paid event** in the Mini App when creating or editing an event, then choose a method and enter payment and refund terms.

| Method | Price | How payment is confirmed |
| --- | --- | --- |
| Free | No charge | Acceptance and any required ticket approval |
| Manual bank transfer | Text entered by the organiser | Owner checks their bank and confirms receipt |
| External payment link | Text entered by the organiser | Owner checks their payment provider and confirms receipt |
| Telegram Stars | Whole-number Stars price per person or per group | Telegram reports a successful payment |

Stars collection is available to all organisers in the application, subject to Telegram's availability and applicable payment rules. The event editor has no digital-only checkbox or event-type restriction. That UI does not determine whether a particular use is permitted by Telegram; review the [official Stars payment documentation](https://core.telegram.org/bots/payments-stars) for your event.

Direct card processing, automatic organiser payouts and split payments are not implemented. Stars are collected in the bot's balance rather than sent directly to each organiser. The bot owner must arrange any organiser payouts manually. Manual transfers and external links are paid through the organiser's chosen bank or provider.

## Prices and terms

All paid events require payment and refund terms of up to **1,000 characters**. Guests see them before payment. Explain what admission includes, how to contact the seller and how refunds are handled.

For manual methods, prices are display text of up to **120 characters**, for example:

```text
AUD $20 each
£15 per family
Members $10 / guests $15
```

XEvents displays these prices exactly as entered; it does not convert or multiply them by attendee count. Bank instructions are required and can contain up to 1,500 characters. External payment links must use HTTPS, contain no embedded login credentials and be at most 1,000 characters. Instructions are optional for the external-link method.

Stars prices must be whole numbers from **1 to 100,000**. Choose **per person** or **per group**. At 50 Stars per person, three attendees cost 150 Stars; at 50 Stars per group, they cost 50 Stars. The complete order must also be within 1–100,000 Stars, so a valid unit price can still produce an unsupported group total. Guest count selection is limited to 1–10 people; see [attendee counts](invitations.md#named-guest-lists-and-attendee-counts).

Free, text-price and Stars labels appear in event views, Explore and event management. Payment and refund terms are event-specific.

### Owner default price

**Admin → Owner fee settings** lets the configured administrator set a default Stars admission price and pricing unit for their own new events. Zero means Free. Existing events keep their saved prices, and other organisers can independently choose their event's payment method and price.

This setting is a default admission price, not a platform commission or an automatic payout deduction. Administrator access must be [configured by the host](self-hosting.md); it is not granted by a Telegram username.

### Local currency estimates

The app estimates the organiser reward value of Stars using [Telegram's published USD reward value](https://telegram.org/tos/bot-developers#6-2-4-rewards-for-stars) and [Frankfurter's online exchange rates](https://frankfurter.dev/). It does not estimate the guest's Stars purchase cost, which can vary by region and purchase channel.

The saved timezone selects a currency when its associated countries identify one currency. Users can choose a currency override in Profile, including when travelling or using an ambiguous timezone. This uses profile settings rather than device geolocation. The price display includes the exchange-rate date.

The hosted Worker normally refreshes online data every six hours. If a provider fails, it retries after a shorter interval and can retain recent cached rates for up to seven days. Unavailable, unsupported or expired rates omit the currency estimate; they do not block event creation or payment. There is no manual currency-rate entry. Checkout remains in Stars, and manual text prices remain unchanged.

## Booking, approval and payment

Approval is an option for **ticket booking mode**. Named invitations save their RSVPs directly without organiser approval, even for paid events.

1. The guest accepts a named invitation or submits a ticket booking/request, including any enabled name, count, phone or comment steps.
2. If ticket approval is required, a host approves the request. Payment instructions are withheld until then.
3. The guest pays using the chosen method.
4. Confirmed payment releases the ticket, private location and joining details.

An accepted RSVP, approved request or payment report alone is not a confirmed paid ticket. Event hosts can review these states separately in the guest roster. See [location privacy](invitations.md#approvals-locations-and-guest-privacy).

### Bank transfers and external links

The guest receives the event's instructions and, when configured, an **Open payment link** button. After paying outside Telegram, they press **I have paid — request review**. The owner receives a review request and must check their bank or payment provider before choosing **Confirm received**.

Reporting payment does not unlock a ticket. Only the event owner can confirm or clear the payment record; a co-host cannot. Confirmation sends the guest their ticket. Clearing a report or confirmation changes XEvents' record and removes any ticket confirmation, but transfers or refunds no money. Handle refunds through the bank or external provider first.

### Telegram Stars checkout

The guest reviews the total and event terms, then presses **Agree & pay with Stars** to receive a Telegram invoice. Checkout verifies the payer, event, terms, price and attendee count. A checkout attempt does not release the ticket: the app waits for Telegram's successful-payment notification.

After successful payment, the guest receives a payment confirmation and ticket, and the event owner receives a payment notice. New checkout is unavailable once the event starts. An outdated invoice cannot confirm a changed booking; a late successful payment for an invalid order triggers a full refund request instead.

## Changes and refunds

Paid or processing bookings cannot change their RSVP or attendee count while payment or refund handling is active. Manual payment reports also block response changes until the owner resolves them. Check-in and response deadlines impose their own restrictions.

Unpaid guests may change an editable attendee count. For Stars, that invalidates the old invoice and a new checkout must use the updated total. The server also prevents payment methods, prices, terms and relevant group settings from being changed while active payment records would make that unsafe. Resolve manual records or refund Stars orders before making those changes.

Use **Payments & refunds** in the event's three-dot menu, or **`/paysupport`** in chat, to review recorded purchases and contact the seller. A guest can include their question after `/paysupport`. The event owner can request a **full** Stars refund with confirmation; partial refunds are not implemented.

Cancelling or deleting a Stars event requests full refunds for its recorded paid orders. A requested refund is not immediately marked complete: confirmation is required, and failed refunds remain available for review and retry. Provider balance and refund availability still apply. A confirmed Stars refund removes the guest's ticket confirmation and marks their response as declined.

Cancelling or deleting an event does not send bank or external-link refunds. The owner handles those through the original provider. Recorded Stars orders and manual payment records survive event deletion so payment support can continue; protect the database and its backups.

## Testing and operational limits

`npm test` and `npm run test:worker` use mocked Telegram requests and local test data. They exercise payment state, payer and amount checks, approvals, group changes and refunds without creating real charges or sending real bot messages.

The current code targets Telegram's standard Bot API endpoints. It does **not** provide a configurable API base or a `/test` endpoint switch for Telegram's dedicated payment test environment. The automated tests are not a live payment-provider certification. Adding test-server routing would require a separate application change; do not assume that setting a development token alone provides that integration.

Use a separate development bot for local work and follow the [self-hosting guide](self-hosting.md). Event hosts remain responsible for payment support, appropriate terms, external payment verification, payout arrangements and secure records. Telegram and hosting-provider limits still apply.
