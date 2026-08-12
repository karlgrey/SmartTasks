import type { TaskDTO, UserDTO, ProjectDTO, LocationDTO, Status } from '$lib/types';
import { STATUSES } from '$lib/types';
import { parseTicketQuery } from '$lib/ticket-query';
import { todayInBerlin } from '$lib/date-utils';
import { api } from './api';

const PRIORITY_ORDER: Record<string, number> = { 'Super-High': 0, High: 1, Medium: 2, Low: 3 };

export function compareTasks(a: TaskDTO, b: TaskDTO): number {
	const pa = a.priority ? PRIORITY_ORDER[a.priority] : 4;
	const pb = b.priority ? PRIORITY_ORDER[b.priority] : 4;
	if (pa !== pb) return pa - pb;
	if (a.dueDate !== b.dueDate) {
		if (a.dueDate === null) return 1;
		if (b.dueDate === null) return -1;
		return a.dueDate < b.dueDate ? -1 : 1;
	}
	return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function compareDone(a: TaskDTO, b: TaskDTO): number {
	const ka = a.completedAt ?? a.createdAt;
	const kb = b.completedAt ?? b.createdAt;
	return ka < kb ? 1 : ka > kb ? -1 : 0;
}

type InitData = {
	user: UserDTO;
	tasks: TaskDTO[];
	done: TaskDTO[];
	counts?: Record<Status, number>;
	users: UserDTO[];
	projects: ProjectDTO[];
	locations: LocationDTO[];
};

function zeroCounts(): Record<Status, number> {
	return Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
}

class BoardState {
	me = $state<UserDTO | null>(null);
	tasks = $state<TaskDTO[]>([]);
	users = $state<UserDTO[]>([]);
	projects = $state<ProjectDTO[]>([]);
	locations = $state<LocationDTO[]>([]);
	// Lane totals (independent of pagination/board filters), see /api/tasks/counts (#400).
	counts = $state<Record<Status, number>>(zeroCounts());
	flashes = $state<Record<number, boolean>>({});
	lastDeletedId = $state<number | null>(null);
	toasts = $state<{ id: number; message: string }[]>([]);
	#toastId = 0;

	init(data: InitData) {
		this.me = data.user;
		this.tasks = [...data.tasks, ...data.done];
		this.counts = data.counts ?? zeroCounts();
		this.users = data.users;
		this.projects = data.projects;
		this.locations = data.locations;
	}

	// Cheap fire-and-forget refresh of the lane totals; called after mutations
	// that change a task's status or existence. Never awaited by callers, and
	// failures are swallowed — the header just keeps showing the last known
	// count rather than blocking or erroring the UI.
	async loadCounts() {
		try {
			this.counts = await api<Record<Status, number>>('/api/tasks/counts');
		} catch {
			// best-effort; keep the previous counts on failure
		}
	}

	// Header label for a lane: the plain total, or "visible/total" when the
	// rendered subset (board filters, or the Done lane's pagination) differs
	// from the true total.
	countLabel(status: Status, visible: number): string {
		const total = this.counts[status];
		return visible === total ? String(total) : `${visible}/${total}`;
	}

	filtered(params: URLSearchParams): TaskDTO[] {
		const assignee = params.get('assignee');
		const project = params.get('project');
		const location = params.get('location');
		const today = params.get('today') === 'true';
		const todayStr = today ? todayInBerlin() : null;
		const q = params.get('q')?.toLowerCase();
		const ticket = q ? parseTicketQuery(q) : null;
		return this.tasks
			.filter(
				(t) =>
					(!assignee || String(t.assigneeId) === assignee) &&
					(!project || String(t.projectId) === project) &&
					(!location ||
						this.projects.find((p) => p.id === t.projectId)?.locationId === Number(location)) &&
					(!today || (t.status !== 'Done' && t.dueDate !== null && t.dueDate <= todayStr!)) &&
					(!q ||
						t.title.toLowerCase().includes(q) ||
						t.description.toLowerCase().includes(q) ||
						(ticket !== null &&
							(ticket.prefix
								? String(t.id).startsWith(ticket.digits)
								: String(t.id) === ticket.digits)))
			)
			.sort(compareTasks);
	}

	// Active board filters, mapped to field values for a new task — quick-add uses
	// this so a freshly created task doesn't vanish behind the very filter that's on.
	filterDefaults(params: URLSearchParams): { assigneeId?: number; projectId?: number } {
		const defaults: { assigneeId?: number; projectId?: number } = {};
		const assignee = params.get('assignee');
		if (assignee) defaults.assigneeId = Number(assignee);
		const project = params.get('project');
		if (project) defaults.projectId = Number(project);
		return defaults;
	}

	upsert(task: TaskDTO, opts: { flash?: boolean } = {}) {
		const i = this.tasks.findIndex((t) => t.id === task.id);
		if (i === -1) this.tasks.push(task);
		else this.tasks[i] = task;
		if (opts.flash) {
			this.flashes[task.id] = true;
			setTimeout(() => delete this.flashes[task.id], 1500);
		}
	}

	async createTask(input: Partial<TaskDTO> & { title: string }) {
		try {
			this.upsert(await api<TaskDTO>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }));
			void this.loadCounts(); // fire-and-forget: a new task changes a lane's total
		} catch (e) {
			this.toast((e as Error).message);
		}
	}

	async patchTask(id: number, patch: Partial<TaskDTO>) {
		const i = this.tasks.findIndex((t) => t.id === id);
		const before = i === -1 ? null : this.tasks[i];
		if (before) this.tasks[i] = { ...before, ...patch }; // optimistic
		try {
			const saved = await api<TaskDTO>(`/api/tasks/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch)
			});
			this.upsert(saved);
			// only a status change moves a task between lanes and changes totals
			if ('status' in patch) void this.loadCounts();
		} catch (e) {
			if (before) this.upsert(before); // rollback
			this.toast((e as Error).message);
		}
	}

	remove(id: number) {
		this.tasks = this.tasks.filter((t) => t.id !== id);
		// covers both deleteTask (below) and SSE-driven removal (another user's/agent's
		// delete) — either way a lane's total just changed
		void this.loadCounts();
	}

	async deleteTask(id: number): Promise<boolean> {
		try {
			await api<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });
			this.remove(id);
			return true;
		} catch (e) {
			this.toast((e as Error).message);
			return false;
		}
	}

	async loadMoreDone() {
		const offset = this.tasks.filter((t) => t.status === 'Done').length;
		const more = await api<TaskDTO[]>(`/api/tasks?status=Done&limit=50&offset=${offset}`);
		for (const t of more) this.upsert(t);
	}

	async refetch() {
		const [open, done] = await Promise.all([
			api<TaskDTO[]>('/api/tasks?open=true'),
			api<TaskDTO[]>('/api/tasks?status=Done&limit=50')
		]);
		this.tasks = [...open, ...done];
	}

	connectSse(): () => void {
		const es = new EventSource('/api/events');
		let dropped = false;
		es.onmessage = (m) => {
			try {
				const e = JSON.parse(m.data);
				if (e.type === 'task.deleted' && e.task) {
					this.remove(e.task.id);
					this.lastDeletedId = e.task.id;
				}
				else if (e.task) {
					this.upsert(e.task, { flash: true });
					// another user/agent may have moved the task between lanes —
					// refresh the totals so the header never shows e.g. "13/12" (#400)
					void this.loadCounts();
				}
			} catch {
				// ignore malformed events
			}
		};
		es.onerror = () => {
			dropped = true; // EventSource reconnects on its own
		};
		es.onopen = () => {
			if (dropped) {
				dropped = false;
				this.refetch(); // resync anything missed while offline
			}
		};
		return () => es.close();
	}

	toast(message: string) {
		const id = ++this.#toastId;
		this.toasts.push({ id, message });
		setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 4000);
	}
}

export const board = new BoardState();
