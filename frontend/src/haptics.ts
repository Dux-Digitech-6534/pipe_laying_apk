// Touch feedback.
//
// Short vibrations on the actions where a native app would buzz: choosing an
// option, toggling, committing a record, hitting a validation error. Vibration
// is unavailable or user-disabled on plenty of devices, so every call is
// best-effort and silent on failure.

function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    /* not available — ignore */
  }
}

/** Selection, toggle, sheet dismissal. */
export const tapLight = () => buzz(8);

/** A record was created / saved / queued. */
export const tapSuccess = () => buzz([12, 40, 18]);

/** Validation failed or the server rejected something. */
export const tapError = () => buzz([28, 60, 28]);
