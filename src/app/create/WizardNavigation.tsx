'use client';

import * as React from 'react';
import Link from 'next/link';
import { PLATFORM_HOME } from '@/lib/site-url';
import { Check, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  WIZARD_STEPS,
  STEP_LABELS,
  isStepValid,
  getStepValidationErrors,
  getStepFromNumber,
  type WizardState,
  type WizardAction,
} from './useWizardState';

interface WizardCommonProps {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  disabled?: boolean;
}

/**
 * Determines the status of a step based on current state
 */
function getStepStatus(
  stepIndex: number,
  currentStep: number,
  state: WizardState
): 'completed' | 'current' | 'upcoming' | 'error' {
  if (stepIndex === currentStep) {
    const stepName = getStepFromNumber(stepIndex);
    if (state.validation[stepName] && state.validation[stepName].length > 0) {
      return 'error';
    }
    return 'current';
  }
  if (stepIndex < currentStep) {
    if (isStepValid(state, stepIndex)) {
      return 'completed';
    }
    return 'error';
  }
  return 'upcoming';
}

/**
 * Highest step the user can navigate to (all previous steps must be valid).
 */
export function getMaxNavigableStep(state: WizardState): number {
  for (let i = 0; i < WIZARD_STEPS.length; i++) {
    if (!isStepValid(state, i)) {
      return i;
    }
  }
  return WIZARD_STEPS.length - 1;
}

// ============================================================================
// Step Tabs (tab-styled step indicator, meant for the top of the wizard)
// ============================================================================

export function WizardStepTabs({ state, dispatch, disabled = false }: WizardCommonProps) {
  const { currentStep } = state;
  const maxNavigable = getMaxNavigableStep(state);
  const goTo = (index: number) => {
    if (!disabled && index <= maxNavigable && index !== currentStep) {
      dispatch({ type: 'SET_STEP', payload: index });
    }
  };

  return (
    <nav aria-label="Wizard steps" className="w-full">
      <div className="flex min-w-0 items-center justify-between gap-3 lg:hidden">
        <span className="shrink-0 text-xs text-muted-foreground">Step {currentStep + 1} of {WIZARD_STEPS.length}</span>
        <select
          aria-label="Setup step"
          value={currentStep}
          disabled={disabled}
          onChange={(event) => goTo(Number(event.target.value))}
          className="min-h-11 min-w-0 max-w-[65%] rounded-lg border-0 bg-transparent py-2 pl-2 pr-7 text-sm font-semibold text-foreground"
        >
          {WIZARD_STEPS.map((step, index) => (
            <option key={step} value={index} disabled={index > maxNavigable}>
              {index + 1}. {STEP_LABELS[step]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-10 gap-1.5 lg:hidden" aria-hidden="true">
        {WIZARD_STEPS.map((step, index) => <span key={step} className={cn(
          'h-1 rounded-full', index === currentStep ? 'bg-primary' : index < currentStep ? 'bg-primary/40' : 'bg-foreground/10'
        )} />)}
      </div>
      <ol className="hidden grid-cols-10 gap-1 lg:grid">
        {WIZARD_STEPS.map((step, index) => {
          const status = getStepStatus(index, currentStep, state);
          return (
            <li key={step} className="min-w-0">
              <button
                type="button"
                aria-current={index === currentStep ? 'step' : undefined}
                onClick={() => goTo(index)}
                disabled={disabled || index > maxNavigable}
                className={cn(
                  'flex min-h-14 w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-xs transition-colors disabled:opacity-50',
                  index === currentStep ? 'bg-primary/10 font-semibold text-primary' : 'text-muted-foreground enabled:hover:bg-muted',
                  status === 'error' && 'text-destructive'
                )}
              >
                <span className="flex h-5 items-center justify-center font-semibold" aria-hidden="true">
                  {status === 'completed' ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                {STEP_LABELS[step]}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ============================================================================
// Validation error summary
// ============================================================================

export function WizardValidationErrors({ state }: { state: WizardState }) {
  const currentStepName = getStepFromNumber(state.currentStep);
  const errors = state.validation[currentStepName] || [];
  if (errors.length === 0) return null;

  return (
    <div id="wizard-validation" tabIndex={-1} role="alert" className="scroll-mt-52 rounded-xl border border-destructive/20 bg-destructive/10 p-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-destructive">
            Fix these before continuing:
          </p>
          <ul className="text-sm text-destructive/90 list-disc list-inside space-y-1">
            {errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Back/Next buttons
// ============================================================================

/** A single, stable action row from Identity through Review. */
export function WizardNavButtons({ state, dispatch, disabled = false, onSubmit, canCreate }: WizardCommonProps & {
  onSubmit: () => Promise<void>;
  canCreate: boolean;
}) {
  const { currentStep } = state;
  const currentStepName = getStepFromNumber(currentStep);
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const nextStepName = isLastStep ? null : WIZARD_STEPS[currentStep + 1];

  const handleNext = () => {
    const errors = getStepValidationErrors(state, currentStep);
    if (errors.length > 0) {
      dispatch({ type: 'SET_VALIDATION_ERRORS', payload: { step: currentStepName, errors } });
      requestAnimationFrame(() => document.getElementById('wizard-validation')?.focus());
      return;
    }
    dispatch({ type: 'NEXT_STEP' });
  };

  return (
    <div className="flex items-center justify-between gap-3">
      {isFirstStep ? (
        <Button asChild variant="outline" className="min-h-11 gap-1.5 px-3 sm:px-4">
          <Link href={`${PLATFORM_HOME}#my-gatherings`} aria-label="Back to My gatherings">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />Back
          </Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled={disabled} onClick={() => dispatch({ type: 'PREV_STEP' })} className="min-h-11 gap-1.5 px-3 sm:px-4">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />Back
        </Button>
      )}
      <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block">
        {nextStepName ? `Next: ${STEP_LABELS[nextStepName]}` : 'Create now. Publish when you’re ready.'}
      </span>
      {nextStepName ? (
        <Button type="button" disabled={disabled} onClick={handleNext} className="min-h-11 min-w-32 gap-2" aria-label={`Continue to ${STEP_LABELS[nextStepName]}`}>
          Continue<ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : (
        <Button type="button" onClick={onSubmit} loading={disabled} disabled={!canCreate} className="min-h-11 gap-2 px-3 sm:px-4">
          {disabled ? 'Creating…' : 'Create gathering'}
        </Button>
      )}
    </div>
  );
}
