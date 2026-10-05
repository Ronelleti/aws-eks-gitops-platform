import { useCallback, useEffect, useRef, useState } from 'react';

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [podChanged, setPodChanged] = useState(false);
  const lastPod = useRef(null);

  // Ask the API which pod answered. Called after every action, so with
  // several replicas (or during a canary rollout) you can watch it change.
  const refreshInfo = useCallback(async () => {
    try {
      const next = await api('/info');
      if (lastPod.current && lastPod.current !== next.pod) {
        setPodChanged(true);
        setTimeout(() => setPodChanged(false), 1200);
      }
      lastPod.current = next.pod;
      setInfo(next);
    } catch {
      setInfo(null);
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setTasks(await api('/tasks'));
      setError('');
    } catch (e) {
      setError(`Couldn't load tasks: ${e.message}. Check that the API is running.`);
    } finally {
      setLoading(false);
      refreshInfo();
    }
  }, [refreshInfo]);

  useEffect(() => { load(); }, [load]);

  async function run(action) {
    try {
      await action();
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  function addTask(e) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Write a task title first.');
      return;
    }
    run(async () => {
      await api('/tasks', { method: 'POST', body: JSON.stringify({ title: trimmed }) });
      setTitle('');
    });
  }

  const toggle = (task) =>
    run(() => api(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ done: !task.done }) }));

  const remove = (task) => run(() => api(`/tasks/${task.id}`, { method: 'DELETE' }));

  // Upload goes straight from the browser to S3 using a presigned URL from the API
  const attach = (task, file) =>
    run(async () => {
      // the browser must send exactly the Content-Type the presigned URL was signed with
      const contentType = file.type || 'application/octet-stream';
      const { uploadUrl } = await api(`/tasks/${task.id}/attachment`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      if (!put.ok) throw new Error(`Upload to S3 failed with status ${put.status}`);
    });

  const download = (task) =>
    run(async () => {
      const { downloadUrl } = await api(`/tasks/${task.id}/attachment`);
      window.open(downloadUrl, '_blank', 'noopener');
    });

  const open = tasks.filter((t) => !t.done).length;

  return (
    <div className="page">
      <header className="masthead">
        <h1>Tasks</h1>
        <p className="count">
          {loading ? 'Loading' : tasks.length === 0 ? 'Nothing here yet' : `${open} open of ${tasks.length}`}
        </p>
      </header>

      <form className="composer" onSubmit={addTask}>
        <label htmlFor="new-task" className="visually-hidden">New task</label>
        <input
          id="new-task"
          value={title}
          onChange={(e) => { setTitle(e.target.value); if (error) setError(''); }}
          placeholder="What needs doing?"
          autoComplete="off"
        />
        <button type="submit">Add task</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {!loading && tasks.length === 0 && !error && (
        <p className="empty">Add your first task above. It's saved to Postgres through the API.</p>
      )}

      <ul className="tasks">
        {tasks.map((task) => (
          <li key={task.id} className={task.done ? 'task done' : 'task'}>
            <label className="check">
              <input type="checkbox" checked={task.done} onChange={() => toggle(task)} />
              <span className="title">{task.title}</span>
            </label>
            <div className="actions">
              {info?.attachments && (task.attachment_key ? (
                <button type="button" className="link" onClick={() => download(task)}>Open file</button>
              ) : (
                <label className="link file">
                  Attach file
                  <input type="file" onChange={(e) => e.target.files[0] && attach(task, e.target.files[0])} />
                </label>
              ))}
              <button type="button" className="link danger" onClick={() => remove(task)} aria-label={`Delete ${task.title}`}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className={podChanged ? 'served changed' : 'served'} aria-live="polite">
        {info ? (
          <>
            <span className="dot" aria-hidden="true" />
            <span>Served by pod <code>{info.pod}</code></span>
            <span>Version <code>{info.version}</code></span>
            <span>Environment <code>{info.env}</code></span>
          </>
        ) : (
          <span>API unreachable</span>
        )}
      </footer>
    </div>
  );
}
