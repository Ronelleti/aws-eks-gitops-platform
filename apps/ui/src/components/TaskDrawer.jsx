import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { useToast } from './Toasts';
import { api, putFile } from '../lib/api';
import { STATUSES, PRIORITIES, activityText, bytes, isImage, relTime } from '../lib/format';

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} data-value={o.id}
            className={value === o.id ? 'on' : ''} onClick={() => value !== o.id && onChange(o.id)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export default function TaskDrawer({ taskId, attachmentsEnabled, maxUploadBytes = 10485760, onClose, onUpdate, onRemove, onChanged }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagText, setTagText] = useState('');
  const [uploads, setUploads] = useState([]);
  const [thumbs, setThumbs] = useState({});
  const [preview, setPreview] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);
  const panelRef = useRef(null);
  const titleRef = useRef(null);
  const focused = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api.task(taskId);
      setDetail(d);
      setTitle(d.title);
      setNotes(d.notes);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [taskId]);

  // remember what had focus, so closing the drawer puts it back
  useEffect(() => {
    const opener = document.activeElement;
    load();
    return () => opener?.focus?.();
  }, [load]);

  useEffect(() => {
    if (detail && !focused.current) { focused.current = true; titleRef.current?.focus(); }
  }, [detail]);

  // small previews for images (links are short-lived, so they are fetched on demand)
  const attachmentIds = detail?.attachments.map((a) => a.id).join(',');
  useEffect(() => {
    if (!detail || !attachmentsEnabled) return undefined;
    let live = true;
    detail.attachments.filter((a) => isImage(a.content_type)).slice(0, 6).forEach(async (a) => {
      try {
        const { url } = await api.downloadUrl(a.id, true);
        if (live) setThumbs((t) => ({ ...t, [a.id]: url }));
      } catch { /* a missing preview is not worth an error */ }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentIds, attachmentsEnabled]);

  async function commit(patch) {
    try {
      await onUpdate(taskId, patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await load();
    } catch { /* the caller already showed the error */ }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = panelRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function addTags(text) {
    const incoming = text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    if (!incoming.length) return;
    const next = [...new Set([...detail.tags, ...incoming])];
    if (next.length > 8) { toast('Use at most 8 tags.', 'error'); return; }
    setTagText('');
    commit({ tags: next });
  }

  async function upload(files) {
    for (const file of files) {
      if (file.size > maxUploadBytes) { toast(`${file.name} is larger than ${Math.round(maxUploadBytes / 1048576)} MB.`, 'error'); continue; }
      const uid = `${Date.now()}-${Math.random()}`;
      setUploads((u) => [...u, { id: uid, name: file.name, pct: 0 }]);
      try {
        const { attachment, uploadUrl } = await api.requestUpload(taskId, file);
        await putFile(uploadUrl, file, (p) => setUploads((u) => u.map((x) => (x.id === uid ? { ...x, pct: p } : x))));
        await api.confirmUpload(attachment.id);
        toast(`Attached ${file.name}`, 'success');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setUploads((u) => u.filter((x) => x.id !== uid));
      }
    }
    await load();
    onChanged?.();
  }

  async function openFile(a) {
    try {
      const { url } = await api.downloadUrl(a.id, isImage(a.content_type));
      if (isImage(a.content_type)) setPreview({ url, name: a.filename });
      else window.location.assign(url); // the file arrives as a download, the page stays where it is
    } catch (e) { toast(e.message, 'error'); }
  }

  async function removeFile(a) {
    try {
      await api.deleteAttachment(a.id);
      toast(`Removed ${a.filename}`, 'success');
      await load();
      onChanged?.();
    } catch (e) { toast(e.message, 'error'); }
  }

  function askDelete() {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return; }
    onRemove(taskId).then(onClose).catch(() => {});
  }

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={panelRef} onKeyDown={onKeyDown}>
        <header className="drawer-head">
          <span className="muted">Task {taskId}</span>
          <span className="saved" aria-live="polite">{saved ? 'Saved' : ''}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close task"><Icon name="x" /></button>
        </header>

        {!detail ? (
          error ? <p className="error pad" role="alert">{error}</p> : <div className="skeleton pad" aria-busy="true">Loading task</div>
        ) : (
          <div className="drawer-body">
            <input id="drawer-title" ref={titleRef} className="drawer-title" value={title} maxLength={120} aria-label="Title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                const t = title.trim();
                if (!t) setTitle(detail.title);
                else if (t !== detail.title) commit({ title: t });
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />

            <Segmented label="Status" value={detail.status} options={STATUSES} onChange={(status) => commit({ status })} />
            <Segmented label="Priority" value={detail.priority} options={PRIORITIES} onChange={(priority) => commit({ priority })} />

            <div className="field">
              <label className="field-label" htmlFor="drawer-due">Due date</label>
              <div className="due-edit">
                <input id="drawer-due" type="date" value={detail.due_date || ''} onChange={(e) => commit({ due_date: e.target.value || null })} />
                {detail.due_date && <button type="button" className="btn btn-quiet" onClick={() => commit({ due_date: null })}>Clear</button>}
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="drawer-tags">Tags</label>
              <div className="tags-edit">
                {detail.tags.map((t) => (
                  <span className="tag" key={t}>{t}
                    <button type="button" aria-label={`Remove tag ${t}`} onClick={() => commit({ tags: detail.tags.filter((x) => x !== t) })}><Icon name="x" size={12} /></button>
                  </span>
                ))}
                <input id="drawer-tags" value={tagText} placeholder={detail.tags.length ? 'Add a tag' : 'Add tags, separated by commas'} maxLength={24}
                  onChange={(e) => setTagText(e.target.value)} onBlur={() => addTags(tagText)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTags(tagText); }
                    if (e.key === 'Backspace' && !tagText && detail.tags.length) commit({ tags: detail.tags.slice(0, -1) });
                  }} />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="drawer-notes">Notes</label>
              <textarea id="drawer-notes" rows={4} value={notes} maxLength={5000} placeholder="Context, links, next steps"
                onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== detail.notes && commit({ notes })} />
            </div>

            <section className="field" aria-label="Attachments">
              <span className="field-label">Attachments</span>
              {!attachmentsEnabled ? (
                <p className="muted">Attachments are off in this environment because no storage bucket is configured.</p>
              ) : (
                <>
                  <ul className="files">
                    {detail.attachments.map((a) => (
                      <li key={a.id}>
                        {thumbs[a.id] ? (
                          <button type="button" className="thumb" onClick={() => openFile(a)} aria-label={`Preview ${a.filename}`}><img src={thumbs[a.id]} alt="" /></button>
                        ) : (
                          <span className="thumb thumb-file"><Icon name="file" /></span>
                        )}
                        <button type="button" className="file-name" onClick={() => openFile(a)}>{a.filename}</button>
                        <span className="muted">{bytes(a.size_bytes)}</span>
                        <button type="button" className="icon-btn" onClick={() => removeFile(a)} aria-label={`Remove ${a.filename}`}><Icon name="trash" size={16} /></button>
                      </li>
                    ))}
                    {uploads.map((u) => (
                      <li key={u.id} className="uploading">
                        <span className="thumb thumb-file"><Icon name="upload" /></span>
                        <span className="file-name">{u.name}</span>
                        <span className="progress" role="progressbar" aria-valuenow={Math.round(u.pct * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${u.pct * 100}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                  <label className={`drop ${dragging ? 'over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); upload([...e.dataTransfer.files]); }}>
                    <Icon name="upload" />
                    <span>Drop files here or <u>choose files</u></span>
                    <input type="file" multiple onChange={(e) => { upload([...e.target.files]); e.target.value = ''; }} />
                  </label>
                </>
              )}
            </section>

            <section className="field" aria-label="Activity">
              <span className="field-label">Activity</span>
              <ul className="timeline">
                {detail.activity.map((a) => (
                  <li key={a.id}>
                    <span>{activityText(a)}</span>
                    <time dateTime={a.created_at}>{relTime(a.created_at)}</time>
                    {a.pod && <span className="mono pod" title="The pod that handled this change">{a.pod}</span>}
                  </li>
                ))}
              </ul>
            </section>

            <button type="button" className={`btn btn-danger ${confirmDelete ? 'armed' : ''}`} onClick={askDelete}>
              <Icon name="trash" size={16} />{confirmDelete ? 'Click again to delete' : 'Delete task'}
            </button>
          </div>
        )}

        {preview && (
          <div className="preview" role="dialog" aria-label={`Preview of ${preview.name}`}>
            <button type="button" className="icon-btn" onClick={() => setPreview(null)} aria-label="Close preview"><Icon name="x" /></button>
            <img src={preview.url} alt={preview.name} />
          </div>
        )}
      </aside>
    </div>
  );
}
