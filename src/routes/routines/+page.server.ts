import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { getRoutinesDashboard, parseRoutineFilters } from '$lib/server/routines-service';

export const load: PageServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(302, '/login');
	const { active: _active, ...filters } = parseRoutineFilters(url.searchParams);
	return {
		dashboard: getRoutinesDashboard(db, locals.user, filters),
		project: filters.project ?? null,
		assignee: filters.assignee ?? ''
	};
};
