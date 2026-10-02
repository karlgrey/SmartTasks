import { describe, it, expect } from 'vitest';
import { SIZES, SIZE_HOURS, STATUSES, BOARD_STATUSES, isClosed } from './types';

describe('SIZE_HOURS', () => {
	it('gives every size a standard billing value in hours (#447)', () => {
		expect(SIZE_HOURS).toEqual({ XS: 0.25, S: 1, M: 4, L: 8 });
	});

	it('has exactly one entry per SIZES value, in sync with the enum', () => {
		expect(Object.keys(SIZE_HOURS).sort()).toEqual([...SIZES].sort());
	});
});

describe('Dropped status (#801)', () => {
	it('is a status, but not a board column', () => {
		expect(STATUSES).toContain('Dropped');
		expect(BOARD_STATUSES).not.toContain('Dropped');
		expect(BOARD_STATUSES).toEqual(STATUSES.filter((s) => s !== 'Dropped'));
	});

	it('isClosed is true for Done and Dropped only', () => {
		expect(STATUSES.filter(isClosed)).toEqual(['Done', 'Dropped']);
	});
});
