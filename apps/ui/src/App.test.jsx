import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';

// A small in-memory stand-in for the API, so the whole UI can be exercised without a server.
function fakeApi(initial = []) {
  let nextId = 100;
  const state = { tasks: initial.map((t) => task(t)), calls: [], failNextPatch: false, pod: 'api-aaa' };
  function task(t) {
    return { id: nextId++, title: 'x', notes: '', tags: [], priority: 'medium', status: 'todo', done: false, due_date: null, attachment_count: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), completed_at: null, ...t };
  }
  const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => structuredClone(body) });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    state.calls.push({ method, url, body });
    const path = url.replace('/api', '');
    let m;
    if (path === '/tasks' && method === 'GET') return json(200, state.tasks);
    if (path === '/info') return json(200, { pod: state.pod, version: 'abcdef123456', env: 'test', attachments: true, maxUploadBytes: 10485760 });
    if (path === '/tasks' && method === 'POST') {
      if (!body.title?.trim()) return json(400, { error: 'Some fields need attention.', fields: { title: 'Write a title for the task.' } });
      const t = task(body); state.tasks.unshift(t); return json(201, t);
    }
    if ((m = path.match(/^\/tasks\/(\d+)$/))) {
      const t = state.tasks.find((x) => x.id === Number(m[1]));
      if (method === 'GET') return json(200, { ...t, attachments: [], activity: [{ id: 1, kind: 'created', detail: '', pod: 'api-aaa', created_at: t.created_at }] });
      if (method === 'PATCH') {
        if (state.failNextPatch) { state.failNextPatch = false; return json(500, { error: 'Something went wrong on our side. Try again in a moment.' }); }
        Object.assign(t, body, body.status ? { done: body.status === 'done' } : {}); return json(200, t);
      }
      if (method === 'DELETE') { state.tasks = state.tasks.filter((x) => x.id !== t.id); return Promise.resolve({ ok: true, status: 204, json: async () => null }); }
    }
    if (path === '/stats') return json(200, { total: 3, byStatus: { todo: 1, doing: 1, done: 1 }, openByPriority: { high: 1, medium: 1, low: 0 }, overdue: 2, dueSoon: 1,
      daily: Array.from({ length: 14 }, (_, i) => ({ day: `2026-09-${String(i + 20).padStart(2, '0')}`, created: i % 3, completed: i % 2 })), topTags: [{ tag: 'aws', n: 2 }],
      attachments: { count: 2, bytes: 2048 }, avgCompletionHours: 30 });
    if (path.startsWith('/activity')) return json(200, [{ id: 1, task_title: 'Ship it', kind: 'moved', detail: 'To do to Done', pod: 'api-aaa', created_at: new Date().toISOString() }]);
    if (path === '/system') return json(200, { instance: { pod: state.pod, version: 'abcdef123456', env: 'test', node: 'node-1', region: 'eu-north-1' },
      process: { uptimeSeconds: 600, startedAt: new Date().toISOString(), node: 'v22', rssMb: 80, heapUsedMb: 30 },
      database: { ok: true, latencyMs: 2.4, version: '16.4', sizeBytes: 9000000, schemaVersion: 4, host: 'db.example', tls: true, pool: { total: 2, idle: 1, waiting: 0 } },
      storage: { enabled: true, ok: true, latencyMs: 30, bucket: 'b', region: 'eu-north-1' }, served: { total: 12, byClass: { '2xx': 11, '3xx': 0, '4xx': 1, '5xx': 0 } } });
    if (path === '/demo/seed') { state.tasks.push(task({ title: 'Sample A' }), task({ title: 'Sample B' })); return json(201, { created: 2 }); }
    return json(404, { error: 'Not found.' });
  });
  return state;
}

const lane = (name) => screen.getByRole('region', { name });
const go = (view) => { window.location.hash = `#/${view}`; window.dispatchEvent(new Event('hashchange')); };

beforeEach(() => { window.location.hash = ''; localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('board', () => {
  it('puts each task in the lane for its status', async () => {
    fakeApi([{ title: 'Plan', status: 'todo' }, { title: 'Build', status: 'doing' }, { title: 'Ship', status: 'done' }]);
    render(<App />);
    await screen.findByText('Plan');
    expect(within(lane('To do')).getByText('Plan')).toBeTruthy();
    expect(within(lane('In progress')).getByText('Build')).toBeTruthy();
    expect(within(lane('Done')).getByText('Ship')).toBeTruthy();
    expect(screen.getByText(/2 open, 1 done/)).toBeTruthy();
  });

  it('shows who answered, and updates it when another pod answers', async () => {
    const api = fakeApi([{ title: 'Plan' }]);
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('api-aaa').length).toBeGreaterThan(0));
    api.pod = 'api-bbb';
    fireEvent.change(screen.getByLabelText('New task title'), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    await waitFor(() => expect(screen.getAllByText('api-bbb').length).toBeGreaterThan(0));
  });

  it('adds a task from the quick-add form', async () => {
    fakeApi([{ title: 'Existing' }]);
    render(<App />);
    await screen.findByText('Existing');
    fireEvent.change(screen.getByLabelText('New task title'), { target: { value: 'Write tests' } });
    fireEvent.change(screen.getByLabelText('Priority of the new task'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    await within(lane('To do')).findByText('Write tests');
    expect(screen.getByText('Task added')).toBeTruthy();
    expect(screen.getByLabelText('New task title').value).toBe(''); // ready for the next one
  });

  it('asks for a title instead of sending an empty task', async () => {
    const api = fakeApi([{ title: 'Existing' }]);
    render(<App />);
    await screen.findByText('Existing');
    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/write a title/i);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('moves a task to the next lane with its arrow button', async () => {
    const api = fakeApi([{ title: 'Plan', status: 'todo' }]);
    render(<App />);
    await screen.findByText('Plan');
    fireEvent.click(screen.getByRole('button', { name: /move plan to in progress/i }));
    await within(lane('In progress')).findByText('Plan');
    expect(api.calls.find((c) => c.method === 'PATCH').body).toEqual({ status: 'doing' });
  });

  it('moves a task by dragging it onto another lane', async () => {
    const api = fakeApi([{ title: 'Drag me', status: 'todo' }]);
    render(<App />);
    await screen.findByText('Drag me');
    const id = api.tasks[0].id;
    fireEvent.drop(lane('Done'), { dataTransfer: { getData: () => String(id) } });
    await within(lane('Done')).findByText('Drag me');
    expect(api.calls.find((c) => c.method === 'PATCH').body).toEqual({ status: 'done' });
  });

  it('puts a card back and says why when the server refuses the change', async () => {
    const api = fakeApi([{ title: 'Plan', status: 'todo' }]);
    render(<App />);
    await screen.findByText('Plan');
    api.failNextPatch = true;
    fireEvent.click(screen.getByRole('button', { name: /move plan to in progress/i }));
    expect(await screen.findByText(/something went wrong on our side/i)).toBeTruthy();
    await waitFor(() => expect(within(lane('To do')).getByText('Plan')).toBeTruthy());
  });

  it('filters by search text', async () => {
    fakeApi([{ title: 'Alpha deploy' }, { title: 'Beta review' }]);
    render(<App />);
    await screen.findByText('Alpha deploy');
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'beta' } });
    expect(screen.queryByText('Alpha deploy')).toBeNull();
    expect(screen.getByText('Beta review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Alpha deploy')).toBeTruthy();
  });

  it('offers sample data on an empty board', async () => {
    fakeApi([]);
    render(<App />);
    expect(await screen.findByText('Nothing on the board yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /load sample data/i }));
    await screen.findByText('Sample A');
  });
});

describe('task drawer', () => {
  it('opens a task, saves edits, and closes with Escape', async () => {
    const api = fakeApi([{ title: 'Plan', status: 'todo', priority: 'medium' }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }));
    const dialog = await screen.findByRole('dialog', { name: undefined });
    expect(within(dialog).getByLabelText('Title').value).toBe('Plan');

    fireEvent.click(within(dialog).getByRole('radio', { name: 'High' }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH' && c.body.priority === 'high')).toBe(true));

    const title = within(dialog).getByLabelText('Title');
    fireEvent.change(title, { target: { value: 'Plan the launch' } });
    fireEvent.blur(title);
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH' && c.body.title === 'Plan the launch')).toBe(true));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('adds a tag by typing it and pressing Enter', async () => {
    const api = fakeApi([{ title: 'Plan' }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }));
    const input = await screen.findByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'Ops' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.calls.some((c) => c.method === 'PATCH' && JSON.stringify(c.body.tags) === '["ops"]')).toBe(true));
  });

  it('deletes only after a second click', async () => {
    const api = fakeApi([{ title: 'Plan' }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Plan' }));
    const del = await screen.findByRole('button', { name: /delete task/i });
    fireEvent.click(del);
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /click again to delete/i }));
    await waitFor(() => expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Plan')).toBeNull());
  });
});

describe('other views and theme', () => {
  it('lists tasks in the table and ticks one off', async () => {
    const api = fakeApi([{ title: 'Plan' }]);
    render(<App />);
    await screen.findByText('Plan');
    go('list');
    fireEvent.click(await screen.findByRole('checkbox', { name: /mark plan as done/i }));
    await waitFor(() => expect(api.calls.find((c) => c.method === 'PATCH').body).toEqual({ status: 'done' }));
  });

  it('shows the numbers on the insights page', async () => {
    fakeApi([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    render(<App />);
    await screen.findByText('a');
    go('insights');
    expect(await screen.findByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Where the work is')).toBeTruthy();
    expect(screen.getByText(/ship it/i)).toBeTruthy(); // the activity feed
  });

  it('shows the pod, database and storage on the system page, and counts pods in a probe', async () => {
    const api = fakeApi([{ title: 'a' }]);
    render(<App />);
    await screen.findByText('a');
    go('system');
    expect((await screen.findByTestId('pod')).textContent).toBe('api-aaa');
    expect(screen.getByText('2.4 ms')).toBeTruthy();
    expect(screen.getByText('Reachable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /send 30 requests/i }));
    await waitFor(() => expect(screen.getByText('30')).toBeTruthy(), { timeout: 4000 });
    expect(api.calls.filter((c) => c.url === '/api/info').length).toBeGreaterThanOrEqual(30);
  });

  it('switches theme and remembers it', async () => {
    fakeApi([{ title: 'a' }]);
    render(<App />);
    await screen.findByText('a');
    fireEvent.click(screen.getByRole('button', { name: /switch to (dark|light) theme/i }));
    const chosen = document.documentElement.dataset.theme;
    expect(['light', 'dark']).toContain(chosen);
    expect(localStorage.getItem('dockside-theme')).toBe(chosen);
  });
});
