import 'server-only'

export class TelegramError extends Error {
  constructor(public readonly code: string, public readonly retryAfter = 0, public readonly uncertain = false) {
    super(code)
    this.name = 'TelegramError'
  }
}
export type TelegramApi = <T>(token: string, method: string, body?: Record<string, unknown>) => Promise<T>

/** Fixed Telegram origin, no redirects, and sanitized errors: tokens occur in Telegram's URL. */
export const telegramApi: TelegramApi = async <T>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> => {
  if (!/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) throw new TelegramError('Invalid bot token')
  let origin = 'https://api.telegram.org'
  const testOrigin = process.env.TELEGRAM_TEST_API_ORIGIN
  if (process.env.NODE_ENV !== 'production' && testOrigin) {
    const url = new URL(testOrigin)
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/' || url.search || url.username || url.password) throw new TelegramError('Invalid test origin')
    origin = url.origin
  }
  let response: Response
  try {
    response = await fetch(`${origin}/bot${token}/${method}`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch { throw new TelegramError('Telegram did not confirm the request', 0, true) }
  let data: { ok?: boolean; result?: T; error_code?: number; parameters?: { retry_after?: number } }
  try { data = await response.json() } catch { throw new TelegramError('Telegram returned an unreadable response', 0, true) }
  if (!response.ok || !data.ok) {
    if (data.error_code === 429) throw new TelegramError('Telegram rate limit', Math.min(3600, Math.max(1, Number(data.parameters?.retry_after) || 60)))
    if (data.error_code === 401) throw new TelegramError('Bot token was refused; reconnect the bot')
    if (data.error_code === 403) throw new TelegramError('Bot cannot access this chat; check its permissions')
    if (response.status >= 500) throw new TelegramError('Telegram did not confirm the request', 0, true)
    throw new TelegramError('Telegram refused the request; check the chat and bot permissions')
  }
  return data.result as T
}

export function safeTelegramError(error: unknown): string {
  return error instanceof TelegramError ? error.code : 'The Telegram operation could not be completed'
}
