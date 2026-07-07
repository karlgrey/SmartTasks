import { describe, it, expect } from 'vitest';
import { subscribe, emit, type TaskEvent } from './events';

describe('events', () => {
	it('delivers events to subscribers until unsubscribe', () => {
		const received: TaskEvent[] = [];
		const unsubscribe = subscribe((e) => received.push(e));
		const event = { type: 'task.updated', task: { id: 1 } } as unknown as TaskEvent;
		emit(event);
		expect(received).toEqual([event]);
		unsubscribe();
		emit(event);
		expect(received).toHaveLength(1);
	});

	it('a throwing subscriber does not break others', () => {
		const received: TaskEvent[] = [];
		const bad = subscribe(() => {
			throw new Error('boom');
		});
		const good = subscribe((e) => received.push(e));
		emit({ type: 'task.created', task: { id: 2 } } as unknown as TaskEvent);
		expect(received).toHaveLength(1);
		bad();
		good();
	});
});
