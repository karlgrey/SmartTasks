import { sqliteTable, integer, text, real, primaryKey, unique, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
// Relative import (not $lib) on purpose: schema.ts is also loaded by drizzle-kit
// and the plain-tsx scripts in scripts/, which don't know SvelteKit aliases.
import { STATUSES, PRIORITIES, SIZES, RUN_STATUSES, type Rhythm } from '../../types';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	email: text('email').unique(),
	type: text('type', { enum: ['human', 'ai'] }).notNull(),
	passwordHash: text('password_hash'),
	apiKeyHash: text('api_key_hash'),
	color: text('color').notNull().default('#6b7280')
});

// Mehrere API-Keys je User (#670): users.apiKeyHash bleibt als Spalte stehen
// (ungenutzt, kein Datenverlust), neue Keys/Prüfungen laufen ausschließlich
// über api_keys.
export const apiKeys = sqliteTable('api_keys', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	name: text('name').notNull(),
	keyHash: text('key_hash').notNull().unique(),
	createdAt: text('created_at').notNull(),
	lastUsedAt: text('last_used_at'),
	revokedAt: text('revoked_at')
});

export const sessions = sqliteTable('sessions', {
	token: text('token').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull()
});

export const locations = sqliteTable('locations', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false)
});

export const projects = sqliteTable('projects', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	color: text('color').notNull().default('#6b7280'),
	archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
	locationId: integer('location_id').references(() => locations.id),
	wikiRef: text('wiki_ref'),
	ownerId: integer('owner_id').references(() => users.id)
});

export const tasks = sqliteTable('tasks', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	status: text('status', { enum: STATUSES }).notNull().default('Inbox'),
	priority: text('priority', { enum: PRIORITIES }),
	size: text('size', { enum: SIZES }),
	hours: real('hours'),
	dueDate: text('due_date'),
	assigneeId: integer('assignee_id').references(() => users.id),
	projectId: integer('project_id').references(() => projects.id),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	completedAt: text('completed_at'),
	// Lauf einer Routine (#795); Zirkelbezug tasks <-> routine_runs, daher AnySQLiteColumn
	routineRunId: integer('routine_run_id').references((): AnySQLiteColumn => routineRuns.id)
});

export const comments = sqliteTable('comments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	authorId: integer('author_id')
		.notNull()
		.references(() => users.id),
	body: text('body').notNull(),
	createdAt: text('created_at').notNull()
});

export const attachments = sqliteTable('attachments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	filename: text('filename').notNull(),
	mime: text('mime').notNull(),
	size: integer('size').notNull(),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull()
});

export const documents = sqliteTable('documents', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	body: text('body').notNull().default(''),
	projectId: integer('project_id').references(() => projects.id),
	pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const documentTasks = sqliteTable(
	'document_tasks',
	{
		documentId: integer('document_id')
			.notNull()
			.references(() => documents.id),
		taskId: integer('task_id')
			.notNull()
			.references(() => tasks.id)
	},
	(t) => [primaryKey({ columns: [t.documentId, t.taskId] })]
);

export const statusEvents = sqliteTable('status_events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	taskId: integer('task_id')
		.notNull()
		.references(() => tasks.id),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id),
	fromStatus: text('from_status', { enum: STATUSES }),
	toStatus: text('to_status', { enum: STATUSES }).notNull(),
	createdAt: text('created_at').notNull()
});

// Routinen (#795): wiederkehrende Arbeit als eigene Entität; ein Lauf wird erst
// mit Vorlauf (lead_days) zum Task, Automatik-Routinen (materialize=false) nie.
export const routines = sqliteTable('routines', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	title: text('title').notNull(),
	description: text('description').notNull().default(''),
	projectId: integer('project_id')
		.notNull()
		.references(() => projects.id),
	locationId: integer('location_id').references(() => locations.id),
	assigneeId: integer('assignee_id').references(() => users.id),
	rhythm: text('rhythm', { mode: 'json' }).$type<Rhythm>().notNull(),
	leadDays: integer('lead_days').notNull().default(3),
	materialize: integer('materialize', { mode: 'boolean' }).notNull().default(true),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	nextDue: text('next_due').notNull(),
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export const routineRuns = sqliteTable(
	'routine_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		routineId: integer('routine_id')
			.notNull()
			.references(() => routines.id),
		due: text('due').notNull(),
		status: text('status', { enum: RUN_STATUSES }).notNull(),
		taskId: integer('task_id').references((): AnySQLiteColumn => tasks.id),
		doneAt: text('done_at'),
		note: text('note'),
		createdAt: text('created_at').notNull()
	},
	(t) => [unique('routine_runs_routine_due_unique').on(t.routineId, t.due)]
);
