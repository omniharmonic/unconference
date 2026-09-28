'use client'
import Link from 'next/link'
import { useEvent, useEventRole, JoinGatheringButton } from '@/contexts/EventContext'
import { useAuth } from '@/hooks/useAuth'
import { DashboardLayout } from '@/components/DashboardLayout'
import { TelegramConnectionCard } from '@/components/knowledge/TelegramConnectionCard'
import { Button } from '@/components/ui/button'
export default function TelegramPage() {
  const event=useEvent()
  const { user,isLoading }=useAuth()
  const { role,isLoading:roleLoading }=useEventRole()
  return <DashboardLayout><div className="mx-auto max-w-xl space-y-5">
    {isLoading || roleLoading ? <p role="status">Loading…</p> : !user ? <div className="space-y-4 rounded-2xl border bg-card p-6"><h1 className="text-xl font-semibold">Connect Telegram</h1><p className="text-muted-foreground">Sign in to connect your account to this gathering’s bot.</p><Button asChild><Link href={`/login?returnTo=${encodeURIComponent(`/e/${event.slug}/telegram`)}`}>Sign in</Link></Button></div> : !role ? <div className="space-y-4 rounded-2xl border bg-card p-6"><p>Join this gathering to connect its Telegram assistant.</p><JoinGatheringButton/></div> : <TelegramConnectionCard slug={event.slug} standalone/>}
    <p className="text-sm text-muted-foreground">Prefer your own assistant? <Link href="/account?tab=connections" className="underline">Connect through MCP</Link> and use your own AI provider.</p>
  </div></DashboardLayout>
}
