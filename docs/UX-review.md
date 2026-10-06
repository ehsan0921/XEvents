# XEvents user journeys

The UX review covers the bot and Mini App together. Behaviour is verified with automated bot tests, Worker integration tests using a mocked Telegram API, and a local browser preview. Actual mobile Telegram rendering, real payments and notification delivery on a user's device require a live device check.

| Journey | Expected behaviour |
| --- | --- |
| Create or edit | Choose ticket booking or named invitations. Existing details and banner load when editing. Phone sharing, comments and media extras default off. Hidden payment fields do not block a different payment method. |
| Ticket link | Show booking or ticket request actions; collect the guest's name. No RSVP choices. |
| Named invitation | Bind a personal link to one Telegram account. Use the organiser's guest name; show Accept, Reject, Maybe and Respond later, including any response deadline. |
| Save RSVP | Remove buttons from the tapped message, save the response and notify the organiser. Optional questions appear only when enabled. Repeated taps do not reset approval. |
| Respond later | Show unanswered RSVP invitations. Ticket booking links are excluded. Hide Pending when there are none. |
| Approval | Notify the guest on approval or rejection. Approval buttons refer to a particular response version; an older request cannot approve a newer response. |
| Private information | Keep restricted location and ticket details locked until approval and any required payment are complete. |
| Accepted guest | Show Change response and organiser-enabled extras. Shared media stays among the main event actions. |
| Payment | Stars confirmation requires Telegram's successful-payment update. Manual payment reports require organiser verification; reporting does not unlock tickets. A payment report under review cannot be replaced by a new RSVP. |
| Media-only link | Show the banner, title and permitted media actions without RSVP. Saving or sending files remains explicit. Gallery refreshes cannot overwrite a newer request. |
| Reminders | Default reminders wait for a confirmed acceptance, including approval and payment. Send once per event start time. Personal overrides remain available to accepted guests. |
| Cancel or delete | Ask for confirmation, notify accepted and tentative guests, remove the event from My events, and preserve payment records needed for refunds. |
| Navigation and errors | Keep important event actions visible and secondary actions under the three-dot menu. Prevent duplicate async button actions. Show actionable errors inside the Mini App. |

Clicked messages lose their buttons. Other previously delivered messages cannot all be edited retroactively; new RSVP and approval messages contain response versions, so stale actions are rejected when tapped. Older messages from before version tracking still use legacy validation.
