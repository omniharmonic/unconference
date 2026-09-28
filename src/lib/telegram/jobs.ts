import 'server-only'
import { sql } from '@/lib/db'
import { open, seal } from '@/lib/secrets/aead'
import { telegramApi, TelegramError, safeTelegramError, type TelegramApi } from './api'
import { botToken, loadBot } from './settings'
import { answerQuestion, linkedMember, sourcesReadable, type BotAnswer } from './answer'
import type { TelegramJob } from './types'

/** Harvest only successfully published Bluesky posts created after Telegram was enabled. */
export async function harvestAnnouncements() {
  await sql`insert into telegram_jobs(event_id,connection_id,kind,feed_post_id,chat_id,thread_id)
    select b.event_id,b.id,'announcement',f.id,b.chat_id,b.thread_id from telegram_bots b
    join events e on e.id=b.event_id join feed_posts f on f.event_id=b.event_id
    where b.ready and b.announcements and b.chat_id is not null and e.visibility='public' and e.status<>'draft' and e.feed_posts
      and f.status='posted' and f.created_at>=b.announcements_since and f.text is not null
      and (f.subject_id is null or exists(select 1 from sessions s where s.id=f.subject_id and s.event_id=b.event_id and not coalesce(s.hidden_by_moderation,false)))
    on conflict do nothing`
  await sql`insert into telegram_jobs(event_id,connection_id,kind,feed_post_id,chat_id,thread_id,message_id)
    select j.event_id,j.connection_id,'retract',j.feed_post_id,j.chat_id,j.thread_id,j.message_id from telegram_jobs j
    join feed_posts f on f.id=j.feed_post_id join events e on e.id=j.event_id
    where j.kind='announcement' and j.status='sent' and j.message_id is not null
      and (f.status='deleted' or e.visibility<>'public' or e.status='draft'
        or (f.subject_id is not null and not exists(select 1 from sessions s where s.id=f.subject_id and s.event_id=e.id and not coalesce(s.hidden_by_moderation,false)))) on conflict do nothing`
}

export function announcementText(post: { text: string; mentions: unknown; embed: unknown }) {
  let text = post.text
  if (Array.isArray(post.mentions)) for (const mention of post.mentions) {
    if (typeof mention?.handle === 'string') text = text.split('@'+mention.handle).join(mention.handle)
  }
  // Telegram handles are unrelated identities. Never turn an ATProto handle into a Telegram ping.
  text = text.replace(/(^|\s)@(?=[A-Za-z0-9_])/g, '$1')
  const uri = (post.embed as { external?: { uri?: unknown } } | null)?.external?.uri
  if (typeof uri === 'string' && uri.startsWith('https://') && !text.includes(uri)) text += '\n\n'+uri
  return text.slice(0,4096)
}

async function skip(id: string) {
  await sql`update telegram_jobs set status='skipped',question_ciphertext=null,response_ciphertext=null,updated_at=now() where id=${id}`
}

export async function deliverJob(job: TelegramJob, api: TelegramApi = telegramApi, answer = answerQuestion) {
  let sending = false
  try {
    let bot = await loadBot(job.event_id)
    if (!bot?.ready || bot.id !== job.connection_id) return await skip(job.id)
    const [event] = await sql`select visibility,status,feed_posts from events where id=${job.event_id}`
    if (!event) return await skip(job.id)
    let text = '', chatId = job.chat_id, threadId = job.thread_id, replyTo = job.reply_to
    let generated: BotAnswer | null = null
    if (job.kind === 'announcement') {
      if (!bot.announcements || event.visibility !== 'public' || event.status === 'draft' || !event.feed_posts
        || bot.chat_id !== chatId || bot.thread_id !== threadId) return await skip(job.id)
      const [post] = await sql`select text,mentions,embed,status,created_at from feed_posts f where id=${job.feed_post_id} and event_id=${job.event_id}
        and (f.subject_id is null or exists(select 1 from sessions s where s.id=f.subject_id and s.event_id=f.event_id and not coalesce(s.hidden_by_moderation,false)))`
      if (!post || post.status !== 'posted' || !post.text || !bot.announcements_since || Date.parse(post.created_at) < Date.parse(bot.announcements_since)) return await skip(job.id)
      text = announcementText(post as { text: string; mentions: unknown; embed: unknown })
    } else if (job.kind !== 'retract') {
      if (!bot.ask_enabled || event.status === 'draft') return await skip(job.id)
      const member = await linkedMember(job)
      if ((job.account_id && !member) || (event.visibility !== 'public' && !member)) return await skip(job.id)
      if (job.source_chat_id && job.source_chat_id !== job.telegram_user_id &&
        (bot.chat_id !== job.source_chat_id || (bot.thread_id !== null && bot.thread_id !== job.source_thread_id))) return await skip(job.id)
      if (job.kind === 'question') {
        try { generated = await answer(bot, job) }
        catch { generated = { text: 'I couldn’t answer just now. Please try again later, or open Ask in the gathering.', private: !!member, chunks: [] } }
        text = generated.text
        if (generated.private) {
          if (!member) return await skip(job.id)
          chatId = member.private_chat_id; threadId = null; replyTo = chatId === job.chat_id ? replyTo : null
        }
      } else if (job.response_ciphertext) {
        text = open(job.response_ciphertext, `telegram-message:${job.event_id}`)
        if (event.visibility !== 'public' && member) {
          chatId = member.private_chat_id; threadId = null; replyTo = chatId === job.chat_id ? replyTo : null
        }
      }
      if (!text) return await skip(job.id)
      // Generation may take time. Re-read the link, source permissions, switch and destination before sending.
      bot = await loadBot(job.event_id)
      const [current] = await sql`select visibility,status from events where id=${job.event_id}`
      if (!bot?.ready || !bot.ask_enabled || bot.id !== job.connection_id || !current || current.status==='draft') return await skip(job.id)
      if (job.account_id && !await linkedMember(job)) return await skip(job.id)
      if (generated && !await sourcesReadable(job.event_id, generated.chunks)) return await skip(job.id)
      if (chatId !== job.telegram_user_id && (current.visibility !== 'public' || !bot.group_answers || bot.chat_id !== chatId || (bot.thread_id !== null && threadId !== bot.thread_id))) {
        // Notices may invite a private connection even with group answers disabled, but never reveal private data.
        if (job.kind !== 'notice' || current.visibility !== 'public' || bot.chat_id !== chatId) return await skip(job.id)
      }
    }
    const [claimed] = await sql`update telegram_jobs set status='sending',updated_at=now() where id=${job.id} and status='processing' returning id`
    if (!claimed) return
    sending = true
    if (job.kind === 'retract') {
      await api(botToken(bot), 'deleteMessage', { chat_id: chatId, message_id: Number(job.message_id) })
      await sql`update telegram_jobs set status='sent',error=null,updated_at=now() where id=${job.id}`
      return
    }
    const result = await api<{ message_id: number }>(botToken(bot), 'sendMessage', {
      chat_id: chatId, text, ...(threadId !== null ? { message_thread_id: threadId } : {}),
      ...(replyTo !== null ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      link_preview_options: { is_disabled: true },
    })
    if (!Number.isSafeInteger(result.message_id)) throw new TelegramError('Telegram did not confirm a message id', 0, true)
    await sql.begin(async t => {
      await t`update telegram_jobs set status='sent',message_id=${result.message_id},question_ciphertext=null,response_ciphertext=null,error=null,updated_at=now() where id=${job.id}`
      if (job.kind === 'question' && chatId !== job.chat_id) {
        await t`insert into telegram_jobs(event_id,connection_id,kind,chat_id,thread_id,reply_to,source_chat_id,source_thread_id,parent_id,telegram_user_id,account_id,response_ciphertext)
          values(${job.event_id},${job.connection_id},'notice',${job.chat_id},${job.thread_id},${job.reply_to},${job.source_chat_id},${job.source_thread_id},${job.id},${job.telegram_user_id},${job.account_id},
            ${seal('I sent you a private answer. Open our chat to read it.',`telegram-message:${job.event_id}`)}) on conflict do nothing`
      }
    })
  } catch (error) {
    const uncertain = sending && (!(error instanceof TelegramError) || error.uncertain)
    const retry = error instanceof TelegramError && error.retryAfter > 0 && job.attempts < 4
    const status = uncertain ? 'uncertain' : retry ? 'queued' : 'failed'
    await sql`update telegram_jobs set status=${status},error=${safeTelegramError(error)},
      run_after=now()+${retry ? (error as TelegramError).retryAfter : 0}*interval '1 second',updated_at=now(),
      question_ciphertext=case when ${status==='queued'} then question_ciphertext else null end,
      response_ciphertext=case when ${status==='queued'} then response_ciphertext else null end where id=${job.id}`
    if (sending && status==='failed' && job.kind==='question' && job.account_id && job.source_chat_id !== job.telegram_user_id) {
      await sql`insert into telegram_jobs(event_id,connection_id,kind,chat_id,thread_id,reply_to,source_chat_id,source_thread_id,parent_id,telegram_user_id,account_id,response_ciphertext)
        values(${job.event_id},${job.connection_id},'notice',${job.chat_id},${job.thread_id},${job.reply_to},${job.source_chat_id},${job.source_thread_id},${job.id},${job.telegram_user_id},${job.account_id},
          ${seal('I couldn’t deliver the answer. Open our private bot chat, press Start or unblock the bot, then ask again.',`telegram-message:${job.event_id}`)}) on conflict do nothing`
    }
  }
}

export async function runTelegramJobs(options: { limit?: number; api?: TelegramApi; answer?: typeof answerQuestion; eventId?: string } = {}) {
  await harvestAnnouncements()
  // A send interrupted after the API call might already be visible. Never replay it automatically.
  await sql`update telegram_jobs set status='uncertain',error='Delivery was interrupted; check Telegram before retrying',question_ciphertext=null,response_ciphertext=null,updated_at=now()
    where status='sending' and updated_at<now()-interval '5 minutes'`
  await sql`update telegram_jobs set status=case when attempts<3 then 'queued' else 'failed' end,
    question_ciphertext=case when attempts<3 then question_ciphertext else null end,
    response_ciphertext=case when attempts<3 then response_ciphertext else null end,updated_at=now()
    where status='processing' and updated_at<now()-interval '5 minutes'`
  await sql`delete from telegram_link_tokens where expires_at<now()`
  await sql`delete from telegram_budgets where window_start<now()-interval '2 days'`
  await sql`delete from telegram_jobs where kind in ('question','notice') and created_at<now()-interval '24 hours'`
  let processed = 0
  const started = Date.now()
  while (processed < (options.limit ?? 5) && Date.now()-started < 45_000) {
    const job = await sql.begin(async t => {
      // One in-flight delivery per bot: webhook bursts must not fan out paid inference or
      // reorder announcements. Lock the bot only while claiming, never during network work.
      const [connection] = await t`select b.id from telegram_bots b join telegram_jobs j on j.connection_id=b.id
        where b.ready and j.status='queued' and j.run_after<=now()
          ${options.eventId ? sql`and b.event_id=${options.eventId}` : sql``}
          and not exists(select 1 from telegram_jobs active where active.connection_id=b.id and active.status in ('processing','sending'))
        order by j.created_at for update of b skip locked limit 1`
      if (!connection) return null
      // A fresh statement snapshot closes the race with a claim committed just before our lock.
      const [active] = await t`select id from telegram_jobs where connection_id=${connection.id} and status in ('processing','sending') limit 1`
      if (active) return null
      const [claimed] = await t<TelegramJob[]>`update telegram_jobs set status='processing',attempts=attempts+1,updated_at=now()
        where id=(select id from telegram_jobs where connection_id=${connection.id} and status='queued' and run_after<=now()
          order by created_at for update skip locked limit 1) returning *`
      return claimed ?? null
    })
    if (!job) break
    await deliverJob(job, options.api, options.answer)
    processed++
  }
  return { processed }
}
