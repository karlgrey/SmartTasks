import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listTasks } from '$lib/server/tasks-service';
import { listProjects, listUsers } from '$lib/server/projects-service';
import { listLocations } from '$lib/server/locations-service';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		user: locals.user,
		tasks: listTasks(db, { open: true }),
		done: listTasks(db, { status: 'Done', limit: 50 }),
		users: listUsers(db),
		projects: listProjects(db),
		locations: listLocations(db)
	};
};
