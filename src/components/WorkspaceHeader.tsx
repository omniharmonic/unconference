'use client'

import * as React from 'react'
import { CalendarDays } from 'lucide-react'
import { useEvent } from '@/contexts/EventContext'
import { formatCalendarDate } from '@/lib/events/dates'

/** Compact page context; primary navigation lives in the sidebar and bottom bar. */
export function WorkspaceHeader({ label }: { label: string }) {
  const event = useEvent()
  return (
    <div
      data-testid="workspace-context"
      className="flex h-11 md:h-[76px] items-center justify-between gap-2 border-b px-4 md:px-8 lg:px-10 bg-card/70"
    >
      <span className="min-w-0 truncate text-sm font-medium md:hidden" aria-current="page">{label}</span>
      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm md:flex">
        <span className="truncate max-w-[240px] text-muted-foreground">{event.name}</span>
        <span className="text-border" aria-hidden="true">/</span>
        <span className="truncate font-medium" aria-current="page">{label}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-1 md:gap-6">
        <span className="hidden xl:flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {formatCalendarDate(event.startDate, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
    </div>
  )
}
