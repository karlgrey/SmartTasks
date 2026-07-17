import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { listDocuments, parseDocFilters } from '$lib/server/documents-service';

export const load: PageServerLoad = ({ url }) => {
	const filters = parseDocFilters(url.searchParams);
	return {
		documents: listDocuments(db, filters),
		project: filters.project ?? null,
		q: filters.q ?? ''
	};
};
