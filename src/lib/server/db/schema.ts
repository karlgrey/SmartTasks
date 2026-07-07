import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';
// Relative import (not $lib) on purpose: schema.ts is also loaded by drizzle-kit
// and the plain-tsx scripts in scripts/, which don't know SvelteKit aliases.
import { STATUSES, PRIORITIES, SIZES } from '../../types';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	email: text('email').unique(),
	type: text('type', { enum: ['human', 'ai'] }).notNull(),
	passwordHash: text('password_hash'),
	apiKeyHash: text('api_key_hash'),
	color: text('color').notNull().default('#6b7280')
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
	wikiRef: text('wiki_ref')
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
	completedAt: text('completed_at')
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
