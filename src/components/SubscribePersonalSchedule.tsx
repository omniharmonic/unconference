'use client'

import * as React from 'react'
import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { CalendarSubscriptions } from '@/components/CalendarSubscriptions'

export function SubscribePersonalSchedule({ eventSlug, className }: { eventSlug: string; className?: string }) {
  const [open, setOpen] = React.useState(false)
  const { user } = useAuth()
  return <>
    <Button variant="outline" size="sm" className={className} onClick={() => setOpen(true)} title="Subscribe to your saved sessions">
      <CalendarClock className="hidden h-4 w-4 sm:block" aria-hidden />Subscribe
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] overflow-x-hidden p-4 sm:p-6">
        <DialogHeader><DialogTitle>Your calendar, kept in sync</DialogTitle><DialogDescription>Follow your saved sessions across gatherings in your calendar app. Updates arrive when your calendar refreshes.</DialogDescription></DialogHeader>
        {user ? <CalendarSubscriptions active={open} /> : <Button asChild><Link href={`/login?returnTo=${encodeURIComponent(`/e/${eventSlug}/schedule?view=mine`)}`}>Sign in to subscribe</Link></Button>}
      </DialogContent>
    </Dialog>
  </>
}
