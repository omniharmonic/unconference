import 'server-only'
import { sql } from '@/lib/db'
import { seal } from '@/lib/secrets/aead'
import { publicUrl } from '@/lib/atproto/config'
import { hashToken } from './settings'
import type { TelegramBot, TelegramMessage, TelegramUpdate } from './types'

export function addressedQuestion(message: TelegramMessage, bot: Pick<TelegramBot,'username'|'bot_id'>): string | null {
  if (!message.text || message.from?.is_bot) return null
  const name = bot.username.toLowerCase()
  const text = message.text.trim()
  const command = /^\/ask(?:@([a-z0-9_]+))?(?:\s+|$)/i.exec(text)
  if (command?.[1] && command[1].toLowerCase() !== name) return null
  const mention = new RegExp(`(^|\\s)@${name}(?=\\s|[,:?!]|$)`, 'ig')
  const directed = message.chat.type === 'private' || !!command || mention.test(text) || String(message.reply_to_message?.from?.id) === bot.bot_id
  if (!directed || (text.startsWith('/') && !command)) return null
  const question = text.replace(command?.[0] ?? /^$/, '').replace(mention, ' ').replace(/\s+/g, ' ').trim()
  return question.length >= 3 && question.length <= 1000 ? question : null
}

function validMessage(update: TelegramUpdate): TelegramMessage | null {
  const m = update.message ?? update.channel_post
  if (!Number.isSafeInteger(update.update_id) || !m || !Number.isSafeInteger(m.message_id) || !m.chat || !Number.isSafeInteger(m.chat.id)
    || !['private','group','supergroup','channel'].includes(m.chat.type) || typeof m.text !== 'string' || m.text.length > 4096
    || (m.chat.title !== undefined && typeof m.chat.title !== 'string')
    || !Number.isFinite(m.date) || Math.abs(Date.now()/1000-m.date) > 600
    || (m.message_thread_id !== undefined && !Number.isSafeInteger(m.message_thread_id))) return null
  if (m.from && (!Number.isSafeInteger(m.from.id) || m.from.id <= 0 || m.from.is_bot)) return null
  return m
}

/** Store only directed requests. Ordinary chat, attachments, names, and conversation history are discarded. */
export async function acceptUpdate(bot: TelegramBot, update: TelegramUpdate): Promise<void> {
  const m = validMessage(update)
  if (!m) return
  const chatId = String(m.chat.id)
  const userId = m.from ? String(m.from.id) : null
  const privateChat = m.chat.type === 'private' && userId === chatId
  const command = /^\/(start|connect)(?:@([a-z0-9_]+))?\s+(?:(setup|link)_)?([A-Za-z0-9_-]{32})$/i.exec(m.text!.trim())
  if (command && (!command[2] || command[2].toLowerCase() === bot.username.toLowerCase())) {
    const tokenHash = hashToken(command[4])
    if (!privateChat && ['group','supergroup','channel'].includes(m.chat.type) && command[3] !== 'link') {
      const pending = { id: chatId, title: (m.chat.title || 'Telegram chat').slice(0,200), type: m.chat.type, thread_id: m.message_thread_id ?? null }
      await sql`update telegram_bots set pending_chat=${sql.json(pending)},pairing_hash=null,pairing_expires_at=null,updated_at=now()
        where id=${bot.id} and ready and pairing_hash=${tokenHash} and pairing_expires_at>now()`
      return
    }
    if (privateChat && command[3] === 'link') {
      await sql.begin(async t => {
        const [token] = await t`delete from telegram_link_tokens where token_hash=${tokenHash} and event_id=${bot.event_id} and expires_at>now() returning account_id`
        if (!token) return
        const [member] = await t`select role from event_members where event_id=${bot.event_id} and user_id=${token.account_id}`
        if (!member) return
        await t`delete from telegram_links where event_id=${bot.event_id} and (account_id=${token.account_id} or telegram_user_id=${userId})`
        await t`insert into telegram_links(event_id,telegram_user_id,account_id,private_chat_id) values(${bot.event_id},${userId!},${token.account_id},${chatId})`
        await t`insert into telegram_jobs(event_id,connection_id,kind,update_id,chat_id,account_id,telegram_user_id,response_ciphertext)
          values(${bot.event_id},${bot.id},'notice',${update.update_id},${chatId},${token.account_id},${userId},
            ${seal('Connected. Ask me about this gathering, its sessions, or what came up in the member-visible transcripts. Use /unlink to disconnect.', `telegram-message:${bot.event_id}`)})
          on conflict do nothing`
      })
      return
    }
  }
  if (!userId) return // channel posts are for pairing and announcements, never participant questions
  if (privateChat && /^\/unlink(?:@[a-z0-9_]+)?$/i.test(m.text!.trim())) {
    await sql.begin(async t => {
      await t`delete from telegram_links where event_id=${bot.event_id} and telegram_user_id=${userId}`
      await t`update telegram_jobs set status='skipped',question_ciphertext=null,response_ciphertext=null where connection_id=${bot.id} and telegram_user_id=${userId} and status='queued'`
    })
    return
  }
  if (!bot.ask_enabled) return
  const inDestination = chatId === bot.chat_id && (bot.thread_id === null || m.message_thread_id === bot.thread_id)
  if (!privateChat && !inDestination) return
  const question = addressedQuestion(m, bot)
  const start = privateChat && /^\/(start|help)(?:@[a-z0-9_]+)?$/i.test(m.text!.trim())
  if (!question && !start) return
  const [event] = await sql`select slug,status,visibility from events where id=${bot.event_id}`
  if (!event || event.status === 'draft') return
  const [link] = await sql`select l.account_id from telegram_links l join event_members m on m.event_id=l.event_id and m.user_id=l.account_id
    where l.event_id=${bot.event_id} and l.telegram_user_id=${userId}`
  if (!privateChat && event.visibility !== 'public' && !link) return
  const connectUrl = `${publicUrl()}/e/${event.slug}/telegram`
  const notice = !link && (privateChat || !bot.group_answers || event.visibility !== 'public')
    ? `Connect your gathering account to ask privately about sessions and transcripts: ${connectUrl}`
    : start ? `Ask a question here, or use /ask@${bot.username} in the gathering’s chat. Transcript answers stay private. ${connectUrl}` : null
  await sql.begin(async t => {
    // Serialize admission per bot: duplicate webhook deliveries and budget races cannot charge twice.
    const [current] = await t`select ready,ask_enabled,daily_limit from telegram_bots where id=${bot.id} for update`
    if (!current?.ready || !current.ask_enabled) return
    const [seen] = await t`select id from telegram_jobs where connection_id=${bot.id} and update_id=${update.update_id}`
    if (seen) return
    const day = new Date().toISOString().slice(0,10)+'T00:00:00Z'
    const minute = new Date(Math.floor(Date.now()/60_000)*60_000).toISOString()
    const scopes = [{ scope: `user:${userId}`, at: minute, limit: 3 }, ...(!notice ? [{ scope: 'event-day', at: day, limit: current.daily_limit }] : [])]
    let limited = false
    for (const b of scopes) {
      const [used] = await t`select used from telegram_budgets where event_id=${bot.event_id} and scope=${b.scope} and window_start=${b.at}`
      if (used && used.used >= b.limit) {
        if (b.scope !== 'event-day') return
        limited = true
      }
    }
    for (const b of scopes.filter(b => !limited || b.scope !== 'event-day')) await t`insert into telegram_budgets(event_id,scope,window_start) values(${bot.event_id},${b.scope},${b.at})
      on conflict(event_id,scope,window_start) do update set used=telegram_budgets.used+1`
    const response = limited ? 'This gathering’s Telegram question limit has been reached for today. It resets at midnight UTC. You can still browse the schedule or use your own assistant through MCP.' : notice
    await t`insert into telegram_jobs(event_id,connection_id,kind,update_id,chat_id,thread_id,reply_to,source_chat_id,source_thread_id,telegram_user_id,account_id,question_ciphertext,response_ciphertext)
      values(${bot.event_id},${bot.id},${response ? 'notice':'question'},${update.update_id},${chatId},${m.message_thread_id ?? null},${m.message_id},
        ${chatId},${m.message_thread_id ?? null},${userId},${link?.account_id ?? null},
        ${response ? null:seal(question!,`telegram-message:${bot.event_id}`)},${response ? seal(response,`telegram-message:${bot.event_id}`):null})`
  })
}
