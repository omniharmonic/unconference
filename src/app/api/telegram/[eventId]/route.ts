import { timingSafeEqual } from 'node:crypto'
import { after } from 'next/server'
import { isUuid, json } from '@/app/api/v1/sessions/_lib/access'
import { loadBot, hashToken } from '@/lib/telegram/settings'
import { acceptUpdate } from '@/lib/telegram/inbound'
import { runTelegramJobs } from '@/lib/telegram/jobs'
import type { TelegramUpdate } from '@/lib/telegram/types'

export const runtime = 'nodejs'
export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params
  if (!isUuid(eventId)) return new Response(null,{ status:404 })
  const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!/^[A-Za-z0-9_-]{32}$/.test(secret)) return new Response(null,{ status:404 })
  const bot = await loadBot(eventId)
  if (!bot?.ready || !timingSafeEqual(Buffer.from(hashToken(secret),'hex'),Buffer.from(bot.webhook_secret_hash,'hex'))) return new Response(null,{ status:404 })
  // Telegram authenticates this external webhook; browser Origin/session checks do not apply.
  const reader = request.body?.getReader()
  if (!reader) return new Response(null,{ status:400 })
  let size=0, raw=''
  const decoder = new TextDecoder()
  while (true) {
    const { done,value } = await reader.read()
    if (done) break
    size += value.length
    if (size>32_768) { await reader.cancel(); return new Response(null,{ status:413 }) }
    raw += decoder.decode(value,{ stream:true })
  }
  let update: TelegramUpdate
  try {
    update=JSON.parse(raw+decoder.decode())
    if (!update || typeof update!=='object' || Array.isArray(update)) return new Response(null,{ status:400 })
  } catch { return new Response(null,{ status:400 }) }
  await acceptUpdate(bot,update)
  after(async () => { try { await runTelegramJobs({ eventId,limit:2 }) } catch { console.error('[telegram] deferred delivery failed; scheduler will retry') } })
  return json({ ok:true })
}
