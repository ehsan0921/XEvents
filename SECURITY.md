# Security

Self-host using your own bot and infrastructure. Public source does not grant access to the hosted XEvents service.

Keep bot tokens, webhook secrets and administrator IDs in server-side secrets. Never include credentials in frontend code, URLs, screenshots, issues or commits. Administrator access is disabled unless a valid SUPER_ADMIN_ID is configured.

Keep environment files, production configuration, local data, database exports and provider credentials private. Event responses may contain names, phone numbers and personal answers. Protect backups and review guest permissions before sharing links.

Revoke exposed bot tokens through BotFather immediately and replace the deployed secret. Rotate exposed webhook secrets and invitation/upload links as appropriate. Removing a secret from a file does not remove it from Git history.

Use GitHub private vulnerability reporting when available. Otherwise request a private contact channel in an issue without including sensitive details. Never post credentials or real guest data publicly.
