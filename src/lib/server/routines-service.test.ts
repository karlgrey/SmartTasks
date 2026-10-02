import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
	createRoutine,
	listRoutines,
	getRoutine,
	updateRoutine,
	deleteRoutine,
	listRuns,
	reportRun,
	attachTask,
	materializeRun,
	tickRoutines,
	getRoutinesDashboard,
	parseRoutineFilters
} from './routines-service';
import { createTask, updateTask, deleteTask, getTask } from './tasks-service';
import { testDb, seedUsers } from './test-utils';
import { createUser } from './auth';
import { createProject } from './projects-service';
import { createLocation } from './locations-service';
import { routines, routineRuns, tasks } from './db/schema';
import { todayInBerlin } from '$lib/date-utils';
import { addDays, endOfIsoWeek } from '$lib/rhythm';
import type { Rhythm } from '$lib/types';

const today = todayInBerlin();
const MONTHLY: Rhythm = { unit: 'month', interval: 1, dayOfMonth: 15 };
const DAILY: Rhythm = { unit: 'day', interval: 1 };

function setup() {
	const db = testDb();
	const { micha, claude } = seedUsers(db);
	const project = createProject(db, micha, { name: 'Betrieb' });
	return { db, micha, claude, project };
}

function mk(
	s: ReturnType<typeof setup>,
	extra: Partial<Parameters<typeof createRoutine>[2]> = {}
) {
	return createRoutine(s.db, s.micha, {
		title: 'Gehälter',
		projectId: s.project.id,
		rhythm: MONTHLY,
		...extra
	});
}

// createRoutine refuses past dates; simulate a routine that was not ticked for a while
function backdate(s: ReturnType<typeof setup>, id: number, nextDue: string) {
	s.db.update(routines).set({ nextDue }).where(eq(routines.id, id)).run();
}

describe('createRoutine', () => {
	it('applies defaults and computes nextDue', () => {
		const s = setup();
		const r = mk(s);
		expect(r).toMatchObject({
			title: 'Gehälter',
			description: '',
			projectId: s.project.id,
			locationId: null,
			assigneeId: null,
			rhythm: { unit: 'month', interval: 1, dayOfMonth: 15 },
			leadDays: 3,
			materialize: true,
			active: true,
			createdBy: s.micha.id
		});
		expect(r.nextDue >= today).toBe(true);
		expect(r.nextDue.slice(8)).toBe('15');
	});

	it('lead_days default depends on unit', () => {
		const s = setup();
		expect(mk(s, { rhythm: { unit: 'week', interval: 1, weekday: 1 } }).leadDays).toBe(1);
		expect(mk(s, { rhythm: DAILY }).leadDays).toBe(0);
		expect(mk(s, { rhythm: { unit: 'year', interval: 1 } }).leadDays).toBe(3);
		expect(mk(s, { leadDays: 7 }).leadDays).toBe(7);
	});

	it('daily routine starts today when no nextDue is given', () => {
		const s = setup();
		expect(mk(s, { rhythm: DAILY }).nextDue).toBe(today);
	});

	it('accepts an explicit nextDue >= today', () => {
		const s = setup();
		const due = addDays(today, 10);
		expect(mk(s, { nextDue: due }).nextDue).toBe(due);
		expect(mk(s, { nextDue: today }).nextDue).toBe(today);
	});

	it('validates input (400)', () => {
		const s = setup();
		const bad = (extra: Record<string, unknown>) => () => mk(s, extra as never);
		expect(bad({ rhythm: { unit: 'hour' } })).toThrowError(/unit/);
		expect(bad({ rhythm: { unit: 'day', interval: 0 } })).toThrowError(/interval/);
		expect(bad({ rhythm: { unit: 'month', weekday: 1 } })).toThrowError(/weekday/);
		expect(bad({ rhythm: { unit: 'week', dayOfMonth: 3 } })).toThrowError(/dayOfMonth/);
		expect(bad({ nextDue: addDays(today, -1) })).toThrowError(/nextDue/);
		expect(bad({ nextDue: '05.10.2026' })).toThrowError(/nextDue/);
		expect(bad({ title: '   ' })).toThrowError('title is required');
		expect(bad({ leadDays: -1 })).toThrowError(/leadDays/);
		expect(bad({ leadDays: 1.5 })).toThrowError(/leadDays/);
		expect(bad({ materialize: 'yes' })).toThrowError(/materialize/);
		expect(bad({ assigneeId: 'x' })).toThrowError(/assigneeId/);
		expect(bad({ assigneeId: 999 })).toThrowError(/assigneeId/);
		expect(bad({ locationId: 999 })).toThrowError(/locationId/);
		expect(() => createRoutine(s.db, s.micha, { title: 'x', rhythm: MONTHLY } as never)).toThrowError(
			/projectId/
		);
		expect(() =>
			createRoutine(s.db, s.micha, { title: 'x', projectId: 999, rhythm: MONTHLY })
		).toThrowError(/projectId/);
		try {
			mk(s, { rhythm: { unit: 'hour' } as never });
		} catch (e) {
			expect((e as { status: number }).status).toBe(400);
		}
	});

	it('refuses a foreign private project (400)', () => {
		const s = setup();
		const priv = createProject(s.db, s.claude, { name: 'Privat', ownerId: s.micha.id });
		const ulf = createUser(s.db, { name: 'Ulf', email: 'u@x.dev', type: 'human', password: 'pw12345' });
		expect(() =>
			createRoutine(s.db, ulf, { title: 'x', projectId: priv.id, rhythm: MONTHLY })
		).toThrowError(/projectId/);
	});

	it('stores location and assignee', () => {
		const s = setup();
		const loc = createLocation(s.db, { name: 'Prasser' });
		const r = mk(s, { locationId: loc.id, assigneeId: s.claude.id });
		expect(r.locationId).toBe(loc.id);
		expect(r.assigneeId).toBe(s.claude.id);
	});
});

describe('listRoutines / filters', () => {
	it('sorts by nextDue then id and filters', () => {
		const s = setup();
		const other = createProject(s.db, s.micha, { name: 'Andere' });
		const a = mk(s, { title: 'A', nextDue: addDays(today, 5) });
		const b = mk(s, { title: 'B', nextDue: addDays(today, 2), assigneeId: s.claude.id });
		const c = mk(s, { title: 'C', nextDue: addDays(today, 5), projectId: other.id });
		expect(listRoutines(s.db, s.micha).map((r) => r.id)).toEqual([b.id, a.id, c.id]);
		expect(listRoutines(s.db, s.micha, { project: other.id }).map((r) => r.id)).toEqual([c.id]);
		expect(listRoutines(s.db, s.micha, { assignee: String(s.claude.id) }).map((r) => r.id)).toEqual([b.id]);
		expect(listRoutines(s.db, s.micha, { assignee: 'claude' }).map((r) => r.id)).toEqual([b.id]);
		expect(listRoutines(s.db, s.micha, { assignee: 'nobody' })).toEqual([]);
		updateRoutine(s.db, s.micha, a.id, { active: false });
		expect(listRoutines(s.db, s.micha, { active: false }).map((r) => r.id)).toEqual([a.id]);
		expect(listRoutines(s.db, s.micha, { active: true }).map((r) => r.id)).toEqual([b.id, c.id]);
	});

	it('parseRoutineFilters', () => {
		const f = parseRoutineFilters(new URLSearchParams('project=3&assignee=Micha&active=false'));
		expect(f).toEqual({ project: 3, assignee: 'Micha', active: false });
		expect(parseRoutineFilters(new URLSearchParams('active=true')).active).toBe(true);
		expect(parseRoutineFilters(new URLSearchParams(''))).toEqual({});
	});

	it('hides routines of foreign private projects from humans, AI sees all', () => {
		const s = setup();
		const ulf = createUser(s.db, { name: 'Ulf', email: 'u@x.dev', type: 'human', password: 'pw12345' });
		const priv = createProject(s.db, ulf, { name: 'Ulfs', ownerId: ulf.id });
		const r = createRoutine(s.db, ulf, { title: 'Privat', projectId: priv.id, rhythm: MONTHLY });
		expect(listRoutines(s.db, s.micha)).toEqual([]);
		expect(listRoutines(s.db, s.claude).map((x) => x.id)).toEqual([r.id]);
		expect(listRoutines(s.db, ulf).map((x) => x.id)).toEqual([r.id]);
		expect(() => getRoutine(s.db, s.micha, r.id)).toThrowError('routine not found');
		expect(() => updateRoutine(s.db, s.micha, r.id, { title: 'x' })).toThrowError('routine not found');
		expect(() => listRuns(s.db, s.micha, r.id)).toThrowError('routine not found');
		expect(() => reportRun(s.db, s.micha, r.id, {})).toThrowError('routine not found');
	});
});

describe('getRoutine', () => {
	it('returns runs, project, assignee and openTask', () => {
		const s = setup();
		const r = mk(s, { assigneeId: s.claude.id, nextDue: addDays(today, 1) });
		tickRoutines(s.db, today);
		const g = getRoutine(s.db, s.micha, r.id);
		expect(g.project).toEqual({ id: s.project.id, name: 'Betrieb' });
		expect(g.assignee).toEqual({ id: s.claude.id, name: 'Claude' });
		expect(g.runs).toHaveLength(1);
		expect(g.openTask).toMatchObject({ title: expect.stringContaining('Gehälter'), status: 'To Do' });
		expect(g.openTask!.dueDate).toBe(addDays(today, 1));
		expect(() => getRoutine(s.db, s.micha, 999)).toThrowError('routine not found');
	});

	it('limits runs to the latest 12, due desc', () => {
		const s = setup();
		const r = mk(s, { rhythm: DAILY });
		for (let i = 0; i < 15; i++) reportRun(s.db, s.micha, r.id, { due: addDays(today, -i) });
		const g = getRoutine(s.db, s.micha, r.id);
		expect(g.runs).toHaveLength(12);
		expect(g.runs[0].due).toBe(today);
		expect(g.runs[11].due).toBe(addDays(today, -11));
	});
});

describe('updateRoutine', () => {
	it('patches fields; rhythm change recomputes nextDue unless given', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 20) });
		const u = updateRoutine(s.db, s.micha, r.id, { title: 'Lohn', materialize: false, leadDays: 5 });
		expect(u).toMatchObject({ title: 'Lohn', materialize: false, leadDays: 5, nextDue: r.nextDue });
		const v = updateRoutine(s.db, s.micha, r.id, { rhythm: DAILY });
		expect(v.nextDue).toBe(today);
		const w = updateRoutine(s.db, s.micha, r.id, { rhythm: MONTHLY, nextDue: addDays(today, 40) });
		expect(w.nextDue).toBe(addDays(today, 40));
	});

	it('unchanged rhythm in a patch keeps nextDue (UI sends the field on every save)', () => {
		const s = setup();
		const far = addDays(today, 40);
		const r = mk(s, { nextDue: far });
		expect(updateRoutine(s.db, s.micha, r.id, { title: 'Neu', rhythm: { ...MONTHLY } }).nextDue).toBe(far);
		expect(updateRoutine(s.db, s.micha, r.id, { rhythm: { ...MONTHLY, dayOfMonth: 20 } }).nextDue).not.toBe(far);
	});

	it('keeps existing open runs on rhythm change', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 1) });
		tickRoutines(s.db, today);
		updateRoutine(s.db, s.micha, r.id, { rhythm: DAILY });
		expect(listRuns(s.db, s.micha, r.id)).toHaveLength(1);
	});

	it('validates', () => {
		const s = setup();
		const r = mk(s);
		expect(() => updateRoutine(s.db, s.micha, r.id, { title: ' ' })).toThrowError('title is required');
		expect(() => updateRoutine(s.db, s.micha, r.id, { nextDue: addDays(today, -2) })).toThrowError(/nextDue/);
		expect(() => updateRoutine(s.db, s.micha, r.id, { projectId: 999 })).toThrowError(/projectId/);
		expect(() => updateRoutine(s.db, s.micha, r.id, { projectId: null as never })).toThrowError(/projectId/);
		expect(() => updateRoutine(s.db, s.micha, r.id, { rhythm: { unit: 'x' } as never })).toThrowError(/unit/);
		expect(() => updateRoutine(s.db, s.micha, 999, {})).toThrowError('routine not found');
		const p2 = createProject(s.db, s.micha, { name: 'P2' });
		expect(updateRoutine(s.db, s.micha, r.id, { projectId: p2.id, assigneeId: null }).projectId).toBe(p2.id);
	});
});

describe('deleteRoutine', () => {
	it('403 for AI, 409 with runs, ok otherwise', () => {
		const s = setup();
		const r = mk(s);
		expect(() => deleteRoutine(s.db, s.claude, r.id)).toThrowError(/AI users cannot delete/);
		reportRun(s.db, s.micha, r.id, {});
		expect(() => deleteRoutine(s.db, s.micha, r.id)).toThrowError('routine has runs — deactivate instead');
		const r2 = mk(s);
		deleteRoutine(s.db, s.micha, r2.id);
		expect(() => getRoutine(s.db, s.micha, r2.id)).toThrowError('routine not found');
		expect(() => deleteRoutine(s.db, s.micha, 999)).toThrowError('routine not found');
	});
});

describe('reportRun', () => {
	it('defaults to next_due/done, advances next_due, upserts', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 2) });
		const run = reportRun(s.db, s.claude, r.id, { note: 'automatisch' });
		expect(run).toMatchObject({ routineId: r.id, due: r.nextDue, status: 'done', note: 'automatisch', taskId: null });
		expect(run.doneAt).toBeTruthy();
		const after = getRoutine(s.db, s.micha, r.id);
		expect(after.nextDue > r.nextDue).toBe(true);
		// upsert same due: no second row
		const again = reportRun(s.db, s.claude, r.id, { due: r.nextDue, status: 'skipped' });
		expect(again.id).toBe(run.id);
		expect(again.status).toBe('skipped');
		expect(again.note).toBe('automatisch'); // note kept if not provided
		expect(listRuns(s.db, s.micha, r.id)).toHaveLength(1);
	});

	it('uses the oldest open run as default due', () => {
		const s = setup();
		const r = mk(s, { rhythm: DAILY });
		backdate(s, r.id, addDays(today, -2));
		tickRoutines(s.db, today);
		const runs = listRuns(s.db, s.micha, r.id);
		expect(runs.map((x) => x.due)).toEqual([today, addDays(today, -1), addDays(today, -2)]);
		const run = reportRun(s.db, s.micha, r.id, {});
		expect(run.due).toBe(addDays(today, -2));
		expect(run.status).toBe('done');
	});

	it('status open clears doneAt; invalid status 400; does not move next_due backwards', () => {
		const s = setup();
		const r = mk(s, { rhythm: DAILY });
		const old = reportRun(s.db, s.micha, r.id, { due: addDays(today, -5), status: 'open' });
		expect(old.doneAt).toBeNull();
		expect(getRoutine(s.db, s.micha, r.id).nextDue).toBe(today);
		expect(() => reportRun(s.db, s.micha, r.id, { status: 'missed' as never })).toThrowError(/status/);
		expect(() => reportRun(s.db, s.micha, r.id, { due: 'morgen' })).toThrowError(/due/);
	});

	it('leaves the task of a run unchanged', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 1) });
		tickRoutines(s.db, today);
		const taskId = listRuns(s.db, s.micha, r.id)[0].taskId!;
		const run = reportRun(s.db, s.micha, r.id, { due: r.nextDue });
		expect(run.taskId).toBe(taskId);
		expect(getTask(s.db, s.micha, taskId).status).toBe('To Do');
	});
});

describe('attachTask', () => {
	it('links an existing task, derives status, advances next_due', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 10) });
		const due = addDays(today, 10);
		const t = createTask(s.db, s.micha, { title: 'Lohn Okt', dueDate: due });
		const res = attachTask(s.db, s.micha, r.id, { taskId: t.id });
		expect(res.run).toMatchObject({ due, status: 'open', taskId: t.id });
		expect(res.task.routineRunId).toBe(res.run.id);
		expect(getRoutine(s.db, s.micha, r.id).nextDue > due).toBe(true);
	});

	it('Done task → run done with completedAt; Dropped → skipped', () => {
		const s = setup();
		const r = mk(s);
		const t1 = createTask(s.db, s.micha, { title: 'a', status: 'Done', dueDate: addDays(today, 40) });
		const res1 = attachTask(s.db, s.micha, r.id, { taskId: t1.id });
		expect(res1.run.status).toBe('done');
		expect(res1.run.doneAt).toBe(t1.completedAt);
		const t2 = createTask(s.db, s.micha, { title: 'b', status: 'Dropped' });
		const res2 = attachTask(s.db, s.micha, r.id, { taskId: t2.id, due: addDays(today, 50) });
		expect(res2.run.status).toBe('skipped');
	});

	it('errors: no due, other run, run taken, invisible task', () => {
		const s = setup();
		const r = mk(s);
		const noDue = createTask(s.db, s.micha, { title: 'x' });
		expect(() => attachTask(s.db, s.micha, r.id, { taskId: noDue.id })).toThrowError(/due/);
		const t1 = createTask(s.db, s.micha, { title: 'a' });
		const t2 = createTask(s.db, s.micha, { title: 'b' });
		attachTask(s.db, s.micha, r.id, { taskId: t1.id, due: addDays(today, 40) });
		// t1 already on a run of due X; attaching to another due → 409
		expect(() => attachTask(s.db, s.micha, r.id, { taskId: t1.id, due: addDays(today, 70) })).toThrowError(/409|already/);
		// run (r, due X) already has t1 → 409 for t2
		let status = 0;
		try {
			attachTask(s.db, s.micha, r.id, { taskId: t2.id, due: addDays(today, 40) });
		} catch (e) {
			status = (e as { status: number }).status;
		}
		expect(status).toBe(409);
		expect(() => attachTask(s.db, s.micha, r.id, { taskId: 999, due: addDays(today, 1) })).toThrowError('task not found');
		expect(() => attachTask(s.db, s.micha, r.id, { taskId: 'x' as never })).toThrowError(/taskId/);
	});

	it('re-attaching the same task to the same run is idempotent', () => {
		const s = setup();
		const r = mk(s);
		const t = createTask(s.db, s.micha, { title: 'a', dueDate: addDays(today, 40) });
		const a = attachTask(s.db, s.micha, r.id, { taskId: t.id });
		const b = attachTask(s.db, s.micha, r.id, { taskId: t.id });
		expect(b.run.id).toBe(a.run.id);
	});
});

describe('materializeRun', () => {
	it('creates run + task regardless of lead time and advances next_due', () => {
		const s = setup();
		const due = addDays(today, 30);
		const r = mk(s, { nextDue: due, assigneeId: s.claude.id, description: 'Lohn prüfen' });
		const res = materializeRun(s.db, s.micha, r.id, {});
		expect(res.run).toMatchObject({ due, status: 'open', taskId: res.task.id });
		expect(res.created).toBe(true);
		expect(res.task).toMatchObject({
			status: 'To Do',
			dueDate: due,
			projectId: s.project.id,
			assigneeId: s.claude.id,
			routineRunId: res.run.id,
			createdBy: s.claude.id
		});
		expect(res.task.title).toMatch(/^Gehälter · /);
		expect(res.task.description).toBe(`Lohn prüfen\n\nRoutine #${r.id}, Lauf fällig ${due}`);
		expect(getRoutine(s.db, s.micha, r.id).nextDue > due).toBe(true);
		// second call with same due: no second task
		const again = materializeRun(s.db, s.micha, r.id, { due });
		expect(again.created).toBe(false);
		expect(again.task.id).toBe(res.task.id);
	});

	it('409 for inactive routines', () => {
		const s = setup();
		const r = mk(s);
		updateRoutine(s.db, s.micha, r.id, { active: false });
		expect(() => materializeRun(s.db, s.micha, r.id, {})).toThrowError(/inactive|409/);
	});

	it('falls back to routine creator when no AI user exists', () => {
		const db = testDb();
		const micha = createUser(db, { name: 'Micha', email: 'm@x.dev', type: 'human', password: 'pw12345' });
		const p = createProject(db, micha, { name: 'P' });
		const r = createRoutine(db, micha, { title: 'R', projectId: p.id, rhythm: MONTHLY });
		expect(materializeRun(db, micha, r.id, {}).task.createdBy).toBe(micha.id);
	});

	it('writes a status event like createTask', () => {
		const s = setup();
		const r = mk(s);
		const { task } = materializeRun(s.db, s.micha, r.id, {});
		expect(getTask(s.db, s.micha, task.id).statusEvents).toHaveLength(1);
	});
});

describe('tickRoutines', () => {
	it('acceptance (#795): attach moves next_due, tick creates the run only inside the lead window, idempotent', () => {
		const s = setup();
		const r = createRoutine(s.db, s.micha, {
			title: 'Überweisungsblock', projectId: s.project.id,
			rhythm: { unit: 'week', interval: 1, weekday: 1 }, leadDays: 1, nextDue: addDays(today, 400)
		});
		// createRoutine refuses past dates; the scenario lives in Oct 2026
		backdate(s, r.id, '2026-10-05');
		const t738 = createTask(s.db, s.micha, { title: 'Überweisungsblock KW 41', dueDate: '2026-10-05', projectId: s.project.id });
		const att = attachTask(s.db, s.micha, r.id, { taskId: t738.id });
		expect(att.run).toMatchObject({ due: '2026-10-05', status: 'open', taskId: t738.id });
		expect(getRoutine(s.db, s.micha, r.id).nextDue).toBe('2026-10-12');

		expect(tickRoutines(s.db, '2026-10-10')).toMatchObject({ runsCreated: 0, tasksCreated: 0 });
		const t11 = tickRoutines(s.db, '2026-10-11');
		expect(t11).toMatchObject({ runsCreated: 1, tasksCreated: 1 });
		expect(t11.tasks[0]).toMatchObject({ title: 'Überweisungsblock · KW 42', dueDate: '2026-10-12', status: 'To Do', createdBy: s.claude.id });
		expect(getRoutine(s.db, s.micha, r.id).nextDue).toBe('2026-10-19');
		expect(tickRoutines(s.db, '2026-10-11')).toMatchObject({ runsCreated: 0, tasksCreated: 0 });
		expect(s.db.select().from(routineRuns).all()).toHaveLength(2);
		expect(s.db.select().from(tasks).all()).toHaveLength(2);
	});

	it('is idempotent: two ticks same day = one run, one task', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 1) });
		const t1 = tickRoutines(s.db, today);
		expect(t1).toMatchObject({ today, runsCreated: 1, tasksCreated: 1, missed: 0 });
		expect(t1.tasks).toHaveLength(1);
		const t2 = tickRoutines(s.db, today);
		expect(t2).toMatchObject({ runsCreated: 0, tasksCreated: 0, missed: 0 });
		expect(s.db.select().from(routineRuns).all()).toHaveLength(1);
		expect(s.db.select().from(tasks).all()).toHaveLength(1);
		expect(getRoutine(s.db, s.micha, r.id).nextDue > addDays(today, 1)).toBe(true);
	});

	it('respects lead_days: due today+3 with lead 1 → nothing; due today+1 → task', () => {
		const s = setup();
		mk(s, { leadDays: 1, nextDue: addDays(today, 3) });
		expect(tickRoutines(s.db, today)).toMatchObject({ runsCreated: 0, tasksCreated: 0 });
		const s2 = setup();
		mk(s2, { leadDays: 1, nextDue: addDays(today, 1) });
		expect(tickRoutines(s2.db, today)).toMatchObject({ runsCreated: 1, tasksCreated: 1 });
		// edge: exactly lead_days ahead → created
		const s3 = setup();
		mk(s3, { leadDays: 2, nextDue: addDays(today, 2) });
		expect(tickRoutines(s3.db, today).tasksCreated).toBe(1);
	});

	it('catches up several periods in one tick', () => {
		const s = setup();
		const r = mk(s, { rhythm: DAILY });
		backdate(s, r.id, addDays(today, -2));
		const res = tickRoutines(s.db, today);
		expect(res.runsCreated).toBe(3);
		expect(res.tasksCreated).toBe(3);
		expect(getRoutine(s.db, s.micha, r.id).nextDue).toBe(addDays(today, 1));
	});

	it('materialize=false: run without task, next_due advances', () => {
		const s = setup();
		const r = mk(s, { materialize: false, nextDue: addDays(today, 1) });
		const res = tickRoutines(s.db, today);
		expect(res).toMatchObject({ runsCreated: 1, tasksCreated: 0 });
		expect(listRuns(s.db, s.micha, r.id)[0]).toMatchObject({ status: 'open', taskId: null });
		expect(getRoutine(s.db, s.micha, r.id).nextDue > addDays(today, 1)).toBe(true);
		expect(s.db.select().from(tasks).all()).toHaveLength(0);
	});

	it('does not create a task for a run already reported done', () => {
		const s = setup();
		const due = addDays(today, 1);
		const r = mk(s, { nextDue: due });
		s.db.insert(routineRuns).values({ routineId: r.id, due, status: 'done', createdAt: 'x' }).run();
		expect(tickRoutines(s.db, today)).toMatchObject({ runsCreated: 0, tasksCreated: 0 });
	});

	it('inactive routines create nothing', () => {
		const s = setup();
		const r = mk(s, { nextDue: today });
		updateRoutine(s.db, s.micha, r.id, { active: false });
		expect(tickRoutines(s.db, today)).toMatchObject({ runsCreated: 0, tasksCreated: 0 });
	});

	it('marks open runs older than 7 days as missed, leaves the task alone', () => {
		const s = setup();
		const r = mk(s, { rhythm: DAILY, materialize: true });
		tickRoutines(s.db, today); // run for today + task
		// rewind: run for 8 days ago, one for exactly 7 days ago
		const base = listRuns(s.db, s.micha, r.id)[0];
		s.db.update(routineRuns).set({ due: addDays(today, -8) }).where(eq(routineRuns.id, base.id)).run();
		const run7 = s.db
			.insert(routineRuns)
			.values({ routineId: r.id, due: addDays(today, -7), status: 'open', createdAt: 'x' })
			.returning()
			.get();
		const res = tickRoutines(s.db, today);
		expect(res.missed).toBe(1);
		const runs = listRuns(s.db, s.micha, r.id);
		expect(runs.find((x) => x.id === base.id)!.status).toBe('missed');
		expect(runs.find((x) => x.id === run7.id)!.status).toBe('open');
		expect(getTask(s.db, s.micha, base.taskId!).status).toBe('To Do');
	});
});

describe('task ↔ run sync', () => {
	function withTask() {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 1) });
		tickRoutines(s.db, today);
		const run = listRuns(s.db, s.micha, r.id)[0];
		return { ...s, r, run, taskId: run.taskId! };
	}
	const runOf = (s: ReturnType<typeof withTask>) => listRuns(s.db, s.micha, s.r.id)[0];

	it('Done → done, Dropped → skipped, reopen → open', () => {
		const s = withTask();
		updateTask(s.db, s.micha, s.taskId, { status: 'Done' });
		expect(runOf(s).status).toBe('done');
		expect(runOf(s).doneAt).toBeTruthy();
		updateTask(s.db, s.micha, s.taskId, { status: 'In Progress' });
		expect(runOf(s)).toMatchObject({ status: 'open', doneAt: null });
		updateTask(s.db, s.micha, s.taskId, { status: 'Dropped' });
		expect(runOf(s).status).toBe('skipped');
		expect(runOf(s).doneAt).toBeTruthy();
		updateTask(s.db, s.micha, s.taskId, { status: 'To Do' });
		expect(runOf(s).status).toBe('open');
	});

	it('a status-less patch leaves the run alone; routine keeps running after Dropped', () => {
		const s = withTask();
		updateTask(s.db, s.micha, s.taskId, { title: 'neu' });
		expect(runOf(s).status).toBe('open');
		updateTask(s.db, s.micha, s.taskId, { status: 'Dropped' });
		expect(getRoutine(s.db, s.micha, s.r.id).active).toBe(true);
	});

	it('deleteTask keeps the run but clears task_id', () => {
		const s = withTask();
		deleteTask(s.db, s.micha, s.taskId);
		expect(runOf(s)).toMatchObject({ taskId: null, status: 'open' });
	});

	it('getTask exposes routine and routineRun', () => {
		const s = withTask();
		const t = getTask(s.db, s.micha, s.taskId);
		expect(t.routineRunId).toBe(s.run.id);
		expect(t.routine).toEqual({ id: s.r.id, title: 'Gehälter' });
		expect(t.routineRun).toEqual({ id: s.run.id, due: s.run.due, status: 'open' });
		const plain = createTask(s.db, s.micha, { title: 'x' });
		expect(getTask(s.db, s.micha, plain.id)).toMatchObject({ routine: null, routineRun: null });
	});

	it('PATCH routineRunId links and unlinks', () => {
		const s = setup();
		const r = mk(s, { materialize: false, nextDue: addDays(today, 1) });
		tickRoutines(s.db, today);
		const run = listRuns(s.db, s.micha, r.id)[0];
		const t = createTask(s.db, s.micha, { title: 'manuell', status: 'Done' });
		const linked = updateTask(s.db, s.micha, t.id, { routineRunId: run.id });
		expect(linked.routineRunId).toBe(run.id);
		expect(listRuns(s.db, s.micha, r.id)[0]).toMatchObject({ taskId: t.id, status: 'done' });
		// another task cannot take the same run
		const t2 = createTask(s.db, s.micha, { title: 'zweiter' });
		let status = 0;
		try {
			updateTask(s.db, s.micha, t2.id, { routineRunId: run.id });
		} catch (e) {
			status = (e as { status: number }).status;
		}
		expect(status).toBe(409);
		expect(() => updateTask(s.db, s.micha, t2.id, { routineRunId: 999 })).toThrowError(/routineRunId/);
		expect(() => updateTask(s.db, s.micha, t2.id, { routineRunId: 'x' as never })).toThrowError(/routineRunId/);
		const unlinked = updateTask(s.db, s.micha, t.id, { routineRunId: null });
		expect(unlinked.routineRunId).toBeNull();
		expect(listRuns(s.db, s.micha, r.id)[0].taskId).toBeNull();
	});

	it('createTask rejects routineRunId', () => {
		const s = setup();
		expect(() => createTask(s.db, s.micha, { title: 'x', routineRunId: 1 })).toThrowError(/routineRunId/);
	});
});

describe('getRoutinesDashboard', () => {
	it('computes counts, states and ordering', () => {
		const s = setup();
		const week = endOfIsoWeek(today);
		const mkOpen = (title: string, due: string, extra: Record<string, unknown> = {}) => {
			const r = mk(s, { title, nextDue: addDays(today, 100), materialize: false, ...extra } as never);
			s.db.insert(routineRuns).values({ routineId: r.id, due, status: 'open', createdAt: 'x' }).run();
			return r;
		};
		const overdue = mkOpen('Überfällig', addDays(today, -2));
		const dueToday = mkOpen('Heute', today);
		const soon = mkOpen('Bald', addDays(today, 2), { leadDays: 5 });
		const far = mkOpen('Fern', addDays(today, 30), { leadDays: 3 });
		const paused = mkOpen('Pausiert', addDays(today, 1));
		updateRoutine(s.db, s.micha, paused.id, { active: false });
		const broken = mk(s, { title: 'Kaputt', nextDue: addDays(today, 100) });
		s.db.insert(routineRuns).values({ routineId: broken.id, due: addDays(today, -20), status: 'missed', createdAt: 'x' }).run();
		const fresh = mk(s, { title: 'Ohne Lauf', nextDue: addDays(today, 100) });

		const d = getRoutinesDashboard(s.db, s.micha);
		expect(d.today).toBe(today);
		const by = (id: number) => d.routines.find((x) => x.id === id)!;
		expect(by(overdue.id).state).toBe('overdue');
		expect(by(dueToday.id).state).toBe('due');
		expect(by(soon.id).state).toBe('due');
		expect(by(far.id).state).toBe('ok');
		expect(by(paused.id).state).toBe('paused');
		expect(by(broken.id).state).toBe('broken');
		expect(by(fresh.id).state).toBe('ok');
		expect(by(fresh.id).nextDue).toBe(addDays(today, 100));
		expect(by(overdue.id).openRun).toMatchObject({ due: addDays(today, -2), status: 'open', taskId: null });
		expect(by(overdue.id).rhythmText).toBe('monatlich am 15.');
		expect(by(overdue.id).project).toEqual({ id: s.project.id, name: 'Betrieb', color: expect.any(String) });
		// counts: paused routine excluded; missed run not counted
		expect(d.counts.overdue).toBe(1);
		expect(d.counts.today).toBe(1);
		const soonInWeek = addDays(today, 2) <= week ? 1 : 0;
		expect(d.counts.thisWeek).toBe(soonInWeek);
		// sorted by nextDue asc then title
		const dues = d.routines.map((x) => x.nextDue);
		expect(dues).toEqual([...dues].sort());
	});

	it('lastRun = latest non-open run; task of the open run', () => {
		const s = setup();
		const r = mk(s, { nextDue: addDays(today, 1) });
		reportRun(s.db, s.micha, r.id, { due: addDays(today, -30), status: 'done' });
		reportRun(s.db, s.micha, r.id, { due: addDays(today, -60), status: 'skipped' });
		tickRoutines(s.db, today);
		const entry = getRoutinesDashboard(s.db, s.micha).routines[0];
		expect(entry.lastRun).toMatchObject({ due: addDays(today, -30), status: 'done' });
		expect(entry.openRun!.taskId).toBeTruthy();
		expect(entry.task).toMatchObject({ id: entry.openRun!.taskId, status: 'To Do' });
		expect(entry.state).toBe('due');
	});

	it('filters and visibility', () => {
		const s = setup();
		const ulf = createUser(s.db, { name: 'Ulf', email: 'u@x.dev', type: 'human', password: 'pw12345' });
		const priv = createProject(s.db, ulf, { name: 'Ulfs', ownerId: ulf.id });
		createRoutine(s.db, ulf, { title: 'Privat', projectId: priv.id, rhythm: MONTHLY, nextDue: today });
		mk(s, { title: 'Öffentlich', assigneeId: s.claude.id });
		tickRoutines(s.db, today);
		expect(getRoutinesDashboard(s.db, s.micha).routines.map((x) => x.title)).toEqual(['Öffentlich']);
		expect(getRoutinesDashboard(s.db, s.claude).routines).toHaveLength(2);
		expect(getRoutinesDashboard(s.db, s.claude, { project: priv.id }).routines).toHaveLength(1);
		expect(getRoutinesDashboard(s.db, s.claude, { assignee: 'claude' }).routines.map((x) => x.title)).toEqual(['Öffentlich']);
		// Ulf's private routine's counts are not visible to Micha
		const m = getRoutinesDashboard(s.db, s.micha);
		expect(m.counts.today + m.counts.overdue + m.counts.thisWeek).toBeLessThanOrEqual(1);
	});
});
