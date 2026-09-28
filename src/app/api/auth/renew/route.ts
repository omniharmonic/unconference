import { assertSameOrigin, requireViewer } from '@/lib/auth/viewer'
import { sql } from '@/lib/db'
import { AT_SESSION_TTL_MS, readSessionCookieValue, sessionCookieHeader } from '@/lib/atproto/session'

export const dynamic = 'force-dynamic'

/** Renew an active session only. Expired and revoked sessions cannot be resurrected. */
export async function POST(request: Request) {
  const denied = assertSameOrigin(request)
  if (denied) return denied
  const viewer = await requireViewer(request)
  if (viewer instanceof Response) return viewer
  // At most one database write per day, even across tabs. Keep the browser's expiry
  // aligned with the row rather than extending a cookie past its server-side session.
  const [row] = await sql<{ expires_at: string }[]>`
    update at_sessions set expires_at = now() + ${AT_SESSION_TTL_MS} * interval '1 millisecond'
    where id = ${viewer.sessionId} and expires_at > now()
      and expires_at < now() + ${AT_SESSION_TTL_MS - 86400_000} * interval '1 millisecond'
    returning expires_at
  `
  const current = row ?? (await sql<{ expires_at: string }[]>`
    select expires_at from at_sessions where id = ${viewer.sessionId} and expires_at > now()
  `)[0]
  if (!current) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
  const seconds = Math.max(0, Math.floor((new Date(current.expires_at).getTime() - Date.now()) / 1000))
  return new Response(null, { status: 204, headers: {
    'Cache-Control': 'private, no-store',
    'Set-Cookie': sessionCookieHeader(readSessionCookieValue(request)!, seconds),
  } })
}
