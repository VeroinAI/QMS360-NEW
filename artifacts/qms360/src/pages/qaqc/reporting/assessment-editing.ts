import { setIn } from './form-kit';
import type { Obj } from './reporting-types';

/** A confirmation applies to the current report, never to later edits. */
export function editAssessmentData(data: Obj, path: (string | number)[], value: unknown, reviewRequired = false): Obj {
  let updated = setIn(data, path, value);
  if ((reviewRequired || data.assessmentConfirmationRequired === true) && !(path.length === 1 && path[0] === 'assessmentConfirmed'))
    updated = { ...updated, assessmentConfirmed: false };
  // Preserve zero-fill as a starting point rather than discarding later input.
  if (typeof value === 'number' && value !== 0) updated = { ...updated, noUpdates: false };
  return updated;
}

export function resetAssessmentReview(data: Obj, reviewRequired = false): Obj {
  return reviewRequired || data.assessmentConfirmationRequired === true ? { ...data, assessmentConfirmed: false } : data;
}