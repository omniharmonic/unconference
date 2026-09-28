'use client'

/**
 * Schedule (mobile shell design §4): one page with two tabs, Program and My schedule.
 *
 * `?view=mine` selects the saved tab and is what `/e/[slug]/my-schedule` now redirects to, so a
 * link anyone already has keeps working and the mobile tab bar has one Schedule destination
 * instead of two. Both tabs render the same `ScheduleView`; only the export button's
 * `favoritesOnly` and the page title change with the tab.
 */

import * as React from 'react'
import { Suspense } from 'react'
import { Calendar, Heart, Loader2 } from 'lucide-react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { SubscribePersonalSchedule } from '@/components/SubscribePersonalSchedule'
import { DashboardLayout } from '@/components/DashboardLayout'
import { ExportScheduleButton } from '@/components/AddToCalendar'
import { ScheduleView } from '@/components/schedule/ScheduleView'
import type { ScheduleViewMode } from '@/components/schedule/useSchedule'
import { useEvent } from '@/contexts/EventContext'
import { useSearchParams } from 'next/navigation'

function SchedulePageBody() {
  const event = useEvent()
  const searchParams = useSearchParams()
  const fromUrl: ScheduleViewMode = searchParams.get('view') === 'mine' ? 'mine' : 'program'
  const [view, setView] = React.useState<ScheduleViewMode>(fromUrl)

  // A link or a redirect into a tab arrives as a new `?view=`, so follow it. Switching tabs by
  // hand goes the other way and *replaces* the URL (`replaceState` in `changeView`), so tapping
  // between the two never piles up history entries for Back to walk out of.
  React.useEffect(() => {
    setView(fromUrl)
  }, [fromUrl])

  const changeView = (next: ScheduleViewMode) => {
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'mine') url.searchParams.set('view', 'mine')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url.toString())
  }

  return (
    <div className="space-y-4">
      <div className="flex min-w-0 items-center justify-between gap-2" data-testid="schedule-heading">
        <h1 className="min-w-0 font-display text-xl font-bold tracking-tight sm:text-3xl">Schedule</h1>
        <div className="grid shrink-0 grid-cols-2 gap-1.5">
          <ExportScheduleButton eventSlug={event.slug} eventName={event.name} favoritesOnly={view === 'mine'} compact size="sm" className="min-h-11 w-full gap-1.5 px-2 text-xs sm:px-3 sm:text-sm" />
          <SubscribePersonalSchedule eventSlug={event.slug} className="min-h-11 w-full gap-1.5 px-2 text-xs sm:px-3 sm:text-sm" />
        </div>
      </div>

      <SegmentedControl<ScheduleViewMode>
        aria-label="Schedule view"
        fullWidth
        value={view}
        onValueChange={changeView}
        options={[
          { value: 'program', label: 'Program', icon: <Calendar className="h-3.5 w-3.5" aria-hidden /> },
          { value: 'mine', label: 'My schedule', icon: <Heart className="h-3.5 w-3.5" aria-hidden /> },
        ]}
      />

      <ScheduleView view={view} />
    </div>
  )
}

export default function SchedulePage() {
  return (
    <DashboardLayout>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12" role="status" aria-label="Loading the schedule">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <SchedulePageBody />
      </Suspense>
    </DashboardLayout>
  )
}
