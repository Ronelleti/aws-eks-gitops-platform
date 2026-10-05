import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './components/Icon';
import QuickAdd from './components/QuickAdd';
import TaskDrawer from './components/TaskDrawer';
import { ToastProvider, useToast } from './components/Toasts';
import Board from './views/Board';
import ListView from './views/ListView';
import Insights from './views/Insights';
import System from './views/System';
import { api } from './lib/api';
import { PRIORITIES, applyFilters, plural } from './lib/format';
import { useTheme } from './lib/theme';

const VIEWS = [
  { id: 'board', label: 'Board', icon: 'board', subtitle: 'Drag cards between lanes, or open one to edit it.' },
  { id: 'list', label: 'List', icon: 'list', subtitle: 'Every task in one sortable table.' },
  { id: 'insights', label: 'Insights', icon: 'chart', subtitle: 'How the work is going.' },
  { id: 'system', label: 'System', icon: 'server', subtitle: 'The platform behind this page, live.' },
];
const viewFromHash = () => {
  const v = window.location.hash.replace('#/', '');
  return VIEWS.some((x) => x.id === v) ? v : 'board';
};

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--brand-mark-bg)" />
      <rect x="6" y="9" width="20" height="14" rx="1.5" fill="var(--accent)" />
      <path d="M10 9v14M14 9v14M18 9v14M22 9v14" stroke="var(--brand-mark-bg)" strokeWidth="1.4" />
    </svg>
  );
}

const optimisticFields = (patch) => {
  const o = { ...patch, updated_at: new Date().toISOString() };
  if (patch.status) { o.done = patch.status === 'done'; o.completed_at = patch.status === 'done' ? new Date().toISOString() : null; }
  return o;
};

function Shell() {
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState(viewFromHash);
  const [tasks, setTasks] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [info, setInfo] = useState(null);
  const [podFlash, setPodFlash] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [filters, setFilters] = useState({ q: '', priority: '', tag: '', overdue: false });
  const [version, setVersion] = useState(0); // bumped after every change, so Insights fetches fresh numbers
  const lastPod = useRef(null);
  const tasksRef = useRef([]);
  const quickRef = useRef(null);
  const searchRef = useRef(null);
  tasksRef.current = tasks || [];

  useEffect(() => {
    const on = () => setView(viewFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const refreshInfo = useCallback(async () => {
    try {
      const next = await api.info();
      if (lastPod.current && lastPod.current !== next.pod) { setPodFlash(true); setTimeout(() => setPodFlash(false), 1200); }
      lastPod.current = next.pod;
      setInfo(next);
    } catch { setInfo(null); }
  }, []);

  const load = useCallback(async () => {
    try { setTasks(await api.tasks()); setLoadError(''); }
    catch (e) { setLoadError(e.message); }
    finally { refreshInfo(); }
  }, [refreshInfo]);
  useEffect(() => { load(); }, [load]);

  const touched = useCallback(() => { setVersion((v) => v + 1); refreshInfo(); }, [refreshInfo]);

  const update = useCallback(async (id, patch) => {
    const previous = tasksRef.current.find((t) => t.id === id);
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...optimisticFields(patch) } : t))); // show it at once
    try {
      const saved = await api.update(id, patch);
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...saved } : t)));
      touched();
      return saved;
    } catch (e) {
      if (previous) setTasks((ts) => ts.map((t) => (t.id === id ? previous : t)));
      toast(e.message, 'error');
      throw e;
    }
  }, [toast, touched]);

  const move = useCallback((id, status) => update(id, { status }).catch(() => {}), [update]);

  const create = useCallback(async (input) => {
    const t = await api.create(input);
    setTasks((ts) => [t, ...ts]);
    toast('Task added', 'success');
    touched();
    return t;
  }, [toast, touched]);

  const remove = useCallback(async (id) => {
    try {
      await api.remove(id);
      setTasks((ts) => ts.filter((t) => t.id !== id));
      toast('Task deleted', 'success');
      touched();
    } catch (e) { toast(e.message, 'error'); throw e; }
  }, [toast, touched]);

  async function seed() {
    try {
      const r = await api.seedDemo();
      toast(`Added ${r.created} sample tasks`, 'success');
      await load();
      setVersion((v) => v + 1);
    } catch (e) { toast(e.message, 'error'); }
  }

  // n focuses "new task", / focuses search, Escape closes the drawer
  useEffect(() => {
    const on = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
      if (e.key === 'n') {
        e.preventDefault();
        if (view !== 'board' && view !== 'list') window.location.hash = '/board';
        setTimeout(() => quickRef.current?.focus(), 0);
      } else if (e.key === '/') {
        e.preventDefault();
        if (view !== 'board' && view !== 'list') window.location.hash = '/board';
        setTimeout(() => searchRef.current?.focus(), 0);
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [view]);

  const all = tasks || [];
  const shown = useMemo(() => applyFilters(all, filters), [all, filters]);
  const tags = useMemo(() => [...new Set(all.flatMap((t) => t.tags))].sort(), [all]);
  const filtering = filters.q || filters.priority || filters.tag || filters.overdue;
  const open = all.filter((t) => t.status !== 'done').length;
  const current = VIEWS.find((v) => v.id === view);
  const tasksView = view === 'board' || view === 'list';

  let subtitle = current.subtitle;
  if (tasksView && tasks) subtitle = filtering ? `${plural(shown.length, 'task')} match your filters. ${current.subtitle}` : `${open} open, ${all.length - open} done. ${current.subtitle}`;

  return (
    <div className="app">
      <aside className="rail" aria-label="Main">
        <a className="brand" href="#/board"><BrandMark /><span>Dockside</span></a>
        <nav aria-label="Views">
          <ul>
            {VIEWS.map((v) => (
              <li key={v.id}>
                <a href={`#/${v.id}`} aria-current={view === v.id ? 'page' : undefined}><Icon name={v.icon} />{v.label}
                  {v.id === 'board' && tasks && open > 0 && <span className="badge">{open}</span>}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail-foot">
          <a className={`live ${podFlash ? 'flash' : ''}`} href="#/system" title="The pod that answered your last request">
            <span className={`dot ${info ? 'ok' : 'bad'}`} aria-hidden="true" />
            <span><span className="live-label">{info ? 'Served by' : 'Server'}</span><span className="mono live-pod">{info ? info.pod : 'unreachable'}</span></span>
          </a>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />{theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          {info && <p className="rail-version mono" title="The version of the API that answered">{String(info.version).slice(0, 8)} in {info.env}</p>}
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <h1>{current.label}</h1>
            <p className="subtitle">{subtitle}</p>
          </div>
          {tasksView && (
            <div className="search">
              <Icon name="search" size={16} />
              <label className="visually-hidden" htmlFor="search">Search tasks</label>
              <input id="search" ref={searchRef} type="search" placeholder="Search tasks" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
              <kbd aria-hidden="true">/</kbd>
            </div>
          )}
        </header>

        {loadError && (
          <div className="banner" role="alert">
            <span>{loadError}</span>
            <button type="button" className="btn btn-quiet" onClick={load}>Try again</button>
          </div>
        )}

        {tasksView && <QuickAdd inputRef={quickRef} onCreate={create} />}

        {tasksView && tasks && all.length > 0 && (
          <div className="filters" role="group" aria-label="Filters">
            <label>Priority
              <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
                <option value="">Any</option>{PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            {tags.length > 0 && (
              <label>Tag
                <select value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
                  <option value="">Any</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            <label className="check"><input type="checkbox" checked={filters.overdue} onChange={(e) => setFilters({ ...filters, overdue: e.target.checked })} />Overdue only</label>
            {filtering && <button type="button" className="btn btn-quiet" onClick={() => setFilters({ q: '', priority: '', tag: '', overdue: false })}>Clear filters</button>}
          </div>
        )}

        {tasksView && !tasks && !loadError && <div className="skeleton-board" aria-busy="true" aria-label="Loading tasks"><i /><i /><i /></div>}

        {tasksView && tasks && all.length === 0 && (
          <div className="empty">
            <h2>Nothing on the board yet</h2>
            <p>Add your first task above, or fill the board with sample tasks to see how it looks with real data.</p>
            <div className="empty-actions">
              <button type="button" className="btn btn-primary" onClick={() => quickRef.current?.focus()}>Add a task</button>
              <button type="button" className="btn" onClick={seed}>Load sample data</button>
            </div>
          </div>
        )}

        {tasksView && tasks && all.length > 0 && (view === 'board'
          ? <Board tasks={shown} onOpen={setOpenId} onMove={move} />
          : <ListView tasks={shown} onOpen={setOpenId} onUpdate={(id, patch) => update(id, patch).catch(() => {})} />)}

        {view === 'insights' && <Insights version={version} taskCount={all.length} />}
        {view === 'system' && <System />}
      </main>

      {openId && (
        <TaskDrawer taskId={openId} attachmentsEnabled={Boolean(info?.attachments)} maxUploadBytes={info?.maxUploadBytes}
          onClose={() => setOpenId(null)} onUpdate={update} onRemove={remove} onChanged={() => { load(); setVersion((v) => v + 1); }} />
      )}
    </div>
  );
}

export default function App() {
  return <ToastProvider><Shell /></ToastProvider>;
}
