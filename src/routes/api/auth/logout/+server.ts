import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { deleteSession } from '$lib/server/auth';

export const POST: RequestHandler = ({ cookies, request }) => {
	const token = cookies.get('session');
	// TEMPORÄRES Debug-Logging (erratische Logouts, seit 21.08.2026):
	// der Logout-Endpoint ist der einzige Pfad, der Sessions löscht — jeder
	// Aufruf wird geloggt, um versehentliche Auslöser zu finden. Wieder
	// entfernen, sobald die Ursache gefunden ist.
	const ua = (request.headers.get('user-agent') ?? '').slice(0, 70);
	const source = request.headers.get('x-logout-source') ?? 'UNBEKANNT';
	console.log(
		`[auth-debug] logout: cookie=${token ? token.slice(0, 8) + '…' : 'FEHLT'} source=${source} ua="${ua}"`
	);
	if (token) deleteSession(db, token);
	cookies.delete('session', { path: '/' });
	return json({ ok: true });
};
