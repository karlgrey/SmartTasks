import type { RequestHandler } from './$types';
import { run, requireUser } from '$lib/server/api-utils';
import { subscribe } from '$lib/server/events';
import { db } from '$lib/server/db';
import { canSeeEvent } from '$lib/server/visibility';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		const user = requireUser(locals);
		let unsubscribe: () => void = () => {};
		let ping: ReturnType<typeof setInterval> | undefined;
		let closed = false;
		const cleanup = () => {
			closed = true;
			unsubscribe();
			if (ping) clearInterval(ping);
		};
		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				const send = (chunk: string) => {
					if (closed) return;
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {
						cleanup();
					}
				};
				send(': connected\n\n');
				if (closed) return;
				unsubscribe = subscribe((e) => {
					if (!canSeeEvent(db, user, e)) return;
					send(`data: ${JSON.stringify(e)}\n\n`);
				});
				ping = setInterval(() => send(': ping\n\n'), 25000);
			},
			cancel() {
				cleanup();
			}
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive'
			}
		});
	});
