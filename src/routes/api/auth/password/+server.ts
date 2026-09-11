import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { changePassword } from '$lib/server/auth';
import { run, requireUser } from '$lib/server/api-utils';
import { ServiceError } from '$lib/server/errors';

export const POST: RequestHandler = ({ request, locals }) =>
	run(async () => {
		const user = requireUser(locals);
		if (user.type !== 'human') throw new ServiceError(403, 'not for api users');
		const { currentPassword, newPassword } = await request.json().catch(() => ({}));
		if (!currentPassword || !newPassword) {
			throw new ServiceError(400, 'currentPassword and newPassword required');
		}
		changePassword(db, user.id, currentPassword, newPassword);
		return json({ ok: true });
	});
