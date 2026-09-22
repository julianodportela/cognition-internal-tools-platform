import type { SVGProps } from 'react';

const PATHS = {
  refund: ['M3 10h11a4 4 0 0 1 0 8H9', 'M7 6 3 10l4 4', 'M17 4h4v4'],
  flag: ['M5 21V4', 'M5 4h12l-2 4 2 4H5'],
  'id-card': ['M3 6h18v12H3z', 'M7 10h3v3H7z', 'M13 10h4', 'M13 13h4', 'M7 16h10'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M22 21v-2a4 4 0 0 0-3-3.9', 'M16 3.1a4 4 0 0 1 0 7.8'],
  chart: ['M3 3v18h18', 'M7 14l4-4 3 3 5-6'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13L22 12v7H2v-7z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  'arrow-right': ['M5 12h14', 'M13 6l6 6-6 6'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-up': ['M18 15l-6-6-6 6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  'switch-user': ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  paperclip: ['M21.4 11.05l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5'],
  note: ['M4 4h16v12l-4 4H4z', 'M16 20v-4h4', 'M8 9h8', 'M8 13h5'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  warning: ['M12 3 2 21h20z', 'M12 10v4', 'M12 18h.01'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
  filter: ['M3 5h18l-7 8v6l-4-2v-4z'],
  'file-text': ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M9 13h6', 'M9 17h6'],
  upload: ['M12 16V4', 'M6 10l6-6 6 6', 'M4 20h16'],
  plus: ['M12 5v14', 'M5 12h14'],
  history: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5', 'M12 7v5l3 2'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
} as const;

export type IconName = keyof typeof PATHS;

export function isIconName(s: string): s is IconName {
  return s in PATHS;
}

const LEGACY: Record<string, IconName> = {
  '💸': 'refund',
  '🚩': 'flag',
  '🪪': 'id-card',
  '🧾': 'receipt',
  '🧪': 'settings',
};

export function Icon({
  name,
  size = 16,
  className = '',
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Renders a manifest `icon` (icon name, legacy emoji, or anything else -> monogram). */
export function AppIcon({
  icon,
  label,
  size = 16,
  className = '',
}: {
  icon: string;
  label: string;
  size?: number;
  className?: string;
}) {
  const name = isIconName(icon) ? icon : LEGACY[icon];
  if (name) return <Icon name={name} size={size} className={className} />;
  return (
    <span
      className={`inline-flex items-center justify-center font-semibold leading-none ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.6 }}
    >
      {label.trim().charAt(0).toUpperCase()}
    </span>
  );
}
