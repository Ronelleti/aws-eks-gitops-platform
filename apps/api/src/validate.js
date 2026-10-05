// Input validation. Returns clean values plus a map of field errors.
const STATUSES = ['todo', 'doing', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];

class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// partial=true (PATCH): only the fields that are present are checked. false (POST): title is required.
function parseTaskInput(body, { partial }) {
  const b = body && typeof body === 'object' ? body : {};
  const value = {};
  const errors = {};

  if (b.title !== undefined || !partial) {
    const t = typeof b.title === 'string' ? b.title.trim() : '';
    if (!t) errors.title = 'Write a title for the task.';
    else if (t.length > 120) errors.title = 'Keep the title under 120 characters.';
    else value.title = t;
  }
  if (b.notes !== undefined) {
    if (typeof b.notes !== 'string' || b.notes.length > 5000) errors.notes = 'Notes must be text under 5000 characters.';
    else value.notes = b.notes;
  }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) errors.status = `Status must be one of: ${STATUSES.join(', ')}.`;
    else value.status = b.status;
  }
  if (b.priority !== undefined) {
    if (!PRIORITIES.includes(b.priority)) errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}.`;
    else value.priority = b.priority;
  }
  if (b.due_date !== undefined) {
    if (b.due_date === null || b.due_date === '') value.due_date = null;
    else if (typeof b.due_date !== 'string' || !isDate(b.due_date)) errors.due_date = 'Use a date like 2026-12-31.';
    else value.due_date = b.due_date;
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) errors.tags = 'Tags must be a list.';
    else {
      const tags = [...new Set(b.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
      if (tags.length > 8) errors.tags = 'Use at most 8 tags.';
      else if (tags.some((t) => t.length > 24)) errors.tags = 'Keep each tag under 24 characters.';
      else value.tags = tags;
    }
  }
  return { value, errors };
}

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new HttpError(404, 'Not found.');
  return id;
}

function failIfInvalid(errors) {
  if (Object.keys(errors).length) throw new HttpError(400, 'Some fields need attention.', errors);
}

module.exports = { STATUSES, PRIORITIES, HttpError, parseTaskInput, parseId, failIfInvalid };
