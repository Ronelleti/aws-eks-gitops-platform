import { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { dueInfo, priorityLabel, relTime, statusLabel, STATUSES } from '../lib/format';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const SORTS = {
  title: (a, b) => a.title.localeCompare(b.title),
  status: (a, b) => STATUSES.findIndex((s) => s.id === a.status) - STATUSES.findIndex((s) => s.id === b.status),
  priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  due: (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'),
  updated: (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
};

export default function ListView({ tasks, onOpen, onUpdate }) {
  const [sort, setSort] = useState({ key: 'updated', dir: 1 });
  const rows = useMemo(() => [...tasks].sort((a, b) => SORTS[sort.key](a, b) * sort.dir), [tasks, sort]);
  const head = (key, label) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}>
        {label}{sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  );
  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr><th scope="col" className="narrow"><span className="visually-hidden">Done</span></th>{head('title', 'Task')}{head('status', 'Status')}{head('priority', 'Priority')}{head('due', 'Due')}<th scope="col" className="narrow"><span className="visually-hidden">Attachments</span></th>{head('updated', 'Updated')}</tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const due = dueInfo(t.due_date, t.status);
            return (
              <tr key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                <td className="narrow">
                  <input type="checkbox" checked={t.status === 'done'} aria-label={`Mark ${t.title} as ${t.status === 'done' ? 'not done' : 'done'}`}
                    onChange={() => onUpdate(t.id, { status: t.status === 'done' ? 'todo' : 'done' })} />
                </td>
                <td><button type="button" className="row-title" onClick={() => onOpen(t.id)}>{t.title}</button>
                  {t.tags.length > 0 && <span className="row-tags">{t.tags.map((x) => <span key={x} className="tag">{x}</span>)}</span>}</td>
                <td><span className={`status-pill s-${t.status}`}>{statusLabel(t.status)}</span></td>
                <td><span className={`prio prio-${t.priority}`}>{priorityLabel(t.priority)}</span></td>
                <td>{due ? <span className={`due due-${due.tone}`}>{due.text}</span> : <span className="muted">None</span>}</td>
                <td className="narrow">{t.attachment_count > 0 && <span className="meta-icon"><Icon name="clip" size={14} />{t.attachment_count}</span>}</td>
                <td className="muted">{relTime(t.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="lane-empty">No tasks match these filters.</p>}
    </div>
  );
}
