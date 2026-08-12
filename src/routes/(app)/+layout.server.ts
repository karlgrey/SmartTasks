import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listTasks, getTaskCounts } from '$lib/server/tasks-service';
import { listProjects, listUsers } from '$lib/server/projects-service';
import { listLocations } from '$lib/server/locations-service';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		user: locals.user,
		tasks: listTasks(db, locals.user, { open: true }),
		done: listTasks(db, locals.user, { status: 'Done', limit: 50 }),
		counts: getTaskCounts(db, locals.user),
		users: listUsers(db),
		projects: listProjects(db, locals.user),
		locations: listLocations(db)
	};
};
