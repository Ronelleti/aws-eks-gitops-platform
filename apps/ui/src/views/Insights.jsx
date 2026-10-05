import { useEffect, useState } from 'react';
import { DayBars, Donut, HBars } from '../components/Charts';
import { api } from '../lib/api';
import { activityText, bytes, hours, plural, relTime } from '../lib/format';

export default function Insights({ version, taskCount }) {
  const [stats, setStats] = useState(null);
  const [feed, setFeed] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([api.stats(), api.activity(12)])
      .then(([s, a]) => { if (live) { setStats(s); setFeed(a); setError(''); } })
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [version]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!stats) return <p className="muted">Loading insights</p>;
  if (taskCount === 0) return <p className="lane-empty">Insights appear once there are tasks.</p>;

  const open = stats.byStatus.todo + stats.byStatus.doing;
  const donePct = stats.total ? Math.round((stats.byStatus.done / stats.total) * 100) : 0;

  return (
    <div className="insights">
      <dl className="ledger">
        <div><dt>Open tasks</dt><dd>{open}</dd></div>
        <div className={stats.overdue ? 'alert' : ''}><dt>Overdue</dt><dd>{stats.overdue}</dd></div>
        <div><dt>Due in 3 days</dt><dd>{stats.dueSoon}</dd></div>
        <div><dt>Average time to finish</dt><dd className="small">{hours(stats.avgCompletionHours)}</dd></div>
      </dl>

      <div className="insights-grid">
        <section aria-labelledby="ins-status">
          <h2 id="ins-status">Where the work is</h2>
          <div className="status-split">
            <Donut segments={[
              { label: 'To do', value: stats.byStatus.todo, color: 'var(--c-todo)' },
              { label: 'In progress', value: stats.byStatus.doing, color: 'var(--c-doing)' },
              { label: 'Done', value: stats.byStatus.done, color: 'var(--c-done)' },
            ]}>
              <strong>{donePct}%</strong><span>done</span>
            </Donut>
            <ul className="legend">
              <li><i style={{ background: 'var(--c-todo)' }} />To do <b>{stats.byStatus.todo}</b></li>
              <li><i style={{ background: 'var(--c-doing)' }} />In progress <b>{stats.byStatus.doing}</b></li>
              <li><i style={{ background: 'var(--c-done)' }} />Done <b>{stats.byStatus.done}</b></li>
            </ul>
          </div>
        </section>

        <section aria-labelledby="ins-prio">
          <h2 id="ins-prio">Open tasks by priority</h2>
          <HBars rows={[
            { label: 'High', value: stats.openByPriority.high, color: 'var(--c-high)' },
            { label: 'Medium', value: stats.openByPriority.medium, color: 'var(--c-medium)' },
            { label: 'Low', value: stats.openByPriority.low, color: 'var(--c-low)' },
          ]} />
          <h2 id="ins-tags" className="spaced">Most used tags</h2>
          <HBars rows={stats.topTags.map((t) => ({ label: t.tag, value: t.n }))} empty="No tags yet" />
        </section>

        <section className="wide" aria-labelledby="ins-days">
          <h2 id="ins-days">The last two weeks</h2>
          <DayBars days={stats.daily} />
          <p className="legend-inline"><i style={{ background: 'var(--c-created)' }} />Created <i style={{ background: 'var(--c-done)' }} />Completed</p>
        </section>

        <section aria-labelledby="ins-feed">
          <h2 id="ins-feed">Recent activity</h2>
          <ul className="feed">
            {feed.map((a) => (
              <li key={a.id}>
                <span className="feed-what"><b>{a.task_title || 'A task'}</b> {activityText(a)}</span>
                <span className="feed-when"><time dateTime={a.created_at}>{relTime(a.created_at)}</time>
                  {a.pod && <span className="mono pod" title="The pod that handled this change">{a.pod}</span>}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="ins-files">
          <h2 id="ins-files">Attachments</h2>
          <p className="big-line"><strong>{plural(stats.attachments.count, 'file')}</strong> <span className="muted">using {bytes(stats.attachments.bytes)} in S3</span></p>
        </section>
      </div>
    </div>
  );
}
