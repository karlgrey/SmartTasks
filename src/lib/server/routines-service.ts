import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { routines, routineRuns, tasks, users, projects, locations, statusEvents } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';
import {
	isClosed,
	type Rhythm,
	type RoutineDTO,
	type RoutineRunDTO,
	type RunStatus,
	type Status,
	type TaskDTO
} from '$lib/types';
import { todayInBerlin } from '$lib/date-utils';
import {
	RhythmError,
	validateRhythm,
	nextDue as rhythmNextDue,
	firstDueOnOrAfter,
	periodLabel,
	rhythmText,
	addDays,
	endOfIsoWeek
} from '$lib/rhythm';
import {
	assertProjectUsable,
	assertTaskVisible,
	assertVisibleByProject,
	routineVisibilityCond,
	taskVisibilityCond
} from './visibility';
import { assertAssigneeAllowed } from './tasks-service';

// Transaction handle or the Db itself — both expose the same query API.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

type RoutineRow = typeof routines.$inferSelect;
type RunRow = typeof routineRuns.$inferSelect;

export type RoutineFilters = { project?: number; assignee?: string; active?: boolean };

export type RoutineInput = {
	title: string;
	description?: string;
	projectId: number;
	locationId?: number | null;
	assigneeId?: number | null;
	rhythm: Rhythm;
	leadDays?: number;
	materialize?: boolean;
	active?: boolean;
	nextDue?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s: string): boolean {
	return DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

function assertDate(field: string, value: unknown): asserts value is string {
	if (typeof value !== 'string' || !isValidDate(value))
		throw new ServiceError(400, `invalid ${field}: must be a date (YYYY-MM-DD)`);
}

function assertFutureDate(field: string, value: unknown, today: string): asserts value is string {
	assertDate(field, value);
	if (value < today) throw new ServiceError(400, `invalid ${field}: must not be in the past`);
}

function checkRhythm(x: unknown): Rhythm {
	try {
		return validateRhythm(x);
	} catch (e) {
		if (e instanceof RhythmError) throw new ServiceError(400, e.message);
		throw e;
	}
}

function assertBool(field: string, value: unknown): void {
	if (value !== undefined && typeof value !== 'boolean')
		throw new ServiceError(400, `invalid ${field}: must be a boolean`);
}

function assertLeadDays(value: unknown): void {
	if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0))
		throw new ServiceError(400, 'invalid leadDays: must be an integer >= 0');
}

function assertAssignee(db: Db, assigneeId: unknown): void {
	if (assigneeId === null || assigneeId === undefined) return;
	if (typeof assigneeId !== 'number') throw new ServiceError(400, 'invalid assigneeId: must be a number');
	if (!db.select().from(users).where(eq(users.id, assigneeId)).get())
		throw new ServiceError(400, 'invalid assigneeId: user not found');
}

function assertLocation(db: Db, locationId: unknown): void {
	if (locationId === null || locationId === undefined) return;
	if (typeof locationId !== 'number') throw new ServiceError(400, 'invalid locationId: must be a number');
	if (!db.select().from(locations).where(eq(locations.id, locationId)).get())
		throw new ServiceError(400, 'invalid locationId: location not found');
}

function defaultLeadDays(rhythm: Rhythm): number {
	return rhythm.unit === 'week' ? 1 : rhythm.unit === 'day' ? 0 : 3;
}

export function parseRoutineFilters(params: URLSearchParams): RoutineFilters {
	const f: RoutineFilters = {};
	const project = params.get('project');
	if (project) f.project = Number(project);
	const assignee = params.get('assignee');
	if (assignee) f.assignee = assignee;
	const active = params.get('active');
	if (active === 'true') f.active = true;
	else if (active === 'false') f.active = false;
	return f;
}

// null = filter matches nobody (unknown user name)
function resolveAssignee(db: Db, assignee: string): number | null {
	if (/^\d+$/.test(assignee)) return Number(assignee);
	const u = db
		.select()
		.from(users)
		.where(sql`lower(${users.name}) = lower(${assignee})`)
		.get();
	return u ? u.id : null;
}

function buildConds(db: Db, user: SafeUser, filters: RoutineFilters): SQL[] | null {
	const conds: SQL[] = [];
	if (filters.project !== undefined) conds.push(eq(routines.projectId, filters.project));
	if (filters.assignee !== undefined) {
		const id = resolveAssignee(db, filters.assignee);
		if (id === null) return null;
		conds.push(eq(routines.assigneeId, id));
	}
	if (filters.active !== undefined) conds.push(eq(routines.active, filters.active));
	const vis = routineVisibilityCond(user);
	if (vis) conds.push(vis);
	return conds;
}

export function listRoutines(db: Db, user: SafeUser, filters: RoutineFilters = {}): RoutineDTO[] {
	const conds = buildConds(db, user, filters);
	if (!conds) return [];
	return db
		.select()
		.from(routines)
		.where(conds.length ? and(...conds) : undefined)
		.orderBy(asc(routines.nextDue), asc(routines.id))
		.all();
}

function loadRoutine(db: Q, user: SafeUser, id: number): RoutineRow {
	const routine = db.select().from(routines).where(eq(routines.id, id)).get();
	if (!routine) throw new ServiceError(404, 'routine not found');
	assertVisibleByProject(db as Db, user, routine.projectId, 'routine not found');
	return routine;
}

export function createRoutine(db: Db, user: SafeUser, input: RoutineInput): RoutineDTO {
	if (typeof input.title !== 'string' || !input.title.trim())
		throw new ServiceError(400, 'title is required');
	if (input.description !== undefined && typeof input.description !== 'string')
		throw new ServiceError(400, 'invalid description: must be a string');
	if (input.projectId === undefined || input.projectId === null)
		throw new ServiceError(400, 'projectId is required');
	const project = assertProjectUsable(db, user, input.projectId);
	const rhythm = checkRhythm(input.rhythm);
	assertLeadDays(input.leadDays);
	assertBool('materialize', input.materialize);
	assertBool('active', input.active);
	assertAssignee(db, input.assigneeId);
	assertAssigneeAllowed(db, project, input.assigneeId);
	assertLocation(db, input.locationId);
	const today = todayInBerlin();
	if (input.nextDue !== undefined) assertFutureDate('nextDue', input.nextDue, today);
	const now = new Date().toISOString();
	return db
		.insert(routines)
		.values({
			title: input.title.trim(),
			description: input.description ?? '',
			projectId: input.projectId,
			locationId: input.locationId ?? null,
			assigneeId: input.assigneeId ?? null,
			rhythm,
			leadDays: input.leadDays ?? defaultLeadDays(rhythm),
			materialize: input.materialize ?? true,
			active: input.active ?? true,
			nextDue: input.nextDue ?? firstDueOnOrAfter(rhythm, today),
			createdBy: user.id,
			createdAt: now,
			updatedAt: now
		})
		.returning()
		.get();
}

export function getRoutine(db: Db, user: SafeUser, id: number) {
	const routine = loadRoutine(db, user, id);
	const runs = db
		.select()
		.from(routineRuns)
		.where(eq(routineRuns.routineId, id))
		.orderBy(desc(routineRuns.due))
		.limit(12)
		.all();
	const openRun = db
		.select()
		.from(routineRuns)
		.where(and(eq(routineRuns.routineId, id), eq(routineRuns.status, 'open'), sql`${routineRuns.taskId} IS NOT NULL`))
		.orderBy(desc(routineRuns.due))
		.get();
	const openTask = openRun?.taskId
		? (db
				.select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
				.from(tasks)
				.where(eq(tasks.id, openRun.taskId))
				.get() ?? null)
		: null;
	const project = db
		.select({ id: projects.id, name: projects.name })
		.from(projects)
		.where(eq(projects.id, routine.projectId))
		.get();
	const assignee = routine.assigneeId
		? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, routine.assigneeId)).get()
		: undefined;
	return { ...routine, runs, openTask, project: project ?? null, assignee: assignee ?? null };
}

const UPDATABLE = [
	'title', 'description', 'projectId', 'locationId', 'assigneeId', 'rhythm', 'leadDays', 'materialize', 'active', 'nextDue'
] as const;

export function updateRoutine(db: Db, user: SafeUser, id: number, patch: Partial<RoutineInput>): RoutineDTO {
	const existing = loadRoutine(db, user, id);
	if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim()))
		throw new ServiceError(400, 'title is required');
	if (patch.description !== undefined && typeof patch.description !== 'string')
		throw new ServiceError(400, 'invalid description: must be a string');
	let project = null;
	if ('projectId' in patch) {
		if (patch.projectId === null || patch.projectId === undefined)
			throw new ServiceError(400, 'invalid projectId: must not be null');
		project = assertProjectUsable(db, user, patch.projectId);
	}
	assertLeadDays(patch.leadDays);
	assertBool('materialize', patch.materialize);
	assertBool('active', patch.active);
	if ('assigneeId' in patch) assertAssignee(db, patch.assigneeId);
	if ('locationId' in patch) assertLocation(db, patch.locationId);
	const today = todayInBerlin();
	if (patch.nextDue !== undefined) assertFutureDate('nextDue', patch.nextDue, today);

	if (project || 'assigneeId' in patch) {
		const proj =
			project ?? db.select().from(projects).where(eq(projects.id, existing.projectId)).get() ?? null;
		assertAssigneeAllowed(db, proj, 'assigneeId' in patch ? patch.assigneeId : existing.assigneeId);
	}

	const next: Record<string, unknown> = { updatedAt: new Date().toISOString() };
	for (const key of UPDATABLE) {
		if (key in patch) next[key] = patch[key];
	}
	if (patch.title !== undefined) next.title = patch.title.trim();
	if ('description' in patch && patch.description === undefined) delete next.description;
	if (patch.rhythm !== undefined) {
		const rhythm = checkRhythm(patch.rhythm);
		next.rhythm = rhythm;
		// existing open runs stay; only the next occurrence is recomputed
		if (patch.nextDue === undefined) next.nextDue = firstDueOnOrAfter(rhythm, today);
	}
	return db.update(routines).set(next).where(eq(routines.id, id)).returning().get();
}

export function deleteRoutine(db: Db, user: SafeUser, id: number): RoutineDTO {
	if (user.type === 'ai') throw new ServiceError(403, 'AI users cannot delete routines');
	const existing = loadRoutine(db, user, id);
	const hasRuns = db.select({ id: routineRuns.id }).from(routineRuns).where(eq(routineRuns.routineId, id)).get();
	if (hasRuns) throw new ServiceError(409, 'routine has runs — deactivate instead');
	db.delete(routines).where(eq(routines.id, id)).run();
	return existing;
}

export function listRuns(
	db: Db,
	user: SafeUser,
	routineId: number,
	opts: { limit?: number } = {}
): RoutineRunDTO[] {
	loadRoutine(db, user, routineId);
	return db
		.select()
		.from(routineRuns)
		.where(eq(routineRuns.routineId, routineId))
		.orderBy(desc(routineRuns.due), desc(routineRuns.id))
		.limit(opts.limit ?? -1)
		.all();
}

// ---------------------------------------------------------------- runs

// Move next_due behind a run that was just handled (never backwards).
function advanceNextDue(q: Q, routine: RoutineRow, due: string): void {
	if (due >= routine.nextDue)
		q.update(routines)
			.set({ nextDue: rhythmNextDue(routine.rhythm, due), updatedAt: new Date().toISOString() })
			.where(eq(routines.id, routine.id))
			.run();
}

function findRun(q: Q, routineId: number, due: string): RunRow | undefined {
	return q
		.select()
		.from(routineRuns)
		.where(and(eq(routineRuns.routineId, routineId), eq(routineRuns.due, due)))
		.get();
}

function oldestUnresolvedRun(q: Q, routineId: number): RunRow | undefined {
	return q
		.select()
		.from(routineRuns)
		.where(and(eq(routineRuns.routineId, routineId), inArray(routineRuns.status, ['open', 'missed'])))
		.orderBy(asc(routineRuns.due))
		.get();
}

function insertRun(q: Q, routineId: number, due: string, status: RunStatus, extra: Partial<RunRow> = {}): RunRow {
	return q
		.insert(routineRuns)
		.values({ routineId, due, status, createdAt: new Date().toISOString(), ...extra })
		.returning()
		.get();
}

export function reportRun(
	db: Db,
	user: SafeUser,
	routineId: number,
	input: { due?: string; status?: RunStatus; note?: string | null }
): RoutineRunDTO {
	const routine = loadRoutine(db, user, routineId);
	const status = input.status ?? 'done';
	if (!['done', 'skipped', 'open'].includes(status))
		throw new ServiceError(400, 'invalid status: must be one of done, skipped, open');
	if (input.due !== undefined) assertDate('due', input.due);
	if (input.note !== undefined && input.note !== null && typeof input.note !== 'string')
		throw new ServiceError(400, 'invalid note: must be a string');
	return db.transaction((tx) => {
		const due = input.due ?? oldestUnresolvedRun(tx, routineId)?.due ?? routine.nextDue;
		const doneAt = status === 'open' ? null : new Date().toISOString();
		const existing = findRun(tx, routineId, due);
		let run: RunRow;
		if (existing) {
			const set: Partial<RunRow> = { status, doneAt };
			if (input.note !== undefined) set.note = input.note;
			run = tx.update(routineRuns).set(set).where(eq(routineRuns.id, existing.id)).returning().get();
		} else {
			run = insertRun(tx, routineId, due, status, { doneAt, note: input.note ?? null });
		}
		advanceNextDue(tx, routine, due);
		return run;
	});
}

function runStatusFromTask(task: { status: Status; completedAt: string | null }): {
	status: RunStatus;
	doneAt: string | null;
} {
	if (task.status === 'Done') return { status: 'done', doneAt: task.completedAt };
	if (task.status === 'Dropped') return { status: 'skipped', doneAt: task.completedAt };
	return { status: 'open', doneAt: null };
}

export function attachTask(
	db: Db,
	user: SafeUser,
	routineId: number,
	input: { taskId: number; due?: string }
): { run: RoutineRunDTO; task: TaskDTO } {
	const routine = loadRoutine(db, user, routineId);
	if (typeof input.taskId !== 'number') throw new ServiceError(400, 'invalid taskId: must be a number');
	if (input.due !== undefined) assertDate('due', input.due);
	const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
	if (!task) throw new ServiceError(404, 'task not found');
	assertTaskVisible(db, user, task);
	const due = input.due ?? task.dueDate;
	if (!due) throw new ServiceError(400, 'due is required (task has no dueDate)');
	assertDate('due', due);
	return db.transaction((tx) => {
		const existing = findRun(tx, routineId, due);
		if (task.routineRunId !== null && task.routineRunId !== existing?.id)
			throw new ServiceError(409, 'task already belongs to another routine run');
		if (existing?.taskId && existing.taskId !== task.id)
			throw new ServiceError(409, 'this routine run already has another task');
		const derived = runStatusFromTask(task);
		const run = existing
			? tx.update(routineRuns).set({ taskId: task.id, ...derived }).where(eq(routineRuns.id, existing.id)).returning().get()
			: insertRun(tx, routineId, due, derived.status, { taskId: task.id, doneAt: derived.doneAt });
		const linked = tx.update(tasks).set({ routineRunId: run.id }).where(eq(tasks.id, task.id)).returning().get();
		advanceNextDue(tx, routine, due);
		return { run, task: linked };
	});
}

// Called from updateTask when a task of a run is linked/unlinked via PATCH.
export function bindTaskToRun(
	tx: Tx,
	taskId: number,
	runId: number | null,
	task: { status: Status; completedAt: string | null }
): void {
	// release a previously bound run
	tx.update(routineRuns).set({ taskId: null }).where(eq(routineRuns.taskId, taskId)).run();
	if (runId !== null)
		tx.update(routineRuns).set({ taskId, ...runStatusFromTask(task) }).where(eq(routineRuns.id, runId)).run();
}

// Validation for PATCH /api/tasks/:id { routineRunId }
export function assertRunLinkable(db: Db, user: SafeUser, taskId: number, runId: unknown): void {
	if (runId === null) return;
	if (typeof runId !== 'number') throw new ServiceError(400, 'invalid routineRunId: must be a number');
	const run = db.select().from(routineRuns).where(eq(routineRuns.id, runId)).get();
	const routine = run ? db.select().from(routines).where(eq(routines.id, run.routineId)).get() : undefined;
	let visible = !!routine;
	if (routine) {
		try {
			assertVisibleByProject(db, user, routine.projectId, 'routine not found');
		} catch {
			visible = false;
		}
	}
	if (!run || !visible) throw new ServiceError(400, 'invalid routineRunId: run not found');
	if (run.taskId !== null && run.taskId !== taskId)
		throw new ServiceError(409, 'this routine run already has another task');
}

// Task status change → run status (called from updateTask in its transaction).
export function syncRunFromTask(tx: Tx, taskId: number, newStatus: Status, now: string): void {
	const task = tx.select({ runId: tasks.routineRunId }).from(tasks).where(eq(tasks.id, taskId)).get();
	if (!task?.runId) return;
	const closed = isClosed(newStatus);
	const status: RunStatus = newStatus === 'Done' ? 'done' : newStatus === 'Dropped' ? 'skipped' : 'open';
	tx.update(routineRuns)
		.set({ status, doneAt: closed ? now : null })
		.where(eq(routineRuns.id, task.runId))
		.run();
}

// Called from deleteTask: the run stays, it just loses its task.
export function releaseRunsOfTask(tx: Tx, taskId: number): void {
	tx.update(routineRuns).set({ taskId: null }).where(eq(routineRuns.taskId, taskId)).run();
}

function systemCreatorId(q: Q, routine: RoutineRow): number {
	const ai = q.select({ id: users.id }).from(users).where(eq(users.type, 'ai')).orderBy(asc(users.id)).get();
	return ai?.id ?? routine.createdBy;
}

function createRunTask(q: Q, routine: RoutineRow, run: RunRow): TaskDTO {
	const now = new Date().toISOString();
	const marker = `Routine #${routine.id}, Lauf fällig ${run.due}`;
	const task = q
		.insert(tasks)
		.values({
			title: `${routine.title} · ${periodLabel(routine.rhythm, run.due)}`,
			description: routine.description ? `${routine.description}\n\n${marker}` : marker,
			status: 'To Do',
			dueDate: run.due,
			assigneeId: routine.assigneeId,
			projectId: routine.projectId,
			createdBy: systemCreatorId(q, routine),
			createdAt: now,
			updatedAt: now,
			routineRunId: run.id
		})
		.returning()
		.get();
	q.insert(statusEvents)
		.values({ taskId: task.id, userId: task.createdBy, fromStatus: null, toStatus: 'To Do', createdAt: now })
		.run();
	q.update(routineRuns).set({ taskId: task.id }).where(eq(routineRuns.id, run.id)).run();
	return task;
}

export function materializeRun(
	db: Db,
	user: SafeUser,
	routineId: number,
	input: { due?: string }
): { run: RoutineRunDTO; task: TaskDTO; created: boolean } {
	const routine = loadRoutine(db, user, routineId);
	if (!routine.active) throw new ServiceError(409, 'routine is inactive');
	if (input.due !== undefined) assertDate('due', input.due);
	return db.transaction((tx) => {
		const due = input.due ?? routine.nextDue;
		let run = findRun(tx, routineId, due);
		if (run?.taskId) {
			const existingTask = tx.select().from(tasks).where(eq(tasks.id, run.taskId)).get();
			if (existingTask) {
				advanceNextDue(tx, routine, due);
				return { run, task: existingTask, created: false };
			}
		}
		if (!run) run = insertRun(tx, routineId, due, 'open');
		else if (run.status !== 'open')
			run = tx.update(routineRuns).set({ status: 'open', doneAt: null }).where(eq(routineRuns.id, run.id)).returning().get();
		const task = createRunTask(tx, routine, run);
		advanceNextDue(tx, routine, due);
		return { run: { ...run, taskId: task.id }, task, created: true };
	});
}

// ------------------------------------------------------------ scheduler

export type TickResult = {
	today: string;
	runsCreated: number;
	tasksCreated: number;
	missed: number;
	tasks: TaskDTO[];
};

export function tickRoutines(db: Db, today: string = todayInBerlin()): TickResult {
	return db.transaction((tx) => {
		let runsCreated = 0;
		const created: TaskDTO[] = [];
		const active = tx.select().from(routines).where(eq(routines.active, true)).orderBy(asc(routines.id)).all();
		for (const start of active) {
			let routine = start;
			for (let i = 0; i < 60; i++) {
				const due = routine.nextDue;
				if (addDays(due, -routine.leadDays) > today) break;
				let run = findRun(tx, routine.id, due);
				if (!run) {
					run = insertRun(tx, routine.id, due, 'open');
					runsCreated++;
				}
				if (routine.materialize && run.status === 'open' && !run.taskId) created.push(createRunTask(tx, routine, run));
				const next = rhythmNextDue(routine.rhythm, due);
				routine = tx
					.update(routines)
					.set({ nextDue: next, updatedAt: new Date().toISOString() })
					.where(eq(routines.id, routine.id))
					.returning()
					.get();
			}
		}
		const missed = tx
			.update(routineRuns)
			.set({ status: 'missed' })
			.where(and(eq(routineRuns.status, 'open'), lt(routineRuns.due, addDays(today, -7))))
			.returning({ id: routineRuns.id })
			.all().length;
		return { today, runsCreated, tasksCreated: created.length, missed, tasks: created };
	});
}

// ------------------------------------------------------------ dashboard

type Ref = { id: number; name: string; color: string } | null;

export function getRoutinesDashboard(
	db: Db,
	user: SafeUser,
	filters: Omit<RoutineFilters, 'active'> = {}
) {
	const today = todayInBerlin();
	const weekEnd = endOfIsoWeek(today);
	const conds = buildConds(db, user, filters);
	const rows = conds
		? db.select().from(routines).where(conds.length ? and(...conds) : undefined).all()
		: [];
	const counts = { overdue: 0, today: 0, thisWeek: 0 };
	const userRefs = new Map(db.select().from(users).all().map((u) => [u.id, { id: u.id, name: u.name, color: u.color }]));
	const projectRefs = new Map(
		db.select().from(projects).all().map((p) => [p.id, { id: p.id, name: p.name, color: p.color }])
	);
	const taskVis = taskVisibilityCond(user);

	const entries = rows.map((r) => {
		const runs = db
			.select()
			.from(routineRuns)
			.where(eq(routineRuns.routineId, r.id))
			.orderBy(desc(routineRuns.due), desc(routineRuns.id))
			.all();
		const recent = runs.slice(0, 12);
		if (r.active)
			for (const run of runs) {
				if (run.status !== 'open') continue;
				if (run.due < today) counts.overdue++;
				else if (run.due === today) counts.today++;
				else if (run.due <= weekEnd) counts.thisWeek++;
			}
		const last = runs.find((x) => x.status !== 'open');
		const openRun = [...runs].reverse().find((x) => x.status === 'open' || x.status === 'missed') ?? null;
		const hasMissed = recent.some((x) => x.status === 'missed');
		let state: 'paused' | 'broken' | 'overdue' | 'due' | 'ok' = 'ok';
		if (!r.active) state = 'paused';
		else if (hasMissed) state = 'broken';
		else if (openRun && openRun.due < today) state = 'overdue';
		else if (openRun && openRun.due <= addDays(today, r.leadDays)) state = 'due';
		const task = openRun?.taskId
			? (db
					.select({ id: tasks.id, title: tasks.title, status: tasks.status })
					.from(tasks)
					.where(taskVis ? and(eq(tasks.id, openRun.taskId), taskVis) : eq(tasks.id, openRun.taskId))
					.get() ?? null)
			: null;
		return {
			id: r.id,
			title: r.title,
			rhythm: r.rhythm,
			rhythmText: rhythmText(r.rhythm),
			leadDays: r.leadDays,
			materialize: r.materialize,
			active: r.active,
			project: projectRefs.get(r.projectId) ?? null,
			assignee: (r.assigneeId ? userRefs.get(r.assigneeId) : null) as Ref,
			lastRun: last ? { id: last.id, due: last.due, status: last.status, doneAt: last.doneAt } : null,
			openRun: openRun ? { id: openRun.id, due: openRun.due, status: openRun.status, taskId: openRun.taskId } : null,
			nextDue: openRun?.due ?? r.nextDue,
			state,
			task
		};
	});
	entries.sort((a, b) => (a.nextDue === b.nextDue ? a.title.localeCompare(b.title) : a.nextDue < b.nextDue ? -1 : 1));
	return { today, counts, routines: entries };
}
