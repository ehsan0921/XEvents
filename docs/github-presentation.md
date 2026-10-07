# GitHub presentation

These are recommendations for a repository owner to apply manually. Editing this guide does not change GitHub metadata, rename a repository or publish an image.

## Repository details

| Setting | Recommendation |
| --- | --- |
| Name | `xevents` is concise and matches the product. The existing `XEvents` name already works; a rename is not required. |
| Description | Open-source Telegram Mini App for event management, invitations, RSVP, tickets, QR check-in and shared event media. |
| Website | [https://t.me/XEvents_bot](https://t.me/XEvents_bot) |
| Topics | `telegram`, `telegram-bot`, `telegram-mini-app`, `event-management`, `event-planner`, `free-event-management`, `community-events`, `events`, `rsvp`, `ticketing`, `qr-code`, `cloudflare-workers`, `cloudflare-d1`, `javascript`, `open-source` |

Use the repository's **About** settings to update its description, website and topics. Choose one repository as the main project link if maintaining multiple public copies, so users know where to report issues and contribute. Update documentation links deliberately if the canonical repository changes.

The description and topics use features that exist in the project. Keep terms such as “free event management” in natural, accurate README prose, with the hosting and storage limits nearby. Clear descriptions, relevant topics and useful documentation can help discovery; they do not guarantee indexing, search placement or free hosting.

## Social preview

Prepare a **1280 × 640 px** image with a solid background. GitHub recommends this size for best display and accepts PNG, JPG or GIF files under 1 MB. Upload the reviewed image manually under **Settings → Social preview → Edit**. See [GitHub's social preview guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

Use the existing X wordmark and green palette from [the app header](../public/index.html) and [stylesheet](../public/style.css): dark green `#126b5b`, pale background `#f6f7f2`, or the app's dark theme with mint `#70d1ac`. Keep the composition simple and readable when reduced to a small link preview.

Suggested copy:

```text
XEvents
Events happen here.
Create · Invite · RSVP · Check in
Telegram Mini App
```

An optional crop from a reviewed [real product screenshot](screenshots/README.md) can accompany the text once available. Do not invent an interface, imply automatic organiser payouts or card processing, or promise unlimited free storage. Exclude user contact information, private URLs, valid ticket codes and live QR links. This guide does not include or generate a binary social preview asset.

## Documentation review before publishing

- Check that the README's top links reach the bot, feature overview, screenshot plan, self-hosting and contribution instructions.
- Verify relative file links and heading anchors locally, including filename case. Link screenshots only after the reviewed files exist.
- Render the Markdown with GitHub's renderer or a GitHub preview. Check tables, captions, code blocks and any Mermaid diagram on a narrow screen as well as a desktop.
- Confirm commands against `package.json` and the public configuration examples. Keep credentials, deployment identifiers and guest data out of examples and images.
- Review links and claims after product changes. A website response alone does not verify that a Telegram bot flow works; check the bot separately in Telegram.

Changes to repository metadata, social preview and published documentation remain separate manual publishing steps.
