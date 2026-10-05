// Charts are plain SVG: no chart library, so the whole UI stays a few hundred KB.
import { shortDate } from '../lib/format';

export function Donut({ segments, size = 168, thickness = 20, children }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={thickness} />
          {total > 0 && segments.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * c;
            const el = (
              <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
                strokeDasharray={`${Math.max(len - 2, 0)} ${c - Math.max(len - 2, 0)}`} strokeDashoffset={-offset}>
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  );
}

// Two bars per day: tasks created and tasks completed
export function DayBars({ days, height = 150 }) {
  const width = 560;
  const pad = { l: 26, r: 6, t: 8, b: 22 };
  const max = Math.max(1, ...days.flatMap((d) => [d.created, d.completed]));
  const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const slot = innerW / days.length;
  const bar = Math.max(4, slot * 0.34);
  const y = (v) => pad.t + innerH - (v / niceMax) * innerH;
  const ticks = [0, Math.round(niceMax / 2), niceMax].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <svg className="daybars" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label="Tasks created and completed per day over the last 14 days">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" strokeWidth="1" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text>
        </g>
      ))}
      {days.map((d, i) => {
        const cx = pad.l + slot * i + slot / 2;
        return (
          <g key={d.day}>
            <rect x={cx - bar - 1} y={y(d.created)} width={bar} height={pad.t + innerH - y(d.created)} rx="1.5" fill="var(--c-created)">
              <title>{`${shortDate(d.day)}: ${d.created} created`}</title>
            </rect>
            <rect x={cx + 1} y={y(d.completed)} width={bar} height={pad.t + innerH - y(d.completed)} rx="1.5" fill="var(--c-done)">
              <title>{`${shortDate(d.day)}: ${d.completed} completed`}</title>
            </rect>
            {(i % 2 === 1 || days.length < 8) && <text x={cx} y={height - 6} textAnchor="middle" className="axis">{Number(d.day.slice(8))}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, width = 160, height = 36, label }) {
  if (values.length < 2) return <div className="spark-empty">Collecting samples</div>;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 6) + 3, height - 4 - ((v - min) / span) * (height - 8)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill="currentColor" />
    </svg>
  );
}

export function HBars({ rows, color = 'var(--ink)', empty = 'Nothing yet' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="hbars-label">{r.label}</span>
          <span className="hbars-track"><span className="hbars-fill" style={{ width: `${(r.value / max) * 100}%`, background: r.color || color }} /></span>
          <span className="hbars-value">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
