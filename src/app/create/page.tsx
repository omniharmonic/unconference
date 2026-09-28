'use client';

import * as React from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, AlertCircle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SiteHeader } from '@/components/SiteHeader';
import { ELLIPSIS } from '@/lib/format';
import { validateWizardState } from '@/lib/events/validate-creation';
import { useAuth } from '@/hooks/useAuth';

import { useWizardStateWithPersistence } from './useWizardPersistence';
import { WizardStepTabs, WizardNavButtons, WizardValidationErrors } from './WizardNavigation';
import {
  getStepFromNumber,
  getNumberFromStep,
  stepForValidationArea,
  type WizardState,
  type WizardAction,
} from './useWizardState';

import IdentityStep from './steps/IdentityStep';
import BasicsStep from './steps/BasicsStep';
import DatesStep from './steps/DatesStep';
import VenuesStep from './steps/VenuesStep';
import ScheduleStep from './steps/ScheduleStep';
import TracksStep from './steps/TracksStep';
import ParticipationStep from './steps/ParticipationStep';
import VotingStep from './steps/VotingStep';
import BrandingStep from './steps/BrandingStep';
import ReviewStep, { creationReadiness } from './steps/ReviewStep';

// ============================================================================
// Step Props Interface
// ============================================================================

interface StepProps {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
}

const LOGIN_HREF = '/login?returnTo=%2Fcreate';

// ============================================================================
// Resume Draft Dialog
// ============================================================================

interface ResumeDraftDialogProps {
  open: boolean;
  timestamp: Date | null;
  onResume: () => void;
  onStartFresh: () => void;
}

function ResumeDraftDialog({ open, timestamp, onResume, onStartFresh }: ResumeDraftDialogProps) {
  const formattedTime = timestamp
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
    : null;

  return (
    // Escape and clicking outside keep the draft: resuming is the safe choice.
    <Dialog open={open} onOpenChange={(next) => { if (!next) onResume(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Pick up where you left off?</DialogTitle>
          <DialogDescription>
            {formattedTime ? `A draft of your gathering was saved on this device on ${formattedTime}.` : 'A draft of your gathering was saved on this device.'}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Starting fresh deletes that saved draft. This cannot be undone.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={onStartFresh}>Start fresh</Button>
          <Button onClick={onResume}>Resume draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Main Wizard Content
// ============================================================================

function CreateWizardContent() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const {
    state,
    dispatch,
    clearDraft,
    hasSavedDraft,
    getDraftTimestamp,
    lastSavedAt,
  } = useWizardStateWithPersistence();

  // State for showing resume dialog
  const [showResumeDialog, setShowResumeDialog] = React.useState(false);
  const [isInitialized, setIsInitialized] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [slugSuggestions, setSlugSuggestions] = React.useState<string[]>([]);
  const [hasAdvanced, setHasAdvanced] = React.useState(false);
  const stepContent = React.useRef<HTMLDivElement>(null);

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!authLoading && !user) {
      router.push(LOGIN_HREF);
    }
  }, [user, authLoading, router]);

  // Check for saved draft on mount
  React.useEffect(() => {
    // Only check on initial mount
    if (!isInitialized) {
      const hasDraft = hasSavedDraft();
      if (hasDraft && state.basics.name === '' && state.currentStep === 0) {
        // There's a draft but state is empty, show resume dialog
        setShowResumeDialog(true);
      }
      setIsInitialized(true);
    }
  }, [hasSavedDraft, isInitialized, state.basics.name, state.currentStep]);

  // Handle resume draft
  const handleResume = React.useCallback(() => {
    setShowResumeDialog(false);
    // State is already loaded by useWizardStateWithPersistence
  }, []);

  // Handle start fresh
  const handleStartFresh = React.useCallback(() => {
    clearDraft(true);
    setHasAdvanced(false);
    setShowResumeDialog(false);
  }, [clearDraft]);

  // The controls stay mounted; only the form changes. Return the viewport and keyboard focus
  // to the new step, rather than leaving a short step scrolled beneath the navigation bar.
  React.useEffect(() => {
    if (state.currentStep > 0) setHasAdvanced(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
    stepContent.current?.focus({ preventScroll: true });
  }, [state.currentStep]);

  // Handler for event submission
  const handleSubmit = React.useCallback(async () => {
    if (isSubmitting) return;
    const validation = validateWizardState(state);
    if (!validation.valid) {
      setSubmitError(validation.error || 'Review your gathering’s details.');
      dispatch({ type: 'SET_STEP', payload: stepForValidationArea(validation.step, validation.error) });
      return;
    }
    if (!state.identity.acknowledged) {
      setSubmitError('Confirm what becomes public before creating the gathering.');
      dispatch({ type: 'SET_STEP', payload: getNumberFromStep('identity') });
      return;
    }
    if (!state.identity.termsAccepted) {
      setSubmitError('Accept the terms and privacy policy before creating the gathering.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    setSlugSuggestions([]);

    try {
      // Same-origin with the session cookie (plan §3.3). Read the body directly: a 409
      // carries slug suggestions alongside the error.
      const response = await fetch('/api/events/create', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ wizardState: state }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        success?: boolean;
        error?: string;
        suggestions?: string[];
        eventSlug?: string;
        event?: { slug: string };
        identity?: { status: 'created' | 'pending'; error?: string };
      };

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          setSubmitError('Your session has expired. Sign in again to continue.');
        } else if (response.status === 409) {
          setSubmitError(data.error || 'This event URL is already taken.');
          if (data.suggestions?.length) setSlugSuggestions(data.suggestions);
          dispatch({ type: 'SET_STEP', payload: getNumberFromStep('identity') });
        } else {
          setSubmitError(data.error || 'The gathering could not be created. Try again.');
        }
        setIsSubmitting(false);
        return;
      }

      clearDraft();
      const eventSlug = data.eventSlug || data.event?.slug;
      // The organizer workspace shows the "your gathering is ready" banner for `created=1`.
      // A pending identity is surfaced, with a retry, in Event settings.
      const destination = data.identity?.status === 'pending'
        ? 'admin/settings?identity=pending&created=1#network'
        : 'admin?created=1';
      router.push(eventSlug ? `/e/${eventSlug}/${destination}` : '/');
    } catch (error) {
      console.error('Error creating event:', error);
      setSubmitError('Something went wrong. Your draft is safe; try again.');
      setIsSubmitting(false);
    }
  }, [state, clearDraft, router, dispatch, isSubmitting]);

  React.useEffect(() => {
    if (submitError) document.getElementById('create-submit-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [submitError]);

  // Handler to apply a slug suggestion
  const handleApplySlugSuggestion = React.useCallback((suggestion: string) => {
    dispatch({ type: 'UPDATE_BASICS', payload: { slug: suggestion } });
    setSlugSuggestions([]);
    setSubmitError(null);
  }, [dispatch]);

  // Get current step component
  const renderStep = () => {
    const stepName = getStepFromNumber(state.currentStep);
    const props: StepProps = { state, dispatch };

    switch (stepName) {
      case 'identity':
        return <IdentityStep {...props} />;
      case 'basics':
        return <BasicsStep {...props} />;
      case 'dates':
        return <DatesStep {...props} />;
      case 'venues':
        return <VenuesStep {...props} />;
      case 'schedule':
        return <ScheduleStep {...props} />;
      case 'tracks':
        return <TracksStep {...props} />;
      case 'participation':
        return <ParticipationStep {...props} />;
      case 'voting':
        return <VotingStep {...props} />;
      case 'branding':
        return <BrandingStep {...props} />;
      case 'review':
        return (
          <ReviewStep
            state={state}
            dispatch={dispatch}
          />
        );
      default:
        return <div>Unknown step</div>;
    }
  };

  // Show loading while checking authentication
  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {authLoading ? `Loading${ELLIPSIS}` : `Redirecting to sign in${ELLIPSIS}`}
          </p>
        </div>
      </div>
    );
  }

  const datesStep = getNumberFromStep('dates');
  const reviewStep = getNumberFromStep('review');
  const ready = creationReadiness(state);
  const canSkipToReview = ready.ok;
  const draftSavedLabel = lastSavedAt
    ? `Saved on this device · ${new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(lastSavedAt)}`
    : 'Your draft stays on this device';
  const canCreate = ready.ok && state.identity.termsAccepted && !isSubmitting;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <SiteHeader />

      <main className="container mx-auto flex-1 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-5 sm:px-5 sm:pt-8">
        <h1 className="sr-only">Create a gathering</h1>
        <div className="mx-auto max-w-5xl space-y-5">
          {state.currentStep === 0 && !hasAdvanced && (
            <div data-testid="wizard-intro" className="max-w-2xl space-y-2 pb-1">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Make room for your people.</h2>
              <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">Name it, set the dates, and make it yours. You can leave the finer details for later.</p>
            </div>
          )}

          <div data-testid="wizard-progress" className="sticky top-[77px] z-30 -mx-1 rounded-2xl border bg-background/95 px-3 pb-3 pt-1 backdrop-blur-md sm:mx-0 sm:px-4 sm:py-2">
            <WizardStepTabs state={state} dispatch={dispatch} disabled={isSubmitting} />
          </div>

          <div className={`mx-auto space-y-4 ${getStepFromNumber(state.currentStep) === 'schedule' ? 'max-w-5xl' : 'max-w-3xl'}`}>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{state.currentStep < 3 ? 'The essentials' : state.currentStep < reviewStep ? 'Make it yours · adjustable later' : 'One last look'}</span>
              <span title={draftSavedLabel}>{lastSavedAt ? 'Draft saved on this device' : 'Draft saves on this device'}</span>
            </div>
            {/* Error Alert */}
            {submitError && (
              <Alert id="create-submit-error" variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription className="space-y-3">
                  <p>{submitError}</p>
                  {/* Login button for auth errors */}
                  {(submitError.includes('signed in') || submitError.includes('session has expired')) && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={LOGIN_HREF}>
                        <LogIn className="h-4 w-4 mr-2" aria-hidden="true" />
                        Sign in
                      </Link>
                    </Button>
                  )}
                  {slugSuggestions.length > 0 && (
                    <div className="pt-2">
                      <p className="text-sm font-medium mb-2">Try one of these available URLs:</p>
                      <div className="flex flex-wrap gap-2">
                        {slugSuggestions.map((suggestion) => (
                          <Button
                            key={suggestion}
                            variant="outline"
                            size="sm"
                            onClick={() => handleApplySlugSuggestion(suggestion)}
                          >
                            {suggestion}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <WizardValidationErrors state={state} />

            {state.currentStep > datesStep && state.currentStep < reviewStep && canSkipToReview && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-2">
                <p className="text-sm">Your essentials are ready.</p>
                <Button type="button" variant="ghost" size="sm" disabled={isSubmitting} className="min-h-11 shrink-0" onClick={() => dispatch({ type: 'SET_STEP', payload: reviewStep })}>
                  Review now
                </Button>
              </div>
            )}

            {/* Step Content */}
            <div ref={stepContent} tabIndex={-1} role="region" data-testid="wizard-step-content" aria-label={`${getStepFromNumber(state.currentStep)} setup`} className="space-y-4 focus-visible:ring-0">
              <fieldset disabled={isSubmitting} className="min-w-0 space-y-4">
                {renderStep()}
                {state.currentStep === datesStep && (
                  <div className="rounded-xl border bg-secondary/40 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="font-semibold">That’s enough to get started.</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Review now, or keep going to customize your program. Rooms, voting and branding can all be adjusted later.
                      </p>
                      {!canSkipToReview && (
                        <p className="mt-1 text-xs text-muted-foreground">Choose your dates first, then you can skip straight to the review.</p>
                      )}
                    </div>
                    <Button
                      className="min-h-11 shrink-0"
                      variant="outline"
                      disabled={!canSkipToReview}
                      onClick={() => dispatch({ type: 'SET_STEP', payload: reviewStep })}
                    >
                      Review with defaults
                    </Button>
                  </div>
                )}
              </fieldset>
            </div>

          </div>
        </div>
      </main>

      <div data-testid="wizard-actions" className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur-md">
          <WizardNavButtons state={state} dispatch={dispatch} disabled={isSubmitting} onSubmit={handleSubmit} canCreate={canCreate} />
        </div>
      </div>

      {/* Resume Draft Dialog */}
      <ResumeDraftDialog
        open={showResumeDialog}
        timestamp={getDraftTimestamp()}
        onResume={handleResume}
        onStartFresh={handleStartFresh}
      />
    </div>
  );
}

// ============================================================================
// Page Export with Suspense
// ============================================================================

export default function CreateEventPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      }
    >
      <CreateWizardContent />
    </Suspense>
  );
}
