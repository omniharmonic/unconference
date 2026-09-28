'use client'

import * as React from 'react'
import { CalendarClock, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { apiFetch, ApiError } from '@/lib/api/client'

interface CalendarFeed {
  id: string
  created_at: string
  last_used_at: string | null
}

/**
 * A subscribable calendar URL for the sessions this person has saved (MT §12.8).
 *
 * The URL carries its own credential, because a calendar client holds no cookie — so it is
 * shown once, it is read-only, and it is revocable from here, which is why it lives next to
 * the other things that reach a person without them opening the app.
 */
export function CalendarSubscriptions({ active }: { active: boolean }) {
  const id = React.useId()
  const { toast } = useToast()
  const [feeds, setFeeds] = React.useState<CalendarFeed[] | null>(null)
  const [limit, setLimit] = React.useState(3)
  const [fresh, setFresh] = React.useState<{ url: string; webcalUrl: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = React.useCallback(async () => {
    try {
      const data = await apiFetch<{ feeds: CalendarFeed[]; limit: number }>('/api/me/calendar-feed')
      setFeeds(data.feeds)
      setLimit(data.limit)
    } catch {
      setMessage({ type: 'error', text: 'Your subscriptions could not be loaded. Close and reopen to try again.' })
    }
  }, [])

  React.useEffect(() => { if (active) void load() }, [active, load])

  const create = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const data = await apiFetch<{ url: string; webcalUrl: string }>('/api/me/calendar-feed', { method: 'POST', json: {} })
      setFresh({ url: data.url, webcalUrl: data.webcalUrl })
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof ApiError ? e.message : 'The subscription could not be created.' })
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (feedId: string) => {
    setBusy(true)
    try {
      await apiFetch(`/api/me/calendar-feed?id=${encodeURIComponent(feedId)}`, { method: 'DELETE' })
      setFresh(null)
      setMessage({ type: 'success', text: 'That subscription stops working now.' })
      await load()
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof ApiError ? e.message : 'It could not be revoked.' })
    } finally {
      setBusy(false)
    }
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: 'Copied', description: 'Paste it into your calendar app.' })
    } catch {
      setMessage({ type: 'error', text: 'Copying failed. Select the link and copy it by hand.' })
    }
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`} className="text-sm font-medium flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Subscribe to your schedule
      </h3>
      <p className="text-xs text-muted-foreground">
        One calendar address for every session you saved, with a reminder 15 minutes before each. Treat it as a key:
        anyone who has it can read your saved sessions.
      </p>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">How it works</summary>
        <p>
          Your calendar re-checks the address on its own, so schedule changes arrive without you doing anything.
          Revoke it here if it gets out.
        </p>
      </details>

      {fresh ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium">Copy this now — it is shown once.</p>
          <code className="block min-w-0 break-all text-xs font-mono">{fresh.url}</code>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copy(fresh.url)}>
              <Copy className="h-4 w-4 mr-2" aria-hidden="true" />Copy the address
            </Button>
            <Button asChild size="sm" variant="outline"><a href={fresh.webcalUrl}>Open in my calendar app</a></Button>
          </div>
        </div>
      ) : null}

      {feeds === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : feeds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calendar is subscribed yet.</p>
      ) : (
        <ul className="space-y-2">
          {feeds.map((feed) => (
            <li key={feed.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <span className="min-w-0 text-xs text-muted-foreground">
                Created {new Date(feed.created_at).toLocaleDateString()}
                {feed.last_used_at ? ` · last fetched ${new Date(feed.last_used_at).toLocaleString()}` : ' · never fetched'}
              </span>
              <Button type="button" size="sm" variant="ghost" className="text-destructive" loading={busy} onClick={() => void revoke(feed.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {feeds && feeds.length >= limit && <p className="text-xs text-muted-foreground">You have {limit} active subscriptions. Revoke an unused one before adding another.</p>}
      <Button type="button" variant="outline" loading={busy} disabled={feeds === null || feeds.length >= limit} onClick={() => void create()}>
        <CalendarClock className="h-4 w-4 mr-2" aria-hidden="true" />
        Create subscription
      </Button>
      {message && <p role={message.type === 'error' ? 'alert' : 'status'} className="text-sm">{message.text}</p>}
    </section>
  )
}
