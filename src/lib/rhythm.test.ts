import { describe, it, expect } from 'vitest';
import {
	validateRhythm,
	nextDue,
	firstDueOnOrAfter,
	periodLabel,
	rhythmText,
	isoWeek,
	addDays,
	endOfIsoWeek
} from './rhythm';
import type { Rhythm } from './types';

const r = (x: Rhythm) => x;

describe('addDays / isoWeek / endOfIsoWeek', () => {
	it('adds days across month and year borders', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
	});
	it('ISO week incl. year change', () => {
		expect(isoWeek('2026-10-12')).toBe(42);
		expect(isoWeek('2026-12-31')).toBe(53);
		expect(isoWeek('2027-01-01')).toBe(53);
		expect(isoWeek('2027-01-04')).toBe(1);
		expect(isoWeek('2024-12-30')).toBe(1);
	});
	it('end of ISO week is the Sunday', () => {
		expect(endOfIsoWeek('2026-10-02')).toBe('2026-10-04'); // Friday
		expect(endOfIsoWeek('2026-10-04')).toBe('2026-10-04'); // Sunday
		expect(endOfIsoWeek('2026-10-05')).toBe('2026-10-11'); // Monday
	});
});

describe('validateRhythm', () => {
	it('accepts valid rhythms and defaults interval to 1', () => {
		expect(validateRhythm({ unit: 'week', weekday: 1 })).toEqual({ unit: 'week', interval: 1, weekday: 1 });
		expect(validateRhythm({ unit: 'month', interval: 2, dayOfMonth: 15 })).toEqual({
			unit: 'month',
			interval: 2,
			dayOfMonth: 15
		});
		expect(validateRhythm({ unit: 'year' })).toEqual({ unit: 'year', interval: 1 });
	});
	it('rejects invalid input', () => {
		expect(() => validateRhythm(null)).toThrowError(/rhythm/);
		expect(() => validateRhythm({ unit: 'hour' })).toThrowError(/unit/);
		expect(() => validateRhythm({ unit: 'day', interval: 0 })).toThrowError(/interval/);
		expect(() => validateRhythm({ unit: 'day', interval: 1.5 })).toThrowError(/interval/);
		expect(() => validateRhythm({ unit: 'month', weekday: 1 })).toThrowError(/weekday/);
		expect(() => validateRhythm({ unit: 'week', weekday: 8 })).toThrowError(/weekday/);
		expect(() => validateRhythm({ unit: 'week', dayOfMonth: 3 })).toThrowError(/dayOfMonth/);
		expect(() => validateRhythm({ unit: 'month', dayOfMonth: 32 })).toThrowError(/dayOfMonth/);
		expect(() => validateRhythm({ unit: 'year', dayOfMonth: 3 })).toThrowError(/dayOfMonth/);
	});
});

describe('nextDue', () => {
	it('day', () => {
		expect(nextDue(r({ unit: 'day', interval: 1 }), '2026-12-31')).toBe('2027-01-01');
		expect(nextDue(r({ unit: 'day', interval: 3 }), '2026-02-27')).toBe('2026-03-02');
	});
	it('week with weekday jumps to the next such weekday, strictly after from', () => {
		// 2026-10-02 is a Friday
		expect(nextDue(r({ unit: 'week', interval: 1, weekday: 1 }), '2026-10-02')).toBe('2026-10-05');
		expect(nextDue(r({ unit: 'week', interval: 1, weekday: 5 }), '2026-10-02')).toBe('2026-10-09');
		expect(nextDue(r({ unit: 'week', interval: 2, weekday: 5 }), '2026-10-02')).toBe('2026-10-16');
		// month and year border: Thursday 2026-12-31 -> Monday 2027-01-04
		expect(nextDue(r({ unit: 'week', interval: 1, weekday: 1 }), '2026-12-31')).toBe('2027-01-04');
		expect(nextDue(r({ unit: 'week', interval: 1, weekday: 7 }), '2026-10-02')).toBe('2026-10-04');
	});
	it('week without weekday = from + interval weeks', () => {
		expect(nextDue(r({ unit: 'week', interval: 2 }), '2026-10-02')).toBe('2026-10-16');
	});
	it('month with dayOfMonth, clamped to month end', () => {
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 15 }), '2026-10-02')).toBe('2026-10-15');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 15 }), '2026-10-15')).toBe('2026-11-15');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 31 }), '2026-01-31')).toBe('2026-02-28');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 31 }), '2028-01-31')).toBe('2028-02-29');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 31 }), '2026-03-31')).toBe('2026-04-30');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 31 }), '2026-02-28')).toBe('2026-03-31');
		expect(nextDue(r({ unit: 'month', interval: 3, dayOfMonth: 1 }), '2026-11-01')).toBe('2027-02-01');
		expect(nextDue(r({ unit: 'month', interval: 1, dayOfMonth: 5 }), '2026-12-20')).toBe('2027-01-05');
	});
	it('month without dayOfMonth keeps the day of from', () => {
		expect(nextDue(r({ unit: 'month', interval: 1 }), '2026-10-02')).toBe('2026-11-02');
	});
	it('quarter', () => {
		expect(nextDue(r({ unit: 'quarter', interval: 1, dayOfMonth: 5 }), '2026-10-05')).toBe('2027-01-05');
		expect(nextDue(r({ unit: 'quarter', interval: 1, dayOfMonth: 5 }), '2026-10-02')).toBe('2026-10-05');
		expect(nextDue(r({ unit: 'quarter', interval: 2, dayOfMonth: 31 }), '2026-01-31')).toBe('2026-07-31');
	});
	it('year incl. 29 Feb', () => {
		expect(nextDue(r({ unit: 'year', interval: 1 }), '2026-10-02')).toBe('2027-10-02');
		expect(nextDue(r({ unit: 'year', interval: 1 }), '2028-02-29')).toBe('2029-02-28');
		expect(nextDue(r({ unit: 'year', interval: 4 }), '2028-02-29')).toBe('2032-02-29');
		expect(nextDue(r({ unit: 'year', interval: 2 }), '2026-10-02')).toBe('2028-10-02');
	});
});

describe('firstDueOnOrAfter', () => {
	it('returns today when today is a due date', () => {
		expect(firstDueOnOrAfter(r({ unit: 'week', interval: 1, weekday: 5 }), '2026-10-02')).toBe('2026-10-02');
		expect(firstDueOnOrAfter(r({ unit: 'month', interval: 1, dayOfMonth: 2 }), '2026-10-02')).toBe('2026-10-02');
		expect(firstDueOnOrAfter(r({ unit: 'day', interval: 1 }), '2026-10-02')).toBe('2026-10-02');
	});
	it('otherwise the next occurrence', () => {
		expect(firstDueOnOrAfter(r({ unit: 'week', interval: 1, weekday: 1 }), '2026-10-02')).toBe('2026-10-05');
	});
});

describe('periodLabel', () => {
	it('week, month, quarter, year, day', () => {
		expect(periodLabel(r({ unit: 'week', interval: 1 }), '2026-10-12')).toBe('KW 42');
		expect(periodLabel(r({ unit: 'week', interval: 1 }), '2027-01-01')).toBe('KW 53');
		expect(periodLabel(r({ unit: 'month', interval: 1 }), '2026-10-15')).toBe('Okt 2026');
		expect(periodLabel(r({ unit: 'month', interval: 1 }), '2026-03-15')).toBe('Mär 2026');
		expect(periodLabel(r({ unit: 'quarter', interval: 1 }), '2026-10-05')).toBe('Q4 2026');
		expect(periodLabel(r({ unit: 'quarter', interval: 1 }), '2026-01-05')).toBe('Q1 2026');
		expect(periodLabel(r({ unit: 'year', interval: 1 }), '2026-10-05')).toBe('2026');
		expect(periodLabel(r({ unit: 'day', interval: 1 }), '2026-10-05')).toBe('05.10.');
	});
});

describe('rhythmText', () => {
	it('renders German descriptions', () => {
		expect(rhythmText(r({ unit: 'day', interval: 1 }))).toBe('täglich');
		expect(rhythmText(r({ unit: 'day', interval: 2 }))).toBe('alle 2 Tage');
		expect(rhythmText(r({ unit: 'week', interval: 1, weekday: 1 }))).toBe('wöchentlich montags');
		expect(rhythmText(r({ unit: 'week', interval: 2, weekday: 5 }))).toBe('alle 2 Wochen freitags');
		expect(rhythmText(r({ unit: 'week', interval: 1 }))).toBe('wöchentlich');
		expect(rhythmText(r({ unit: 'month', interval: 1, dayOfMonth: 15 }))).toBe('monatlich am 15.');
		expect(rhythmText(r({ unit: 'month', interval: 3, dayOfMonth: 1 }))).toBe('alle 3 Monate am 1.');
		expect(rhythmText(r({ unit: 'month', interval: 1 }))).toBe('monatlich');
		expect(rhythmText(r({ unit: 'quarter', interval: 1, dayOfMonth: 5 }))).toBe('quartalsweise am 5.');
		expect(rhythmText(r({ unit: 'year', interval: 1 }))).toBe('jährlich');
		expect(rhythmText(r({ unit: 'year', interval: 2 }))).toBe('alle 2 Jahre');
	});
});
