import { useState } from 'react';
import Icon from '../components/Icon';
import { STATUSES, dueInfo, nextStatus, priorityLabel, statusLabel } from '../lib/format';

function Card({ task, onOpen, onMove, onDragStart, onDragEnd, dragging }) {
  const due = dueInfo(task.due_date, task.status);
  const advance = nextStatus(task.status);
  return (
    <li>
      <div className={`card ${dragging ? 'dragging' : ''}`} data-priority={task.priority} data-status={task.status}
        draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(task.id)); e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id); }}
        onDragEnd={onDragEnd}>
        <button type="button" className="card-title" onClick={() => onOpen(task.id)}>{task.title}</button>
        <div className="card-meta">
          <span className={`prio prio-${task.priority}`} title={`${priorityLabel(task.priority)} priority`}><Icon name="flag" size={13} />{priorityLabel(task.priority)}</span>
          {due && <span className={`due due-${due.tone}`}><Icon name="calendar" size={13} />{due.text}</span>}
          {task.attachment_count > 0 && <span className="meta-icon" title={`${task.attachment_count} attachment(s)`}><Icon name="clip" size={13} />{task.attachment_count}</span>}
          {task.notes && <span className="meta-icon" title="Has notes"><Icon name="note" size={13} /></span>}
        </div>
        {task.tags.length > 0 && (
          <div className="card-tags">{task.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}{task.tags.length > 3 && <span className="muted">+{task.tags.length - 3}</span>}</div>
        )}
        <button type="button" className="advance" onClick={() => onMove(task.id, advance)}
          aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Move ${task.title} to ${statusLabel(advance)}`}
          title={task.status === 'done' ? 'Reopen' : `Move to ${statusLabel(advance)}`}>
          <Icon name={task.status === 'done' ? 'undo' : 'chevron'} size={16} />
        </button>
      </div>
    </li>
  );
}

export default function Board({ tasks, onOpen, onMove }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  return (
    <div className="board" role="group" aria-label="Task board">
      {STATUSES.map((lane) => {
        const items = tasks.filter((t) => t.status === lane.id);
        return (
          <section key={lane.id} className={`lane lane-${lane.id} ${over === lane.id ? 'over' : ''}`} aria-label={lane.label}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(lane.id); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
            onDrop={(e) => {
              e.preventDefault();
              const id = Number(e.dataTransfer.getData('text/plain'));
              setOver(null); setDragId(null);
              const task = tasks.find((t) => t.id === id);
              if (task && task.status !== lane.id) onMove(id, lane.id);
            }}>
            <header className="lane-head"><h2>{lane.label}</h2><span className="count">{items.length}</span></header>
            <ul className="cards">
              {items.map((t) => (
                <Card key={t.id} task={t} onOpen={onOpen} onMove={onMove} dragging={dragId === t.id}
                  onDragStart={setDragId} onDragEnd={() => { setDragId(null); setOver(null); }} />
              ))}
            </ul>
            {items.length === 0 && <p className="lane-empty">{lane.id === 'done' ? 'Finished tasks land here.' : 'Drop a task here.'}</p>}
          </section>
        );
      })}
    </div>
  );
}
