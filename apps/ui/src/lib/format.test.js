import { describe, expect, it } from 'vitest';
import { applyFilters, bytes, daysUntil, dueInfo, hours, nextStatus, plural, relTime, uptime } from './format';

const NOW = new Date(2026, 9, 6, 15, 30); // 6 Oct 2026, local time

describe('dates', () => {
  it('counts calendar days in local time, whatever the hour', () => {
    expect(daysUntil('2026-10-06', NOW)).toBe(0);
    expect(daysUntil('2026-10-07', NOW)).toBe(1);
    expect(daysUntil('2026-10-04', NOW)).toBe(-2);
    expect(daysUntil('2026-10-06', new Date(2026, 9, 6, 0, 1))).toBe(0);
    expect(daysUntil('2026-10-06', new Date(2026, 9, 6, 23, 59))).toBe(0);
  });

  it('words due dates by urgency', () => {
    expect(dueInfo(null, 'todo', NOW)).toBeNull();
    expect(dueInfo('2026-10-04', 'todo', NOW)).toEqual({ text: '2 days overdue', tone: 'overdue' });
    expect(dueInfo('2026-10-05', 'todo', NOW)).toEqual({ text: '1 day overdue', tone: 'overdue' });
    expect(dueInfo('2026-10-06', 'doing', NOW)).toEqual({ text: 'Due today', tone: 'soon' });
    expect(dueInfo('2026-10-07', 'todo', NOW)).toEqual({ text: 'Due tomorrow', tone: 'soon' });
    expect(dueInfo('2026-10-09', 'todo', NOW).tone).toBe('soon');
    expect(dueInfo('2026-10-20', 'todo', NOW).tone).toBe('later');
    expect(dueInfo('2026-10-01', 'done', NOW).tone).toBe('done'); // finished tasks are never "overdue"
  });

  it('says how long ago something happened', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    expect(relTime('2026-10-06T11:59:40Z', now)).toBe('just now');
    expect(relTime('2026-10-06T11:30:00Z', now)).toBe('30 min ago');
    expect(relTime('2026-10-06T07:00:00Z', now)).toBe('5 h ago');
    expect(relTime('2026-10-03T12:00:00Z', now)).toBe('3 d ago');
  });
});

describe('numbers and words', () => {
  it('formats sizes, durations and counts', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(900)).toBe('900 B');
    expect(bytes(141711)).toBe('138 KB');
    expect(bytes(1572864)).toBe('1.5 MB');
    expect(hours(null)).toBe('No data yet');
    expect(hours(0.2)).toBe('12 min');
    expect(hours(30)).toBe('30.0 h');
    expect(hours(96)).toBe('4.0 days');
    expect(uptime(45)).toBe('45 s');
    expect(uptime(3600)).toBe('60 min');
    expect(plural(1, 'task')).toBe('1 task');
    expect(plural(3, 'task')).toBe('3 tasks');
  });

  it('moves a task around the board in order', () => {
    expect(nextStatus('todo')).toBe('doing');
    expect(nextStatus('doing')).toBe('done');
    expect(nextStatus('done')).toBe('todo'); // "reopen"
  });
});

describe('filters', () => {
  const tasks = [
    { id: 1, title: 'Fix the ALB', notes: '', tags: ['aws'], priority: 'high', status: 'todo', due_date: '2026-10-01' },
    { id: 2, title: 'Write docs', notes: 'about the alb', tags: ['docs'], priority: 'low', status: 'doing', due_date: null },
    { id: 3, title: 'Old chore', notes: '', tags: ['aws', 'ops'], priority: 'high', status: 'done', due_date: '2026-09-01' },
  ];
  const ids = (f) => applyFilters(tasks, f, NOW).map((t) => t.id);

  it('searches title, notes and tags, ignoring case', () => {
    expect(ids({ q: 'ALB' })).toEqual([1, 2]);
    expect(ids({ q: 'ops' })).toEqual([3]);
  });
  it('combines filters', () => {
    expect(ids({ priority: 'high' })).toEqual([1, 3]);
    expect(ids({ priority: 'high', tag: 'ops' })).toEqual([3]);
  });
  it('overdue ignores finished tasks', () => {
    expect(ids({ overdue: true })).toEqual([1]);
  });
  it('no filters returns everything', () => {
    expect(ids({})).toEqual([1, 2, 3]);
  });
});
