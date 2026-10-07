# XEvents user journeys

The UX review covers the bot and Mini App together. Behaviour is verified with automated bot tests, Worker integration tests using a mocked Telegram API, and a local browser preview. Actual mobile Telegram rendering, real payments and notification delivery on a user's device require a live device check.

| Journey | Expected behaviour |
| --- | --- |
| Create or edit | Choose ticket booking or named invitations. Existing details and banner load when editing. Phone sharing, comments and media extras default off. Hidden payment fields do not block a different payment method. |
| Ticket link | Show booking or ticket request actions; collect the guest's name. No RSVP choices. |
| Named invitation | Use the organiser's guest name; show Accept, Reject, Maybe and Respond later, including any response deadline. One-time links default on for named lists: the first completed Accept, Reject or Maybe response locks the link to that Telegram account. Opening it or choosing Later first does not consume it. The same account can revise its response before the deadline; forwarded links are blocked after locking. Turning one-time use off allows multiple accounts to use the link. |
| Group size | Ticket mode can enable a group-size question. Named invitations use each guest's count setting: `Alex = ?` asks for a count, `Alex = 2!` asks to confirm two places, and `Alex = 2` uses two with a Change number button. A bare name means one person. Counts include the guest and are limited to 1–10. |
| Save RSVP | Remove buttons from the tapped message, save the response and notify the organiser. Phone sharing and comments appear only when enabled; custom guest questions are not part of the flow. Named RSVPs save without organiser approval. Repeated or stale taps cannot replace a newer response or reset a ticket request's approval. |
| Respond later | Show unanswered RSVP invitations. Ticket booking links are excluded. Hide Pending when there are none. |
| Approval | In ticket-booking mode, notify the guest on approval or rejection. Approval buttons refer to a particular response version; an older request cannot approve a newer response. Named invitations have no organiser approval setting. |
| Private information | Keep restricted location and ticket details locked until the required acceptance, ticket-request approval and payment steps are complete. A named invitation can withhold its location until acceptance and any required payment without adding an approval step. |
| Accepted guest | Show Change response and organiser-enabled extras. Shared media stays among the main event actions. |
| Payment | Stars confirmation requires Telegram's successful-payment update. Manual payment reports require organiser verification; reporting does not unlock tickets. A payment report under review cannot be replaced by a new RSVP. |
| Media-only link | Show the banner, title and permitted media actions without RSVP. Saving or sending files remains explicit. Gallery refreshes cannot overwrite a newer request. |
| Reminders | Default reminders wait for a confirmed acceptance, including approval and payment. Send once per event start time. Personal overrides remain available to accepted guests. |
| Cancel or delete | Ask for confirmation, notify accepted and tentative guests, remove the event from My events, and preserve payment records needed for refunds. |
| Navigation and errors | Keep important event actions visible and secondary actions under the three-dot menu. Prevent duplicate async button actions. Show actionable errors inside the Mini App. |

Clicked messages lose their buttons. Other previously delivered messages cannot all be edited retroactively; new RSVP and approval messages contain response versions, so stale actions are rejected when tapped. Older messages from before version tracking still use legacy validation.

A one-time link stays locked when its holder later chooses Respond later. Shared ticket-booking links default to reusable, with an optional one-time setting. Enabling one-time use is rejected if the affected link already has final responses from multiple accounts. A personal link identifies the first responding Telegram account, not a verified real-world identity, so organisers should send it privately to the intended guest.
