import { useState } from 'react';
import Icon from './Icon';
import { PRIORITIES } from '../lib/format';

export default function QuickAdd({ inputRef, onCreate }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  async function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) {
      setHint('Write a title first.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await onCreate({ title: t, priority, due_date: due || null });
      setTitle('');
      setDue('');
      setHint('');
    } catch (err) {
      setHint(err.fields?.title || err.message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <form className="quickadd" onSubmit={submit}>
      <div className="quickadd-row">
        <label className="visually-hidden" htmlFor="quickadd-title">New task title</label>
        <input id="quickadd-title" ref={inputRef} value={title} maxLength={120} autoComplete="off"
          placeholder="Add a task and press Enter" onChange={(e) => { setTitle(e.target.value); if (hint) setHint(''); }} />
        <label className="visually-hidden" htmlFor="quickadd-priority">Priority of the new task</label>
        <select id="quickadd-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label} priority</option>)}
        </select>
        <label className="visually-hidden" htmlFor="quickadd-due">Due date of the new task</label>
        <input id="quickadd-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={busy}><Icon name="plus" size={16} />Add task</button>
      </div>
      {hint && <p className="hint" role="alert">{hint}</p>}
    </form>
  );
}
