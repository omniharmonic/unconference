'use client'

import * as React from 'react'
import Link from 'next/link'
import { Calendar, CalendarRange, ClipboardList, LogOut, MapPin, MoreHorizontal, Presentation, BarChart3, Users, MessageCircleQuestion } from 'lucide-react'
import { PLATFORM_HOME } from '@/lib/site-url'
import { cn } from '@/lib/utils'

export interface MobileTabBarProps {
  eventSlug: string
  pathname: string | null
  onMore: () => void
  onClose: () => void
  moreOpen?: boolean
  signedIn: boolean
  hasKnowledge?: boolean
  onSignOut: () => void
}

/** One glass surface expands upward; the main destinations never move. */
export function MobileTabBar({ eventSlug, pathname, onMore, onClose, moreOpen = false, signedIn, hasKnowledge, onSignOut }: MobileTabBarProps) {
  const base = `/e/${eventSlug}`
  const root = React.useRef<HTMLElement>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const extraId = React.useId()
  const at = (...paths: string[]) => paths.some((p) => pathname === p || pathname?.startsWith(`${p}/`))
  React.useEffect(() => {
    if (!moreOpen) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) onClose() }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [moreOpen, onClose])

  const tabs = [
    { href: `${base}/dashboard`, label: 'Home', icon: BarChart3, active: at(`${base}/dashboard`) },
    { href: `${base}/sessions`, label: 'Sessions', icon: Presentation, active: at(`${base}/sessions`) },
    { href: `${base}/schedule`, label: 'Schedule', icon: Calendar, active: at(`${base}/schedule`, `${base}/my-schedule`) },
    { href: `${base}/map`, label: 'Map', icon: MapPin, active: at(`${base}/map`) },
  ]
  const extras = [
    { href: `${base}/participants`, label: 'People', icon: Users },
    { href: `${base}/my-votes`, label: 'My votes', icon: ClipboardList },
    ...(hasKnowledge ? [{ href: `${base}/ask`, label: 'Ask', icon: MessageCircleQuestion }] : []),
    ...(signedIn ? [{ href: `${PLATFORM_HOME}#my-gatherings`, label: 'My gatherings', icon: CalendarRange }] : []),
  ]
  const itemClass = 'flex min-w-0 min-h-11 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 text-[11px] leading-tight transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <nav ref={root} aria-label="Gathering" data-testid="mobile-tab-bar" data-expanded={moreOpen} className="mobile-bar mobile-glass fixed z-40 overflow-hidden md:hidden">
      <div id={extraId} data-testid="more-navigation" inert={!moreOpen} aria-hidden={!moreOpen} className="mobile-bar-expansion">
        <div className="min-h-0 overflow-hidden">
          <div className="mx-2 flex h-[60px] items-stretch gap-0.5 border-b border-foreground/10 py-1">
            {extras.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onClose} aria-current={at(href) ? 'page' : undefined} className={cn(itemClass, at(href) ? 'font-semibold text-primary' : 'text-foreground/80')}>
              <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden /><span>{label}</span>
            </Link>)}
            {signedIn && <button type="button" onClick={() => { onClose(); onSignOut() }} className={cn(itemClass, 'text-foreground/80')}><LogOut className="h-5 w-5" strokeWidth={1.5} aria-hidden /><span>Sign out</span></button>}
          </div>
        </div>
      </div>
      <div className="flex h-[56px] items-stretch gap-0.5 px-1.5 py-1">
        {tabs.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href} onClick={onClose} aria-current={active ? 'page' : undefined} className={cn(itemClass, active ? 'font-semibold text-primary' : 'text-muted-foreground')}>
          <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} aria-hidden /><span>{label}</span>
        </Link>)}
        <button ref={trigger} type="button" onClick={onMore} aria-expanded={moreOpen} aria-controls={extraId} className={cn(itemClass, moreOpen ? 'font-semibold text-primary' : 'text-muted-foreground')}>
          <MoreHorizontal className="h-5 w-5 transition-transform duration-300" style={{ transform: moreOpen ? 'rotate(90deg)' : undefined }} strokeWidth={moreOpen ? 2 : 1.5} aria-hidden /><span>{moreOpen ? 'Less' : 'More'}</span>
        </button>
      </div>
    </nav>
  )
}
