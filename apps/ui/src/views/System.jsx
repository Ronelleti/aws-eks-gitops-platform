import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { Sparkline } from '../components/Charts';
import { api } from '../lib/api';
import { bytes, relTime, uptime } from '../lib/format';

const PROBES = 30;

export default function System() {
  const [sys, setSys] = useState(null);
  const [error, setError] = useState('');
  const [latency, setLatency] = useState([]);
  const [seen, setSeen] = useState({});            // pod -> responses seen since this page opened
  const [tally, setTally] = useState(null);        // result of the last "send requests" run
  const [probing, setProbing] = useState(0);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.system();
      if (!alive.current) return null;
      setSys(s);
      setError('');
      setLatency((l) => [...l.slice(-29), s.database.latencyMs]);
      setSeen((m) => ({ ...m, [s.instance.pod]: (m[s.instance.pod] || 0) + 1 }));
      return s;
    } catch (e) {
      if (alive.current) setError(e.message);
      return null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => { alive.current = false; clearInterval(t); };
  }, [refresh]);

  // Sends requests in small batches and counts which pod answered each one.
  async function probe() {
    setTally({}); setProbing(1);
    const counts = {};
    let done = 0;
    while (done < PROBES && alive.current) {
      const batch = Math.min(5, PROBES - done);
      const results = await Promise.all(Array.from({ length: batch }, () => api.info().catch(() => null)));
      results.forEach((r) => { if (r) counts[r.pod] = (counts[r.pod] || 0) + 1; });
      done += batch;
      setTally({ ...counts });
      setProbing(done / PROBES);
    }
    setProbing(0);
  }

  if (error && !sys) return <p className="error" role="alert">{error}</p>;
  if (!sys) return <p className="muted">Reading the system</p>;

  const { instance, database, storage, process: proc, served } = sys;
  const tallyRows = Object.entries(tally || {}).sort((a, b) => b[1] - a[1]);
  const tallyTotal = tallyRows.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="system">
      <section className="served" aria-label="This request was served by">
        <p className="served-label">This page was answered by</p>
        <p className="served-pod mono" data-testid="pod">{instance.pod}</p>
        <dl className="inline-facts">
          <div><dt>Version</dt><dd className="mono">{String(instance.version).slice(0, 12)}</dd></div>
          <div><dt>Environment</dt><dd>{instance.env}</dd></div>
          {instance.node && <div><dt>Node</dt><dd className="mono">{instance.node}</dd></div>}
          {instance.region && <div><dt>Region</dt><dd>{instance.region}</dd></div>}
          <div><dt>Up for</dt><dd>{uptime(proc.uptimeSeconds)}</dd></div>
        </dl>
      </section>

      <section className="lb" aria-labelledby="lb-h">
        <div className="lb-head">
          <div>
            <h2 id="lb-h">How requests spread across pods</h2>
            <p className="muted">Each request goes through the load balancer to any healthy API pod. Send {PROBES} requests and count who answers.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={probe} disabled={probing > 0}>{probing > 0 ? `Sending ${Math.round(probing * 100)}%` : `Send ${PROBES} requests`}</button>
        </div>
        {tally && (tallyRows.length ? (
          <ul className="tally" aria-live="polite">
            {tallyRows.map(([pod, count]) => (
              <li key={pod}><span className="mono">{pod}</span>
                <span className="tally-track"><span style={{ width: `${(count / Math.max(tallyTotal, 1)) * 100}%` }} /></span>
                <b>{count}</b></li>
            ))}
          </ul>
        ) : <p className="muted">Waiting for answers</p>)}
        {tally && tallyRows.length === 1 && !probing && <p className="note">Only one pod answered. That is expected when the API runs a single replica.</p>}
        <p className="muted small">Pods that have answered since you opened this page: {Object.entries(seen).map(([p, c]) => `${p} (${c})`).join(', ')}</p>
      </section>

      <div className="system-grid">
        <section aria-labelledby="sys-db">
          <h2 id="sys-db"><Icon name="database" /> Database</h2>
          <dl className="facts">
            <div><dt>Answered in</dt><dd><strong>{database.latencyMs.toFixed(1)} ms</strong></dd></div>
            <div><dt>PostgreSQL</dt><dd>{database.version}</dd></div>
            <div><dt>Host</dt><dd className="mono wrap">{database.host}</dd></div>
            <div><dt>Encrypted connection</dt><dd>{database.tls ? 'Yes' : 'No'}</dd></div>
            <div><dt>Schema version</dt><dd>{database.schemaVersion}</dd></div>
            <div><dt>Size</dt><dd>{bytes(database.sizeBytes)}</dd></div>
            <div><dt>Connections</dt><dd>{database.pool.total} open, {database.pool.idle} idle</dd></div>
          </dl>
          <div className="spark-row"><Sparkline values={latency} label="Database response time over the last samples" /><span className="muted small">last {latency.length} samples</span></div>
        </section>

        <section aria-labelledby="sys-s3">
          <h2 id="sys-s3"><Icon name="bucket" /> File storage</h2>
          {!storage.enabled ? <p className="muted">Off. No S3 bucket is configured for this environment.</p> : (
            <dl className="facts">
              <div><dt>Status</dt><dd><span className={`dot ${storage.ok ? 'ok' : 'bad'}`} />{storage.ok ? 'Reachable' : 'Not reachable'}</dd></div>
              <div><dt>Answered in</dt><dd><strong>{storage.latencyMs.toFixed(0)} ms</strong></dd></div>
              <div><dt>Bucket</dt><dd className="mono wrap">{storage.bucket}</dd></div>
              <div><dt>Region</dt><dd>{storage.region}</dd></div>
              {storage.note && <div><dt>Note</dt><dd>{storage.note}</dd></div>}
            </dl>
          )}
        </section>

        <section aria-labelledby="sys-proc">
          <h2 id="sys-proc"><Icon name="pulse" /> This pod</h2>
          <dl className="facts">
            <div><dt>Started</dt><dd>{relTime(proc.startedAt)}</dd></div>
            <div><dt>Memory</dt><dd>{proc.rssMb} MB ({proc.heapUsedMb} MB heap)</dd></div>
            <div><dt>Runtime</dt><dd>Node {proc.node}</dd></div>
            <div><dt>API requests answered</dt><dd><strong>{served.total}</strong></dd></div>
            <div><dt>Successful</dt><dd>{served.byClass['2xx']}</dd></div>
            <div><dt>Client errors</dt><dd>{served.byClass['4xx']}</dd></div>
            <div><dt>Server errors</dt><dd className={served.byClass['5xx'] ? 'bad-text' : ''}>{served.byClass['5xx']}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
