import type { RequestHandler } from './$types';
import { run, requireUser } from '$lib/server/api-utils';
import { subscribe } from '$lib/server/events';

export const GET: RequestHandler = ({ locals }) =>
	run(() => {
		requireUser(locals);
		let unsubscribe: () => void = () => {};
		let ping: ReturnType<typeof setInterval> | undefined;
		const stream = new ReadableStream({
			start(controller) {
				const encoder = new TextEncoder();
				const send = (chunk: string) => {
					try {
						controller.enqueue(encoder.encode(chunk));
					} catch {
						unsubscribe();
						clearInterval(ping);
					}
				};
				send(': connected\n\n');
				unsubscribe = subscribe((e) => send(`data: ${JSON.stringify(e)}\n\n`));
				ping = setInterval(() => send(': ping\n\n'), 25000);
			},
			cancel() {
				unsubscribe();
				clearInterval(ping);
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
