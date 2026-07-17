import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listProjects, listUsers } from '$lib/server/projects-service';

export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) redirect(302, '/login');
	return {
		user: locals.user,
		projects: listProjects(db),
		users: listUsers(db)
	};
};
