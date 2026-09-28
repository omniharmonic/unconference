import { assertSameOrigin, requireEventRole } from '@/lib/auth/viewer'
import { json, jsonError, readJsonObject, isUuid } from '@/app/api/v1/sessions/_lib/access'
import { connectBot, settingsState, issuePairing, confirmChat, updateBot, disconnectBot } from '@/lib/telegram/settings'
import { safeTelegramError } from '@/lib/telegram/api'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'
type Params = { params: Promise<{ slug: string }> }
export async function GET(request: Request, { params }: Params) {
  const gate = await requireEventRole(request, (await params).slug, ['owner','admin'])
  if (gate instanceof Response) return gate
  return json(await settingsState(gate.event.id))
}
export async function POST(request: Request, { params }: Params) {
  const bad = assertSameOrigin(request)
  if (bad) return bad
  const gate = await requireEventRole(request, (await params).slug, ['owner','admin'])
  if (gate instanceof Response) return gate
  const body = await readJsonObject(request)
  if (body instanceof Response) return body
  try {
    const id = gate.event.id
    switch (body.action) {
      case 'connect':
        if (typeof body.token !== 'string' || body.token.length>150) return jsonError(400,'Paste the bot token from BotFather')
        await connectBot(id, gate.viewer.accountId, body.token.trim()); break
      case 'pair': return json(await issuePairing(id))
      case 'confirm':
        if (typeof body.chat_id !== 'string' || !/^-?\d{1,20}$/.test(body.chat_id)) return jsonError(400,'Choose a chat')
        await confirmChat(id,body.chat_id); break
      case 'save': await updateBot(id,body); break
      case 'disconnect': await disconnectBot(id); break
      case 'retry':
        if (!isUuid(body.job_id)) return jsonError(400,'Choose a delivery')
        if (body.confirmed !== true) return jsonError(400,'Check Telegram for an existing post before retrying')
        await sql`update telegram_jobs set status='queued',attempts=0,error=null,run_after=now(),updated_at=now()
          where id=${body.job_id} and event_id=${id} and kind in ('announcement','retract') and status in ('failed','uncertain')`; break
      default: return jsonError(400,'Unknown action')
    }
    return json(await settingsState(id))
  } catch (error) { return jsonError(400,safeTelegramError(error)) }
}
