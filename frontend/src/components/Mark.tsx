// The DUX brand mark.
//
// Both artworks render and CSS picks one via the design system's
// --mark-light-display / --mark-white-display tokens. Choosing in JS from the
// theme *setting* gets it wrong whenever the setting is "system" — the resolved
// theme is what matters, and CSS already knows it.

import markDark from '../assets/dux-mark.png';
import markWhite from '../assets/dux-mark-white.png';

export function Mark() {
  return (
    <>
      <img className="mark mark-dark" src={markDark} alt="DUX" />
      <img className="mark mark-white" src={markWhite} alt="" aria-hidden="true" />
    </>
  );
}
