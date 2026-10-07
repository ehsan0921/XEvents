# Invitations, RSVPs and tickets

XEvents supports shared ticket booking links and personal invitations for a named guest list. Choose the mode that matches how you want people to join.

[All features](features.md) · [Payments](payments.md) · [Self-hosting](self-hosting.md) · [Project overview](../README.md)

## Choose an invitation mode

| | Ticket booking | Named invitations |
| --- | --- | --- |
| Best for | Workshops, open activities and ticket requests | Club rosters, parties and private guest lists |
| Invitation | One shared event link | A separate link for each organiser-assigned name |
| Guest name | Guest types a name or uses their Telegram name | Already supplied by the organiser; no name question |
| Response | Get ticket or Request ticket | Accept, Reject, Maybe or Respond later |
| Organiser approval | Optional, for each ticket request | No approval step; the RSVP saves directly |
| Group size | Optional general group-size question | Controlled separately for each name |
| Visibility | Public or private | Private; absent from Explore |
| One-time use | Off by default | On by default |

Payment requirements can apply in either mode. A paid RSVP or booking does not become a confirmed ticket until payment is confirmed. Existing events retain their legacy RSVP links and responses. Once links or guest responses exist, create a new event to change its invitation mode.

## Create and customise an invitation

Create in **App** with the full event form, or tap **🎉 Create event** in the bot's main menu to stay in chat. Set its title, location, schedule and timezone, then add optional details. You can provide a duration, banner, description and invitation message of up to 1,000 characters; the Mini App also offers an explicit finish date and time.

### Use the chat buttons

1. Type the event title.
2. Pick a day and time. Check the displayed timezone, and use **Change timezone** if needed. Choose another date or custom time by typing it when prompted.
3. Type the location, or choose to provide it later.
4. Review the event and create it, or open **More options**.

This starts with a free, private event and a shared ticket booking link. **More options** provides a named guest list, guest permissions, banner, custom invitation, duration, response deadline and default reminders. Optional response steps stay off until you enable them. No Mini App or typed commands are required; titles, addresses and guest names use ordinary chat messages. The older `/new` text flow remains available.

The invitation message appears in the bot and in shared invitation text. Personal invitations greet the guest by name, show the event time and explain their attendee count. Shared text omits locations protected by acceptance, approval or payment requirements, even when a host shares it. Private joining details are delivered in Telegram after the required steps are complete.

New events keep optional response steps off:

| Setting | Default |
| --- | --- |
| Invitation mode | Ticket booking |
| Ask for phone number or comments | Off |
| General group-size question | Off; available in ticket booking mode |
| Organiser approval | Off; available in ticket booking mode |
| Guest list, media uploads and shared-media browsing | Off; each has its own permission |
| Public visibility and uploads by public media link | Off |
| Ticket and upload QR codes | Off |
| Default reminder | Off |

The administrator can configure a default Stars admission price for their own new events; see [payments](payments.md#owner-default-price).

## Named guest lists and attendee counts

Enter one guest per line, with up to 100 unique names. Each name can contain up to 100 characters; the complete list can contain up to 10,000 characters. Add a distinguishing label when two guests have the same name.

```text
Alex = ?
Sam = 2!
Taylor = 2
Casey
```

| Entry | What happens when the guest accepts |
| --- | --- |
| `Alex = ?` | Alex is asked how many people are coming. |
| `Sam = 2!` | Sam confirms two people or chooses Change number. |
| `Taylor = 2` | Two attendees are used immediately; Change number is available. |
| `Casey` | One attendee; no group-size question. |

Counts include the invited guest and must be whole numbers from **1 to 10**. The picker shows 1–5, with **More** for 6–10. Named lists have no general “ask how many” or organiser approval setting; each name determines its own count behaviour.

A guest's selected count survives reopening the invitation. Editable counts can be changed before or after acceptance while the response deadline remains open. After acceptance, changing the count updates the attendance total and replaces the old ticket code. Count changes are blocked after check-in, while a manual payment report needs review, or while payment/refund processing or a paid booking is active. An unpaid Stars invoice becomes invalid if the count changes; see [payment safeguards](payments.md#changes-and-refunds).

### Personal links and edits

In the bot, open **Manage → Invitation links** to see guest-name buttons, with ten guests per page and two buttons per row. When the complete invitation and link fit Telegram's 256-character copy-button limit, tapping the name copies them immediately. Longer invitations open that guest in **App**; tap their name there to copy the full message and personal link. Without App, the bot displays the full invitation with a Share action so you can select and copy it. Messages are not truncated to fit the button.

The Mini App's **Guest invitations** view also offers guest-name copy buttons, search for larger lists, invitation previews and sharing. If clipboard access fails, the full text is selected for manual copying. Guest names and unused links are private to the event hosts. Send personal links privately: possession of a link does not prove someone's real-world identity.

Links stay stable when you save the same guest names and count settings. Removing an unopened name revokes its link. Once an invitation has been opened, the guest-list editor cannot remove or rename it, or change its count or selection mode. This edit protection applies even if the guest has only opened the link or chosen Later; it is separate from the one-time-use lock described below.

Editing loads the latest event details, including the invitation message, guest list, payment settings and existing banner preview. Saving without selecting a replacement image preserves the current banner.

## Responding and returning later

A named invitation initially offers **Accept**, **Reject**, **Maybe** and **Respond later**, with any response deadline shown in the message. A plain `Name = N` invitation also offers **Change number**. After acceptance, the RSVP choices are replaced by **Change response** and the enabled event tools, such as guest lists, reminders or shared media.

With phone and comments off, Accept, Reject and Maybe save without those questions. Accept may still ask for or confirm a count when the name uses `?` or `!`. If phone collection is off, the bot skips the phone step entirely. If enabled, guests can share their own Telegram contact, type a number or skip it. Comments are optional when enabled. Custom guest questions are no longer prompted.

Ticket guests enter their ticket name and complete only the enabled steps; they do not receive the named RSVP choices. Event owners and active co-hosts receive host tools rather than a new RSVP request.

**Respond later** keeps a named or legacy invitation in the guest's pending list. The pending-invitations button is hidden when that list is empty. Ticket booking links use the booking flow instead of a Later list.

### One-time invitation links

One-time use locks a link to the first Telegram account that completes an Accept, Reject or Maybe response, or completes a ticket booking/request. A ticket request consumes the link even if approval or payment is still pending.

- Opening the link or choosing Later does **not** consume it.
- After a completed response, choosing Later does not unlock it for someone else.
- The same guest can reopen it and change their response before the deadline, subject to payment and check-in restrictions.
- Another account cannot finish an already-open response after the first guest consumes the link.

Named links start one-time; shared ticket links start reusable. Turn one-time use off only if multiple accounts should be able to use the same link. A link with completed responses from several accounts cannot subsequently be switched to one-time use. For a one-time ticket event, the shared event link permits only one completed booking, so leave it reusable when selling or issuing multiple tickets.

### Response deadlines and reminders

The organiser can set a response date and time at or before the event starts. It appears on the invitation in the guest's saved timezone. After it passes, new responses, unfinished responses and count changes cannot be saved. It does not prevent hosts from reviewing an already-saved ticket approval request.

Default and personal reminder choices are **Off**, **15 minutes**, **1 hour**, **2 hours**, **3 hours**, **4 hours** or **1 day** before the start. A personal reminder time must still be in the future; new default reminders attach only while their scheduled time is still ahead. Default reminders are delivered for confirmed guests, including any required approval and payment; personal choices override the default. Scheduled delivery requires the hosted Worker.

## Approvals, locations and guest privacy

Use **Ticket booking** with **Approve acceptance requests** when you need to review each guest before confirming a place. The request is saved as pending and the hosts receive approval controls. Approving a free request sends its ticket and joining details; approving a paid request makes payment available first. Rejecting a request informs the guest and leaves it unconfirmed.

Named invitations save their RSVP directly and do not require a second approval. They can still hide the location until acceptance, and paid named invitations also require confirmed payment.

| Location setting | When a guest can see the location |
| --- | --- |
| Free event without location restrictions | When they open the event |
| Hide until accepted | After acceptance |
| Ticket approval required | After acceptance and organiser approval |
| Paid event | After acceptance, any required approval and confirmed payment |

Hosts can see the location throughout. Private ticket instructions are included with a confirmed ticket. These controls restrict disclosure through XEvents; recipients can forward information once they receive it.

Guest-list visibility, upload permission and shared-media browsing are separate settings. RSVP phone numbers are not included in the guest-facing list; event hosts and the configured administrator can access them through management tools. An optional phone number saved in Profile is not automatically added to an RSVP. Treat optional comments as visible to other guests when guest-list sharing is enabled.

For contributions without an RSVP, enable uploads and the separate public media upload link. It opens a media-only view rather than an RSVP flow. Browsing remains a separate permission. See [media and privacy](features.md).

## Guest management, tickets and check-in

Hosts can review accepted responses and people totals separately, distinguish confirmed attendance from approval requests and unpaid bookings, and filter the roster by response state. Named lists also show unopened guest placeholders. An unopened name can appear in the roster, but the bot cannot contact a Telegram account that has not interacted with it.

Confirmed guests receive a unique ticket code. With QR codes enabled, the Mini App also provides a scannable ticket. Owners and co-hosts can verify a code or scan the QR and check in the entire group. A new check-in notifies the guest; repeat checks show that the ticket was already checked in.

QR codes start off for new events. Turning them off hides guest QR options and upload QR generation, while manual ticket codes, check-in by code and media upload links still work. Existing events without a saved QR setting retain QR functionality until it is disabled. Ticket QR payloads contain an event ID and ticket code, not the hosting URL.

Validation checks current confirmation and payment status. Cancelled events and superseded or no-longer-confirmed tickets fail validation. A saved finish time also makes tickets invalid after the event ends; without a finish time, passing the start time alone does not expire a ticket.

Owners can cancel or delete an event and notify guests who accepted or chose Maybe. Cancellation retains the event record; deletion removes it. Payment records and refund handling are described in [payments](payments.md#changes-and-refunds).

## Share hosting with co-hosts

In **My events**, open the three-dot menu and choose **Co-hosts**, or use the bot's organiser tools. The owner can create multiple one-use links and optionally give each a label of up to 80 characters, such as `Door team` or `Club secretary`. Share each link privately: the first eligible Telegram account to open it in the bot becomes a co-host. Opening the Mini App alone does not claim the role.

The owner sees each link's label and pending, active or revoked status. Claimed entries show the person's Telegram name, @username when available and numeric Telegram ID; a missing username is shown as **No Telegram username**. A person who is already a co-host cannot consume another link for the same event, leaving it available for someone else.

Co-hosts can edit event details, schedules, banners and guest options; share personal invitations; manage responses and approve ticket requests; use shared media; and check in tickets. Their events appear as **Co-hosting**. Payment settings are read-only for co-hosts. Only the owner can confirm manual payments, manage refunds, create or revoke co-host access, cancel or delete the event.

Cancel an unused link or revoke a particular active co-host from their entry. This invalidates that link or removes that person's management access immediately, without affecting other co-hosts or pending links. The owner can create a new link afterwards. Revoked entries remain visible for review. If an entry changes while a confirmation is open, review its current state before retrying; a stale confirmation cannot revoke a newly claimed entry.

Becoming or ceasing to be a co-host preserves an existing guest response and paid ticket. It does not transfer event ownership or create a new RSVP.
