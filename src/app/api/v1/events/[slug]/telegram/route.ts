import { assertSameOrigin } from '@/lib/auth/viewer'
import { json, jsonError, loadEventAccess } from '@/app/api/v1/sessions/_lib/access'
import { hashToken, randomToken } from '@/lib/telegram/settings'
import { sql } from '@/lib/db'

type Params = { params: Promise<{ slug: string }> }
async function access(request: Request, params: Params['params']) {
  const gate = await loadEventAccess(request,(await params).slug)
  if (gate instanceof Response) return gate
  if (!gate.viewer) return jsonError(401,'Sign in to connect Telegram')
  if (!gate.role) return jsonError(403,'Join this gathering to connect Telegram')
  return { event:gate.event, viewer:gate.viewer }
}
export async function GET(request: Request, { params }: Params) {
  const gate = await access(request,params)
  if (gate instanceof Response) return gate
  const [bot] = await sql`select username from telegram_bots where event_id=${gate.event.id} and ready and ask_enabled`
  const [link] = await sql`select linked_at from telegram_links where event_id=${gate.event.id} and account_id=${gate.viewer.accountId}`
  return json({ available:!!bot, username:bot?.username ?? null, linked:!!link })
}
export async function POST(request: Request, { params }: Params) {
  const bad = assertSameOrigin(request)
  if (bad) return bad
  const gate = await access(request,params)
  if (gate instanceof Response) return gate
  const [bot] = await sql`select username from telegram_bots where event_id=${gate.event.id} and ready and ask_enabled`
  if (!bot) return jsonError(409,'This gathering’s Telegram assistant is not enabled')
  const token = randomToken()
  await sql`insert into telegram_link_tokens(token_hash,event_id,account_id,expires_at)
    values(${hashToken(token)},${gate.event.id},${gate.viewer.accountId},now()+interval '10 minutes')
    on conflict(event_id,account_id) do update set token_hash=excluded.token_hash,expires_at=excluded.expires_at`
  return json({ url:`https://t.me/${bot.username}?start=link_${token}` })
}
export async function DELETE(request: Request, { params }: Params) {
  const bad = assertSameOrigin(request)
  if (bad) return bad
  const gate = await access(request,params)
  if (gate instanceof Response) return gate
  await sql.begin(async t => {
    await t`delete from telegram_links where event_id=${gate.event.id} and account_id=${gate.viewer.accountId}`
    await t`delete from telegram_link_tokens where event_id=${gate.event.id} and account_id=${gate.viewer.accountId}`
    await t`update telegram_jobs set status='skipped',question_ciphertext=null,response_ciphertext=null,updated_at=now()
      where event_id=${gate.event.id} and account_id=${gate.viewer.accountId} and status in ('queued','processing')`
  })
  return json({ linked:false })
}
