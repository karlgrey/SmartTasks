// Order = board column order (and select/tab order). Icebox deliberately last
// among the columns; Dropped (#801) is a closed status without its own column —
// it shows in the Done lane behind the "Erledigt | Verworfen" toggle.
export const STATUSES = [
	'Inbox', 'To Do', 'In Progress', 'Supplier', 'Review', 'Done', 'Icebox', 'Dropped'
] as const;
export const PRIORITIES = ['Super-High', 'High', 'Medium', 'Low'] as const;
export const SIZES = ['XS', 'S', 'M', 'L'] as const;

export type Status = (typeof STATUSES)[number];

// Closed = no longer open work: Done (erledigt) or Dropped (bewusst verworfen, #801).
export const CLOSED_STATUSES = ['Done', 'Dropped'] as const satisfies readonly Status[];
export type ClosedStatus = (typeof CLOSED_STATUSES)[number];
export const isClosed = (s: Status): s is ClosedStatus => (CLOSED_STATUSES as readonly Status[]).includes(s);
export const BOARD_STATUSES = STATUSES.filter((s) => s !== 'Dropped');
export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

// Standard-Verrechnungswerte je Size (Stunden), Grundlage für die Abrechnung.
// Abweichungen vom Standardwert werden nicht hier gepflegt, sondern als
// Freitext-Kommentar am Task dokumentiert (#447; siehe README).
export const SIZE_HOURS: Record<Size, number> = {
	XS: 0.25,
	S: 1,
	M: 4,
	L: 8
};

export type UserDTO = {
	id: number;
	name: string;
	email: string | null;
	type: 'human' | 'ai';
	color: string;
};

export type LocationDTO = {
	id: number;
	name: string;
	archived: boolean;
};

export type ProjectDTO = {
	id: number;
	name: string;
	color: string;
	archived: boolean;
	locationId: number | null;
	wikiRef: string | null;
	ownerId: number | null;
};

export type TaskDTO = {
	id: number;
	title: string;
	description: string;
	status: Status;
	priority: Priority | null;
	size: Size | null;
	hours: number | null;
	dueDate: string | null; // ISO date (YYYY-MM-DD)
	assigneeId: number | null;
	projectId: number | null;
	createdBy: number;
	createdAt: string; // ISO datetime
	updatedAt: string;
	completedAt: string | null;
	routineRunId: number | null; // Lauf einer Routine (#795), sonst null
};

export type CommentDTO = {
	id: number;
	taskId: number;
	authorId: number;
	body: string;
	createdAt: string;
};

export type AttachmentDTO = {
	id: number;
	taskId: number;
	filename: string;
	mime: string;
	size: number; // bytes as stored
	createdBy: number;
	createdAt: string;
};

export type DocumentDTO = {
	id: number;
	title: string;
	body: string; // Markdown source
	projectId: number | null;
	pinned: boolean;
	createdBy: number;
	createdAt: string; // ISO datetime
	updatedAt: string;
};

// Lightweight reference to a task from a document's detail
export type TaskRefDTO = {
	id: number;
	title: string;
	status: Status;
};

// Lightweight reference to a document from a task's detail
export type DocRefDTO = {
	id: number;
	title: string;
};

export type StatusEventDTO = {
	id: number;
	taskId: number;
	userId: number;
	fromStatus: Status | null;
	toStatus: Status;
	createdAt: string;
};

// Routinen (#795): wiederkehrende Arbeiten als eigene Entität mit Läufen.
export const RHYTHM_UNITS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type RhythmUnit = (typeof RHYTHM_UNITS)[number];
export type Rhythm = {
	unit: RhythmUnit;
	interval: number;
	weekday?: number; // 1=Mo..7=So, nur unit=week
	dayOfMonth?: number; // 1..31, nur unit=month|quarter
};
export const RUN_STATUSES = ['open', 'done', 'skipped', 'missed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type RoutineDTO = {
	id: number;
	title: string;
	description: string;
	projectId: number;
	locationId: number | null;
	assigneeId: number | null;
	rhythm: Rhythm;
	leadDays: number;
	materialize: boolean;
	active: boolean;
	nextDue: string; // YYYY-MM-DD
	createdBy: number;
	createdAt: string;
	updatedAt: string;
};

export type RoutineRunDTO = {
	id: number;
	routineId: number;
	due: string; // YYYY-MM-DD
	status: RunStatus;
	taskId: number | null;
	doneAt: string | null;
	note: string | null;
	createdAt: string;
};
