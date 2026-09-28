# Telegram event guide

Each gathering can connect one dedicated Telegram bot from **Organizer workspace → Settings → Telegram**.

## Organizer setup

1. Open [BotFather](https://t.me/BotFather), send `/newbot`, and choose a name and username. Paste the resulting bot token into the gathering’s Telegram settings. Use a dedicated bot: an existing webhook owned by another service is refused.
2. Choose **Choose a chat → Add to group**, select your group, then return and **Check connection**. Confirm the displayed chat before enabling anything. For a channel, add the bot with permission to post and send the displayed `/connect@bot code` command. For a forum topic, send that command inside the intended topic. Pairing codes expire after ten minutes and work once.
3. Enable **Mirror Bluesky announcements**. The gathering must be public and published, with activity posting enabled under Feed & network. Only successfully published Bluesky posts created after this switch was enabled are mirrored; connecting a bot never replays old activity. Changing chats switches mirroring off until you enable it again.
4. Optionally add the gathering’s AI provider key under **Knowledge**, then enable **Answer event questions**. This uses that same key and model; it never falls back to the deployment’s key. Set the daily question limit (1–1000, default 100, UTC day). Also set a spending limit with your model provider: a question limit is not a currency budget.

Participants use `/ask@YourBot question` in the selected chat or topic. This works with Telegram’s default privacy mode. Bare `@YourBot` mentions require the bot to receive those messages (for example, as a group admin); ordinary group chat is discarded even when Telegram sends it to the webhook. Channels support announcements; questions belong in a group or a private bot chat.

## Participant connection and privacy

Share `https://unconference.events/e/YOUR-SLUG/telegram`. **Connect my Telegram** makes a personal, single-use ten-minute link. Open it and press Start in Telegram. The app also exposes this connection on Ask and on the account panel’s Connections tab within the gathering.

- Public event answers may go to the configured group. Organizers can switch this off so all answers go privately.
- Transcript answers always go to the linked participant’s private bot chat. Both gathering and transcript must allow member access. Organizer-only transcripts are never read by the bot, even when the requester is an organizer.
- Private/unlisted gathering answers always go privately to a linked current member. Membership, account linking, transcript visibility, replacement and moderation are rechecked before delivery.
- Public context includes approved proposal descriptions and the published schedule projection: no exact addresses, attendee lists, ballot data or organizer notes. Transcript excerpts carry session links and source markers. The guide is read-only, has no action tools and no conversation memory. It identifies its answers as AI and may be mistaken.
- Questions and relevant sources go to the organizer’s chosen AI provider; answers go through Telegram. Hosted embeddings, if configured by the operator, also receive the search question; the default local embeddings stay on the server. The bot uses the existing embedding index; unembedded transcripts are unavailable until the knowledge job processes them.
- The app stores encrypted question/answer text only while delivery is pending, clearing it after delivery or terminal failure and purging question jobs within 24 hours. No ordinary chat history or attachments are retained. Telegram keeps delivered messages under its own policies.
- Disconnect from the app or send `/unlink` in a private bot chat. Removing a platform account cascades its Telegram links. No Telegram credentials or identities are ATProto records.

## MCP remains independent

The existing `/api/mcp` server continues to expose read-only, membership-scoped retrieval tools. Participants connect their own assistant through **Account → Connections** and pay for their own inference. Telegram is an optional organizer-funded convenience, not a replacement for MCP. Bot tokens and AI keys are separate credentials: the former authenticates Telegram delivery; the latter pays for the model.

## Delivery and operations

`0043_telegram.sql` creates five private, RLS-enabled tables with no anon/authenticated grants. Tokens use the existing `APP_SECRETS_KEY` AEAD envelope with event-specific associated data. The Telegram webhook checks a random secret in `X-Telegram-Bot-Api-Secret-Token`; only its hash is stored. Request bodies are capped at 32 KiB. Updates older than ten minutes, duplicates, other bots and undirected chat are ignored. Per-user admission is capped at three requests per minute, with a serialized per-gathering daily inference limit.

The verified webhook persists jobs before acknowledging Telegram. Only one delivery per bot runs at a time, so webhook bursts cannot fan out inference. Next.js `after()` attempts immediate delivery; the authenticated `/api/jobs/telegram` scheduler route recovers pending jobs each minute. The outbox also harvests successfully posted Bluesky activity. A new bot starts with announcements and answers off.

Explicit Telegram rate limits retry up to four attempts. An interrupted or ambiguous send is marked **uncertain**, because `sendMessage` has no idempotency key. It is never automatically replayed. Recent announcement failures appear in organizer settings, with a manual retry that asks the organizer to check the chat first. Revoking a bot token may require reconnecting it. Disconnect disables local delivery before removing the webhook and encrypted credential.

Deleted Bluesky posts enqueue best-effort Telegram deletion. Making a gathering private also queues removal of known mirrored messages. Telegram permissions and deletion time limits may prevent removal; the organizer ledger reports failures. Disconnecting the integration leaves already delivered messages in Telegram.

## Verification

`npx playwright test tests/telegram.spec.ts --workers=1 --retries=0` uses isolated gatherings and a fake Telegram API; it never posts to a real bot. It covers authorization, secret storage, one-time linking, duplicate delivery, historical replay prevention, rate-limit and ambiguous-send recovery, retrieval privacy, revoked membership, daily limits and responsive setup. Knowledge provider adapters and MCP have their own integration suites.

A live acceptance test still requires an organizer-owned bot and an explicitly approved destination: connect it, confirm the group, enable future announcements, then verify an authorized new activity post and a participant question. Do not trigger event phase changes merely to test delivery on a live gathering.

Telegram references: [Bot API and webhook authentication](https://core.telegram.org/bots/api), [deep linking and privacy mode](https://core.telegram.org/bots/features).
