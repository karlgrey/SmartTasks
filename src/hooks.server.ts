import type { Handle } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveUser } from '$lib/server/auth';
import { tickRoutines } from '$lib/server/routines-service';
import { emit } from '$lib/server/events';
import { todayInBerlin } from '$lib/date-utils';

// Routinen-Scheduler (#795): einmal je Berlin-Kalendertag, ausgelöst vom ersten
// authentifizierten Request. Fehler dürfen nie den Request brechen.
let lastTickDay = '';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionToken = event.cookies.get('session');
	event.locals.user = resolveUser(db, {
		bearer: event.request.headers.get('authorization'),
		sessionToken
	});
	// TEMPORÄRES Debug-Logging (erratische Logouts, seit 21.08.2026): loggt
	// jeden nicht aufgelösten Seitenaufruf — unterscheidet "Cookie fehlt im
	// Request" von "Cookie da, aber Session nicht auflösbar". Wieder
	// entfernen, sobald die Ursache gefunden ist.
	if (!event.locals.user && event.request.headers.get('sec-fetch-dest') === 'document') {
		const ua = (event.request.headers.get('user-agent') ?? '').slice(0, 70);
		console.log(
			`[auth-debug] unauth document: path=${event.url.pathname}` +
				` cookie=${sessionToken ? sessionToken.slice(0, 8) + '…' : 'FEHLT'} ua="${ua}"`
		);
	}
	if (event.locals.user && todayInBerlin() !== lastTickDay) {
		lastTickDay = todayInBerlin();
		try {
			for (const task of tickRoutines(db).tasks) emit({ type: 'task.created', task });
		} catch (e) {
			console.error('[routines] tick failed', e);
		}
	}
	return resolve(event);
};
