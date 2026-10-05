import { useCallback, useEffect, useState } from 'react';

const KEY = 'dockside-theme';

function initialTheme() {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage can be blocked */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}
