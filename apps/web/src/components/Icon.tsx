import React from 'react';

export type IconName =
  | 'home'
  | 'store'
  | 'library'
  | 'gamepad'
  | 'bolt'
  | 'search'
  | 'user'
  | 'play'
  | 'info'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'close'
  | 'chevL'
  | 'chevR'
  | 'folder'
  | 'save'
  | 'globe'
  | 'phone'
  | 'star'
  | 'logout';

const PATHS: Record<IconName, string> = {
  home: 'M3.5 11.2 12 4l8.5 7.2M5.8 9.8V20h12.4V9.8',
  store: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  library: 'M12 3 3 8l9 5 9-5-9-5zM3 12.2l9 5 9-5M3 16.2l9 5 9-5',
  gamepad:
    'M7.2 8h9.6a4.6 4.6 0 0 1 4.5 5.5l-.7 3.3a2.4 2.4 0 0 1-4.1 1.1L14.8 16H9.2l-1.7 1.9a2.4 2.4 0 0 1-4.1-1.1l-.7-3.3A4.6 4.6 0 0 1 7.2 8zM8 10.6v3.2M6.4 12.2h3.2M15.6 11.4h.01M17.6 13.2h.01',
  bolt: 'M13 2.5 4.5 14H11l-1 7.5L19.5 10H13l0-7.5z',
  search: 'M11 4.2a6.8 6.8 0 1 0 0 13.6 6.8 6.8 0 0 0 0-13.6zM20 20l-3.9-3.9',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.2a7.5 7.5 0 0 1 15 0',
  play: 'M7.5 4.6v14.8L19.4 12 7.5 4.6z',
  info: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 11v5.2M12 7.9h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5',
  moon: 'M20 14.6A8 8 0 0 1 9.4 4a8 8 0 1 0 10.6 10.6z',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  chevL: 'M14.5 5.5 8 12l6.5 6.5',
  chevR: 'M9.5 5.5 16 12l-6.5 6.5',
  folder: 'M3 7.2A2.2 2.2 0 0 1 5.2 5h3.6l2 2.2h8A2.2 2.2 0 0 1 21 9.4v8.4A2.2 2.2 0 0 1 18.8 20H5.2A2.2 2.2 0 0 1 3 17.8V7.2z',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  globe: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5S9.4 5.9 12 3.5z',
  phone: 'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2',
  star: 'M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8L12 3.6z',
  logout: 'M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9M15 8l4 4-4 4M19 12H9',
};

const FILLED: IconName[] = ['play'];

interface Props {
  name: IconName;
  size?: number;
  className?: string;
}

export const Icon: React.FC<Props> = ({ name, size = 20, className }) => {
  const filled = FILLED.includes(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
};
