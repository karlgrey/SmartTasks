import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayInBerlin } from './date-utils';

describe('todayInBerlin', () => {
	afterEach(() => vi.useRealTimers());

	it('formats as YYYY-MM-DD', () => {
		expect(todayInBerlin()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('uses Europe/Berlin, not UTC — late UTC evening in summer is already the next day there', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-25T23:00:00Z')); // 01:00 CEST on the 26th
		expect(todayInBerlin()).toBe('2026-07-26');
	});

	it('uses Europe/Berlin in winter too (CET, UTC+1)', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T23:30:00Z')); // 00:30 CET on the 2nd
		expect(todayInBerlin()).toBe('2026-01-02');
	});
});
