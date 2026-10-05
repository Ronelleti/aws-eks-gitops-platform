// Small inline icon set (24px grid, drawn with strokes so they follow the text color).
const PATHS = {
  board: 'M4 5h4.5v14H4zM9.75 5h4.5v9h-4.5zM15.5 5H20v11.5h-4.5z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
  server: 'M4 5h16v5H4zM4 14h16v5H4zM8 7.5h.01M8 16.5h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.2-4.2',
  plus: 'M12 5v14M5 12h14',
  clip: 'm20 11-8.2 8.2a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.4 17a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6',
  calendar: 'M5 5h14v15H5zM5 10h14M9 3v4m6-4v4',
  trash: 'M5 7h14M10 7V4h4v3m-8 0 1 13h10l1-13M10 11v6m4-6v6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  chevron: 'm9 6 6 6-6 6',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  note: 'M6 4h9l3 3v13H6zM9 11h6M9 15h6',
  upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 16v4h14v-4',
  file: 'M7 3h7l4 4v14H7zM14 3v4h4',
  download: 'M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M5 20h14',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  database: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zm0 0v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  bucket: 'M5 7h14l-1.6 12.2a1.5 1.5 0 0 1-1.5 1.3H8.1a1.5 1.5 0 0 1-1.5-1.3zM5 7c0-1.7 3.1-3 7-3s7 1.3 7 3',
  tag: 'M3 12V4h8l9 9-8 8zM7.5 8.5h.01',
  flag: 'M5 21V4m0 1h12l-2.5 4L17 13H5',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
};

export default function Icon({ name, size = 18, className = '', title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
