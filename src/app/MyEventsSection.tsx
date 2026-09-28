import Link from 'next/link';
import { Calendar, MapPin, Plus, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getViewer } from '@/lib/auth/viewer';
import { getMemberEvents, type OrganizedEvent } from '@/lib/events';
import { eventStatusBadge } from '@/lib/labels';
import { formatDateRange } from '@/lib/format';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  moderator: 'Moderator',
  attendee: 'Participant',
};

/** The signed-in person’s gatherings, resolved server-side from their own memberships. */
export async function MyEventsSection() {
  const viewer = await getViewer();
  if (!viewer) return null;

  let events: OrganizedEvent[] = [];
  let loadFailed = false;
  try {
    events = await getMemberEvents(viewer.accountId);
  } catch (err) {
    loadFailed = true;
    console.error('Error fetching my events:', err);
  }

  return (
    <section id="my-gatherings" className="py-12 sm:py-16 scroll-mt-20" aria-labelledby="my-gatherings-heading">
      <div className="container mx-auto px-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 id="my-gatherings-heading" className="text-4xl sm:text-5xl font-semibold tracking-tight">My gatherings</h1>
          <Button asChild>
            <Link href="/create">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Create a gathering
            </Link>
          </Button>
        </div>

        {loadFailed ? <p role="alert" className="rounded-xl border p-5">Your gatherings could not be loaded. <a href="/" className="underline">Try again</a>.</p> : events.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {events.map((event) => {
              const badge = eventStatusBadge(event.status);

              return (
                <Card key={event.id} className="group border-foreground/20 border-t-8 border-t-primary">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {event.logo_url && (
                          <img src={event.logo_url} alt="" className="w-10 h-10 rounded-lg bg-muted object-contain" />
                        )}
                        <div className="min-w-0">
                          <h2 className="text-2xl font-semibold tracking-tight leading-tight break-words">
                            <Link href={`/e/${event.slug}/dashboard`} className="hover:text-primary focus-visible:underline">{event.name}</Link>
                          </h2>
                          <span className="text-xs text-muted-foreground">{ROLE_LABELS[event.role] ?? event.role}</span>
                        </div>
                      </div>
                      <Badge variant={badge.badge} className="flex-shrink-0">
                        {badge.label}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-4 w-4" aria-hidden="true" />
                        <span>{formatDateRange(event.start_date, event.end_date, 'UTC')}</span>
                      </div>
                      {event.location_name && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-4 w-4" aria-hidden="true" />
                          <span>{event.location_name}</span>
                        </div>
                      )}
                    </div>

                    {!event.has_identity && ['owner', 'admin'].includes(event.role) && (
                      <Link
                        href={`/e/${event.slug}/admin/atproto`}
                        className="mb-4 flex items-center gap-1.5 text-xs text-signal-amber hover:underline"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Not published to the network yet — set it up
                      </Link>
                    )}

                    <div className="space-y-2">
                      <Button asChild size="sm" className="w-full min-h-11">
                        <Link href={`/e/${event.slug}/dashboard`}>Open gathering<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
                      </Button>
                      <div className={`grid gap-2 ${['owner', 'admin'].includes(event.role) ? 'grid-cols-2' : 'grid-cols-1'}`}>
                        <Button asChild variant="outline" size="sm" className="h-auto min-h-11 min-w-0 whitespace-normal px-2 py-2 text-xs leading-snug text-center">
                          <Link href={`/e/${event.slug}?view=about`}>Gathering page</Link>
                        </Button>
                        {['owner', 'admin'].includes(event.role) && <Button asChild variant="outline" size="sm" className="h-auto min-h-11 min-w-0 whitespace-normal px-2 py-2 text-xs leading-snug text-center">
                          <Link href={`/e/${event.slug}/admin`}>Organizer workspace</Link>
                        </Button>}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground mb-4">Your gatherings will appear here when you join or create one.</p>
            <Button asChild>
              <Link href="/events">
                Explore gatherings
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </Card>
        )}
      </div>
    </section>
  );
}
