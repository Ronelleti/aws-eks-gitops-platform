export const STATUSES = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'done', label: 'Done' },
];
export const PRIORITIES = [
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
export const statusLabel = (id) => STATUSES.find((s) => s.id === id)?.label ?? id;
export const priorityLabel = (id) => PRIORITIES.find((p) => p.id === id)?.label ?? id;
export const nextStatus = (id) => ({ todo: 'doing', doing: 'done', done: 'todo' })[id] ?? 'todo';

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// 'YYYY-MM-DD' as a local calendar date (new Date('2026-10-06') would be UTC and can shift a day)
function localDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysUntil(dateStr, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((localDate(dateStr) - today) / 86400000);
}

export function shortDate(dateStr) {
  return localDate(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// What to print next to a due date, and how urgent it is
export function dueInfo(dateStr, status, now = new Date()) {
  if (!dateStr) return null;
  if (status === 'done') return { text: shortDate(dateStr), tone: 'done' };
  const d = daysUntil(dateStr, now);
  if (d < 0) return { text: `${plural(-d, 'day')} overdue`, tone: 'overdue' };
  if (d === 0) return { text: 'Due today', tone: 'soon' };
  if (d === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (d <= 3) return { text: `Due in ${d} days`, tone: 'soon' };
  return { text: `Due ${shortDate(dateStr)}`, tone: 'later' };
}

export function relTime(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function hours(h) {
  if (h == null) return 'No data yet';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

export function uptime(seconds) {
  if (seconds < 90) return `${seconds} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `${(seconds / 3600).toFixed(1)} h`;
  return `${Math.round(seconds / 86400)} days`;
}

export const isImage = (type) => /^image\/(png|jpe?g|gif|webp|avif|svg\+xml)$/.test(type || '');

export function activityText(a) {
  switch (a.kind) {
    case 'created': return a.detail === 'Sample data' ? 'Created (sample data)' : 'Created';
    case 'moved': return `Moved from ${a.detail}`;
    case 'edited': return a.detail;
    case 'attached': return `Attached ${a.detail}`;
    case 'detached': return `Removed ${a.detail}`;
    case 'deleted': return 'Deleted';
    default: return a.kind;
  }
}

// The search box, priority, tag and overdue filters, applied in the browser (the list is small)
export function applyFilters(tasks, { q = '', priority = '', tag = '', overdue = false } = {}, now = new Date()) {
  const needle = q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (needle && !`${t.title} ${t.notes} ${t.tags.join(' ')}`.toLowerCase().includes(needle)) return false;
    if (priority && t.priority !== priority) return false;
    if (tag && !t.tags.includes(tag)) return false;
    if (overdue && !(t.due_date && t.status !== 'done' && daysUntil(t.due_date, now) < 0)) return false;
    return true;
  });
}
