export const STATUSES = [
	'Inbox', 'To Do', 'Icebox', 'In Progress', 'Supplier', 'Review', 'Done'
] as const;
export const PRIORITIES = ['Super-High', 'High', 'Medium', 'Low'] as const;
export const SIZES = ['S', 'M', 'L'] as const;

export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Size = (typeof SIZES)[number];

export type UserDTO = {
	id: number;
	name: string;
	email: string | null;
	type: 'human' | 'ai';
	color: string;
};

export type ProjectDTO = {
	id: number;
	name: string;
	color: string;
	archived: boolean;
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
};

export type CommentDTO = {
	id: number;
	taskId: number;
	authorId: number;
	body: string;
	createdAt: string;
};
