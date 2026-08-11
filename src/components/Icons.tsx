/** Inline stroke icons — no icon dependency, and they inherit currentColor. */

interface Props {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const IconToday = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <path d="M12 21a8 8 0 0 0 8-8c0-4-3-6.5-3-10-2 1.5-2.5 3-2.5 4.5C14.5 5 13 3 11 2c.5 3-1.5 4.5-3 6.5A8 8 0 0 0 12 21Z" />
  </svg>
)

export const IconPlan = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 14h3M8 17.5h6" />
  </svg>
)

export const IconFoods = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 3v7a2.5 2.5 0 0 0 5 0V3M6.5 3v18" />
    <path d="M15 21V3c2.8 0 4.5 2.2 4.5 5s-1.7 4.5-4.5 4.5" />
  </svg>
)

export const IconTrends = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <path d="M3 20h18" />
    <path d="M6 20v-5M11 20V8M16 20v-8M21 20V4" />
  </svg>
)

export const IconSettings = ({ size = 22 }: Props) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 14a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.5V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.5 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
)

export const IconPlus = ({ size = 20 }: Props) => (
  <svg {...base(size)} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconChevronLeft = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M15 19l-7-7 7-7" />
  </svg>
)

export const IconChevronRight = ({ size = 20 }: Props) => (
  <svg {...base(size)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

export const IconClose = ({ size = 20 }: Props) => (
  <svg {...base(size)} strokeWidth={2.1}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const IconSearch = ({ size = 18 }: Props) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

export const IconTrash = ({ size = 18 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const IconRepeat = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)

export const IconCopy = ({ size = 18 }: Props) => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H5.5A2.5 2.5 0 0 0 3 5.5v7A2.5 2.5 0 0 0 5.5 15" />
  </svg>
)

export const IconCheck = ({ size = 18 }: Props) => (
  <svg {...base(size)} strokeWidth={2.3}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
)

export const IconEdit = ({ size = 18 }: Props) => (
  <svg {...base(size)}>
    <path d="M4 20h4l10.5-10.5a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20Z" />
    <path d="M13.5 6.5l3.5 3.5" />
  </svg>
)

export const IconMore = ({ size = 20 }: Props) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <circle cx="5" cy="12" r="0.6" />
    <circle cx="12" cy="12" r="0.6" />
    <circle cx="19" cy="12" r="0.6" />
  </svg>
)

export const IconBolt = ({ size = 16 }: Props) => (
  <svg {...base(size)}>
    <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
  </svg>
)
