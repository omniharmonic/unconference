import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { sql } from '@/lib/db'
import { seal, open, secretsAvailable } from '@/lib/secrets/aead'
import { publicUrl } from '@/lib/atproto/config'
import { eventChatConfig } from '@/lib/knowledge/chat-provider'
import { telegramApi, TelegramError, type TelegramApi } from './api'
import type { TelegramBot } from './types'

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex')
export const randomToken = () => randomBytes(24).toString('base64url')
export const botToken = (bot: TelegramBot) => open(bot.token_ciphertext, `telegram:${bot.event_id}`)
export const webhookUrl = (eventId: string) => `${publicUrl()}/api/telegram/${eventId}`
export async function loadBot(eventId: string): Promise<TelegramBot | null> {
  const [bot] = await sql<TelegramBot[]>`select * from telegram_bots where event_id=${eventId}`
  return bot ?? null
}

export async function connectBot(eventId: string, accountId: string, token: string, api: TelegramApi = telegramApi) {
  if (!secretsAvailable()) throw new TelegramError('Encrypted secret storage is not configured')
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new TelegramError('Paste the bot token from BotFather')
  const me = await api<{ id: number; is_bot: boolean; username?: string }>(token, 'getMe')
  if (!me.is_bot || !Number.isSafeInteger(me.id) || me.id<=0 || !me.username || !/^[A-Za-z0-9_]{5,32}$/.test(me.username)) throw new TelegramError('Telegram did not return a valid bot identity')
  const username = me.username
  const webhook = await api<{ url: string }>(token, 'getWebhookInfo')
  if (webhook.url && webhook.url !== webhookUrl(eventId)) throw new TelegramError('This bot is already connected elsewhere. Use a dedicated bot for this gathering.')
  const secret = randomToken()
  await sql.begin(async t => {
    await t`select pg_advisory_xact_lock(hashtext(${`telegram:${eventId}`}))`
    const [other] = await t`select event_id from telegram_bots where bot_id=${String(me.id)} and event_id<>${eventId}`
    if (other) throw new TelegramError('This bot already belongs to another gathering')
    const [existing] = await t`select bot_id from telegram_bots where event_id=${eventId}`
    if (existing && existing.bot_id !== String(me.id)) throw new TelegramError('Disconnect the current bot before replacing it')
    await t`insert into telegram_bots(event_id,bot_id,username,token_ciphertext,webhook_secret_hash,configured_by)
      values(${eventId},${String(me.id)},${username},${seal(token, `telegram:${eventId}`)},${hashToken(secret)},${accountId})
      on conflict(event_id) do update set token_ciphertext=excluded.token_ciphertext,webhook_secret_hash=excluded.webhook_secret_hash,
        username=excluded.username,configured_by=excluded.configured_by,updated_at=now()`
    await api(token, 'setWebhook', { url: webhookUrl(eventId), secret_token: secret, allowed_updates: ['message','channel_post'], max_connections: 2 })
    await t`update telegram_bots set ready=true where event_id=${eventId}`
  })
}

export async function settingsState(eventId: string) {
  const bot = await loadBot(eventId)
  const [event] = await sql`select visibility,status,feed_posts from events where id=${eventId}`
  const key = await eventChatConfig(eventId)
  const recent = bot ? await sql`select id,kind,status,error,created_at,updated_at from telegram_jobs
    where connection_id=${bot.id} and kind in ('announcement','retract') order by created_at desc limit 12` : []
  const [usage] = await sql`select used from telegram_budgets where event_id=${eventId} and scope='event-day' and window_start=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`
  return {
    secrets_configured: secretsAvailable(),
    bot: bot ? { username: bot.username, ready: bot.ready, chat_id: bot.chat_id, chat_title: bot.chat_title, chat_type: bot.chat_type,
      thread_id: bot.thread_id, pending_chat: bot.pending_chat, announcements: bot.announcements, ask_enabled: bot.ask_enabled,
      group_answers: bot.group_answers, daily_limit: bot.daily_limit } : null,
    announcements_available: event?.visibility === 'public' && event?.status !== 'draft' && event?.feed_posts === true,
    ai_configured: !!key, ai_model: key?.model ?? null, questions_today: usage?.used ?? 0, recent,
  }
}

export async function issuePairing(eventId: string) {
  const token = randomToken()
  const [bot] = await sql`update telegram_bots set pairing_hash=${hashToken(token)},pairing_expires_at=now()+interval '10 minutes',pending_chat=null
    where event_id=${eventId} and ready returning username`
  if (!bot) throw new TelegramError('Connect a bot first')
  return { group_url: `https://t.me/${bot.username}?startgroup=setup_${token}`, command: `/connect@${bot.username} ${token}` }
}

export async function confirmChat(eventId: string, chatId: string, api: TelegramApi = telegramApi) {
  const bot = await loadBot(eventId)
  const pending = bot?.pending_chat
  if (!bot || !pending || pending.id !== chatId) throw new TelegramError('Choose the chat that just connected, then confirm it')
  const member = await api<{ status: string; can_post_messages?: boolean }>(botToken(bot), 'getChatMember', { chat_id: pending.id, user_id: Number(bot.bot_id) })
  if (['left','kicked','restricted'].includes(member.status) || (pending.type === 'channel' && member.can_post_messages !== true)) throw new TelegramError('Give the bot permission to post in this chat, then try again')
  // A new destination starts a new timeline: never replay the old destination's announcements.
  await sql.begin(async t => {
    const changed = await t`update telegram_bots set chat_id=${pending.id},chat_title=${pending.title},chat_type=${pending.type},thread_id=${pending.thread_id},
      pending_chat=null,pairing_hash=null,pairing_expires_at=null,announcements=false,announcements_since=null,updated_at=now()
      where event_id=${eventId} and pending_chat->>'id'=${chatId} returning id`
    if (!changed.length) throw new TelegramError('The pending chat changed. Refresh and confirm it again.')
    await t`update telegram_jobs set status='skipped',question_ciphertext=null,response_ciphertext=null,updated_at=now()
      where event_id=${eventId} and status='queued' and account_id is null`
  })
}

export async function updateBot(eventId: string, body: Record<string, unknown>) {
  if (typeof body.announcements !== 'boolean' || typeof body.ask_enabled !== 'boolean' || typeof body.group_answers !== 'boolean'
      || !Number.isInteger(body.daily_limit) || Number(body.daily_limit) < 1 || Number(body.daily_limit) > 1000) throw new TelegramError('Choose valid switches and a daily question limit from 1 to 1000')
  const bot = await loadBot(eventId)
  if (!bot?.ready || !bot.chat_id) throw new TelegramError('Connect and confirm a chat first')
  if (body.ask_enabled && !await eventChatConfig(eventId)) throw new TelegramError('Configure this gathering’s AI key in Knowledge before enabling answers')
  await sql`update telegram_bots set announcements_since=case when ${body.announcements} and not announcements then now() else announcements_since end,
    announcements=${body.announcements},ask_enabled=${body.ask_enabled},group_answers=${body.group_answers},daily_limit=${Number(body.daily_limit)},updated_at=now()
    where event_id=${eventId}`
}

export async function disconnectBot(eventId: string, api: TelegramApi = telegramApi) {
  const bot = await loadBot(eventId)
  if (!bot) return
  // Stop local delivery before touching the remote hook. A failed removal can be retried safely.
  await sql`update telegram_bots set ready=false,announcements=false,ask_enabled=false where event_id=${eventId}`
  try {
    const token = botToken(bot)
    const hook = await api<{ url: string }>(token, 'getWebhookInfo')
    if (hook.url === webhookUrl(eventId)) await api(token, 'deleteWebhook')
  } catch (error) {
    // Revoked tokens no longer have a usable webhook; still let the organizer remove the local credential.
    if (!(error instanceof TelegramError) || !error.code.startsWith('Bot token was refused')) throw error
  }
  await sql`delete from telegram_bots where event_id=${eventId} and id=${bot.id}`
}
