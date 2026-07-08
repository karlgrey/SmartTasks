import type { TaskDTO, UserDTO, ProjectDTO, LocationDTO } from '$lib/types';
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
	users: UserDTO[];
	projects: ProjectDTO[];
	locations: LocationDTO[];
};

class BoardState {
	me = $state<UserDTO | null>(null);
	tasks = $state<TaskDTO[]>([]);
	users = $state<UserDTO[]>([]);
	projects = $state<ProjectDTO[]>([]);
	locations = $state<LocationDTO[]>([]);
	flashes = $state<Record<number, boolean>>({});
	lastDeletedId = $state<number | null>(null);
	toasts = $state<{ id: number; message: string }[]>([]);
	#toastId = 0;

	init(data: InitData) {
		this.me = data.user;
		this.tasks = [...data.tasks, ...data.done];
		this.users = data.users;
		this.projects = data.projects;
		this.locations = data.locations;
	}

	filtered(params: URLSearchParams): TaskDTO[] {
		const assignee = params.get('assignee');
		const project = params.get('project');
		const location = params.get('location');
		const q = params.get('q')?.toLowerCase();
		return this.tasks
			.filter(
				(t) =>
					(!assignee || String(t.assigneeId) === assignee) &&
					(!project || String(t.projectId) === project) &&
					(!location ||
						this.projects.find((p) => p.id === t.projectId)?.locationId === Number(location)) &&
					(!q ||
						t.title.toLowerCase().includes(q) ||
						t.description.toLowerCase().includes(q))
			)
			.sort(compareTasks);
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
		} catch (e) {
			if (before) this.upsert(before); // rollback
			this.toast((e as Error).message);
		}
	}

	remove(id: number) {
		this.tasks = this.tasks.filter((t) => t.id !== id);
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
				else if (e.task) this.upsert(e.task, { flash: true });
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
