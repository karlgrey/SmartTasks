import { describe, it, expect } from 'vitest';
import { SIZES, SIZE_HOURS } from './types';

describe('SIZE_HOURS', () => {
	it('gives every size a standard billing value in hours (#447)', () => {
		expect(SIZE_HOURS).toEqual({ XS: 0.25, S: 1, M: 4, L: 8 });
	});

	it('has exactly one entry per SIZES value, in sync with the enum', () => {
		expect(Object.keys(SIZE_HOURS).sort()).toEqual([...SIZES].sort());
	});
});
