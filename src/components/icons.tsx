import type { SVGProps } from 'react';

const paths = {
  home: ['M3 10.6 12 3l9 7.6', 'M5.6 9.4V21h12.8V9.4'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  video: ['M23 7.5 16 12l7 4.5V7.5Z', 'M2 6.5A2.5 2.5 0 0 1 4.5 4h9A2.5 2.5 0 0 1 16 6.5v11A2.5 2.5 0 0 1 13.5 20h-9A2.5 2.5 0 0 1 2 17.5v-11Z'],
  shop: ['M3 9h18l-1.5 11.5H4.5L3 9Z', 'M8.5 9V6.5a3.5 3.5 0 0 1 7 0V9'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
  chat: ['M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-4-.9L3 21l1.9-5.5A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z'],
  user: ['M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  group: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', 'M21 21v-2a4 4 0 0 0-3-3.87'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', 'M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.3-4.3'],
  plus: ['M12 5v14', 'M5 12h14'],
  heart: ['M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8Z'],
  comment: ['M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.9 8.9 0 0 1-4-.9L3 21l1.9-5.5A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5Z'],
  share: ['M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7', 'M16 6l-4-4-4 4', 'M12 2v13'],
  bookmark: ['M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16Z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  back: ['M15 18l-6-6 6-6'],
  camera: ['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2v11Z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8'],
  send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4 20-7Z'],
  image: ['M3 5h18v14H3z', 'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3', 'M21 15l-5-5L5 21'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z'],
  check: ['M20 6 9 17l-5-5'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  eye: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6'],
  play: ['M6 4l14 8-14 8V4Z'],
  pin: ['M12 22s7-6.3 7-12a7 7 0 1 0-14 0c0 5.7 7 12 7 12Z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  trend: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  sparkle: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z'],
  reply: ['M9 17l-5-5 5-5', 'M4 12h11a5 5 0 0 1 5 5v2'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 22,
  filled = false,
  strokeWidth = 1.8,
  ...rest
}: { name: IconName; size?: number; filled?: boolean; strokeWidth?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span
      className="grid place-items-center rounded-[0.9rem] bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-[0_8px_20px_-10px_rgba(26,99,240,0.9)]"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <path d="M4 6.5h11M9.5 6.5V19" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="18.5" cy="16.5" r="3.2" stroke="white" strokeWidth="2" />
      </svg>
    </span>
  );
}
