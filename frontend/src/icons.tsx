// Icon set — the exact paths from the approved DUX prototype, so the app's
// glyphs are identical to the signed-off design. Thin stroke, round caps, 24
// grid, inheriting currentColor. No emoji, no icon font.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: 'sm' | 'lg' };

function svg(path: React.ReactNode) {
  return function Icon({ size, className, ...rest }: P) {
    return (
      <svg
        viewBox="0 0 24 24"
        className={['ic', size ?? '', className ?? ''].filter(Boolean).join(' ')}
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    );
  };
}

// ---------------------------------------------------------------- navigation

export const IconHome = svg(
  <>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9h12v-9" />
  </>,
);

export const IconLayers = svg(
  <>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </>,
);

export const IconPlus = svg(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const IconSettings = svg(
  <>
    <path d="M4 8h9M17 8h3" />
    <circle cx="15" cy="8" r="2.2" />
    <path d="M4 16h4M11 16h9" />
    <circle cx="8" cy="16" r="2.2" />
  </>,
);

export const IconChevronLeft = svg(<path d="m15 18-6-6 6-6" />);
export const IconChevronRight = svg(<path d="m9 6 6 6-6 6" />);
export const IconChevronDown = svg(<path d="m6 9 6 6 6-6" />);

export const IconCheck = svg(<path d="M4 12.5 9 17.5 20 6.5" />);

export const IconX = svg(<path d="M6 6l12 12M18 6 6 18" />);

export const IconSearch = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);

export const IconFilter = svg(<path d="M3 5h18l-7 8v6l-4-2v-4z" />);

export const IconRefresh = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 4v4h-4" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 20v-4h4" />
  </>,
);

// ------------------------------------------------------------------- domain

export const IconBuilding = svg(
  <>
    <path d="M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
    <path d="M15 9h3a1 1 0 0 1 1 1v11" />
    <path d="M9 8h2M9 12h2M9 16h2" />
    <path d="M3 21h18" />
  </>,
);

export const IconPin = svg(
  <>
    <path d="M12 21s-6-5.7-6-10a6 6 0 0 1 12 0c0 4.3-6 10-6 10z" />
    <circle cx="12" cy="11" r="2.2" />
  </>,
);

export const IconDrop = svg(<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />);

export const IconMountain = svg(
  <>
    <path d="M3 19h18" />
    <path d="m5 19 5-9 3 5 2-3 4 7" />
  </>,
);

export const IconRoad = svg(
  <>
    <path d="M7 21 8 3M17 21l-1-18" />
    <path d="M12 6v3M12 12v3M12 18v1" />
  </>,
);

export const IconRuler = svg(
  <>
    <rect x="3" y="8" width="18" height="8" rx="1" />
    <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
  </>,
);

export const IconBox = svg(
  <>
    <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
    <path d="M3 8l9 5 9-5M12 13v8" />
  </>,
);

export const IconHat = svg(
  <>
    <path d="M3 17h18" />
    <path d="M5 17a7 7 0 0 1 14 0" />
    <path d="M10 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
  </>,
);

export const IconCalendar = svg(
  <>
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
);

export const IconDoc = svg(
  <>
    <path d="M6 3h8l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4M8 13h8M8 17h5" />
  </>,
);

export const IconLock = svg(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </>,
);

export const IconSparkle = svg(
  <>
    <path d="M12 3l1.6 4.8L18 9.4l-4.4 1.6L12 16l-1.6-5L6 9.4l4.4-1.6z" />
    <path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9z" />
  </>,
);

export const IconUser = svg(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);

export const IconLogout = svg(
  <>
    <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
    <path d="M18 12H9" />
    <path d="m15 9 3 3-3 3" />
  </>,
);

export const IconGlobe = svg(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18A14 14 0 0 1 12 3z" />
  </>,
);

export const IconMoon = svg(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);

export const IconSun = svg(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
  </>,
);

export const IconBell = svg(
  <>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>,
);

export const IconTrash = svg(
  <>
    <path d="M4.8 7.2h14.4" />
    <path d="M9.6 7.2V5.4a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.8" />
    <path d="M6.8 7.2 7.6 19a1.4 1.4 0 0 0 1.4 1.3h6a1.4 1.4 0 0 0 1.4-1.3l.8-11.8" />
  </>,
);

export const IconDatabase = svg(
  <>
    <ellipse cx="12" cy="6.2" rx="7.6" ry="2.8" />
    <path d="M4.4 6.2v11.6c0 1.55 3.4 2.8 7.6 2.8s7.6-1.25 7.6-2.8V6.2" />
    <path d="M4.4 12c0 1.55 3.4 2.8 7.6 2.8s7.6-1.25 7.6-2.8" />
  </>,
);

// ------------------------------------------------------------ connectivity

export const IconSync = svg(
  <>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 4v4h-4" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 20v-4h4" />
  </>,
);

export const IconCloudOff = svg(
  <>
    <path d="M6.2 18.5a4 4 0 0 1-.5-7.97 6 6 0 0 1 8.9-3.9" />
    <path d="M17 8.7a5 5 0 0 1 1.4 9.5" />
    <path d="M8.5 18.5h8.4" />
    <path d="M3 3 21 21" />
  </>,
);

export const IconCloudCheck = svg(
  <>
    <path d="M17.5 18.5H6.3a4 4 0 0 1-.6-7.97 6.2 6.2 0 0 1 11.9 1.1 3.45 3.45 0 0 1-.1 6.87Z" />
    <path d="M9.5 14 11.6 16.1 15.2 12" />
  </>,
);

export const IconAlert = svg(
  <>
    <path d="M12 4.5 2.8 20h18.4L12 4.5Z" />
    <path d="M12 10v4.2" />
    <path d="M12 17.2h.01" />
  </>,
);

export const IconInfo = svg(
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11.2v5" />
    <path d="M12 8.1h.01" />
  </>,
);

export const IconClock = svg(
  <>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.4V12l3.2 1.9" />
  </>,
);

export const IconCalculator = svg(
  <>
    <rect x="4.6" y="3.2" width="14.8" height="17.6" rx="2.4" />
    <path d="M8 7.4h8" />
    <path d="M8.6 12h.01" />
    <path d="M12 12h.01" />
    <path d="M15.4 12h.01" />
    <path d="M8.6 16.2h.01" />
    <path d="M12 16.2h.01" />
    <path d="M15.4 16.2h.01" />
  </>,
);

export const IconSend = svg(
  <>
    <path d="M20.6 3.4 10.4 13.6" />
    <path d="M20.6 3.4 14.2 20.8l-3.8-7.2-7.2-3.8Z" />
  </>,
);

/** Kept as an alias so the pipe-domain sections can read as "pipe". */
export const IconPipe = IconLayers;
