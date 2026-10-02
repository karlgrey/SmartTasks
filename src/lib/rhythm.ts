// Rhythmus-Rechnung für Routinen (#795). Rein, ohne DB. Alle Daten sind
// YYYY-MM-DD-Strings; gerechnet wird über UTC-Date-Objekte aus den Komponenten
// (keine lokale Zeitzone), damit Berlin-Kalendertage stabil bleiben. "Heute"
// kommt immer von todayInBerlin() (date-utils) und wird hier übergeben.
import { RHYTHM_UNITS, type Rhythm, type RhythmUnit } from './types';

// Der Service wrappt das in ServiceError(400).
export class RhythmError extends Error {}

type Ymd = { y: number; m: number; d: number };

function parse(date: string): Ymd {
	const [y, m, d] = date.split('-').map(Number);
	return { y, m, d };
}

function fmt(y: number, m: number, d: number): string {
	return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// month: 1..12, may over-/underflow (e.g. 14 = Feb of next year); day is clamped to month end
function monthDate(y: number, month: number, day: number): string {
	const total = y * 12 + (month - 1);
	const yy = Math.floor(total / 12);
	const mm = (total % 12) + 1;
	return fmt(yy, mm, Math.min(day, daysInMonth(yy, mm)));
}

export function addDays(date: string, n: number): string {
	const { y, m, d } = parse(date);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// 1=Mo..7=So
function weekdayOf(date: string): number {
	const { y, m, d } = parse(date);
	const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return wd === 0 ? 7 : wd;
}

export function isoWeek(date: string): number {
	const { y, m, d } = parse(date);
	const t = new Date(Date.UTC(y, m - 1, d));
	t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7)); // Thursday of this week
	const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
	return Math.ceil(((t.getTime() - yearStart) / 86400000 + 1) / 7);
}

// Sunday of the ISO week containing `today`
export function endOfIsoWeek(today: string): string {
	return addDays(today, 7 - weekdayOf(today));
}

export function validateRhythm(x: unknown): Rhythm {
	if (typeof x !== 'object' || x === null || Array.isArray(x))
		throw new RhythmError('invalid rhythm: must be an object');
	const o = x as Record<string, unknown>;
	if (!RHYTHM_UNITS.includes(o.unit as RhythmUnit))
		throw new RhythmError(`invalid rhythm.unit: must be one of ${RHYTHM_UNITS.join(', ')}`);
	const unit = o.unit as RhythmUnit;
	const interval = o.interval === undefined || o.interval === null ? 1 : o.interval;
	if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 1)
		throw new RhythmError('invalid rhythm.interval: must be an integer >= 1');
	const rhythm: Rhythm = { unit, interval };
	if (o.weekday !== undefined && o.weekday !== null) {
		if (unit !== 'week') throw new RhythmError('invalid rhythm.weekday: only allowed for unit week');
		if (typeof o.weekday !== 'number' || !Number.isInteger(o.weekday) || o.weekday < 1 || o.weekday > 7)
			throw new RhythmError('invalid rhythm.weekday: must be an integer 1 (Mon) to 7 (Sun)');
		rhythm.weekday = o.weekday;
	}
	if (o.dayOfMonth !== undefined && o.dayOfMonth !== null) {
		if (unit !== 'month' && unit !== 'quarter')
			throw new RhythmError('invalid rhythm.dayOfMonth: only allowed for unit month or quarter');
		if (typeof o.dayOfMonth !== 'number' || !Number.isInteger(o.dayOfMonth) || o.dayOfMonth < 1 || o.dayOfMonth > 31)
			throw new RhythmError('invalid rhythm.dayOfMonth: must be an integer 1 to 31');
		rhythm.dayOfMonth = o.dayOfMonth;
	}
	return rhythm;
}

// First due date STRICTLY after `from`.
export function nextDue(rhythm: Rhythm, from: string): string {
	const { y, m, d } = parse(from);
	const { unit, interval } = rhythm;
	switch (unit) {
		case 'day':
			return addDays(from, interval);
		case 'week': {
			if (rhythm.weekday === undefined) return addDays(from, interval * 7);
			const wd = weekdayOf(from);
			if (wd === rhythm.weekday) return addDays(from, interval * 7);
			return addDays(from, ((rhythm.weekday - wd + 7) % 7) || 7);
		}
		case 'month':
		case 'quarter': {
			const step = unit === 'quarter' ? 3 * interval : interval;
			const target = rhythm.dayOfMonth ?? d;
			const candidate = monthDate(y, m, target);
			return candidate > from ? candidate : monthDate(y, m + step, target);
		}
		case 'year': {
			const candidate = monthDate(y, m, d);
			return candidate > from ? candidate : monthDate(y + interval, m, d);
		}
	}
}

export function firstDueOnOrAfter(rhythm: Rhythm, today: string): string {
	return nextDue(rhythm, addDays(today, -1));
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function periodLabel(rhythm: Rhythm, due: string): string {
	const { y, m, d } = parse(due);
	switch (rhythm.unit) {
		case 'week':
			return `KW ${isoWeek(due)}`;
		case 'month':
			return `${MONTHS[m - 1]} ${y}`;
		case 'quarter':
			return `Q${Math.ceil(m / 3)} ${y}`;
		case 'year':
			return `${y}`;
		case 'day':
			return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
	}
}

const WEEKDAYS = ['montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags', 'sonntags'];

export function rhythmText(rhythm: Rhythm): string {
	const { unit, interval } = rhythm;
	const day = rhythm.dayOfMonth !== undefined ? ` am ${rhythm.dayOfMonth}.` : '';
	switch (unit) {
		case 'day':
			return interval === 1 ? 'täglich' : `alle ${interval} Tage`;
		case 'week': {
			const wd = rhythm.weekday !== undefined ? ` ${WEEKDAYS[rhythm.weekday - 1]}` : '';
			return (interval === 1 ? 'wöchentlich' : `alle ${interval} Wochen`) + wd;
		}
		case 'month':
			return (interval === 1 ? 'monatlich' : `alle ${interval} Monate`) + day;
		case 'quarter':
			return (interval === 1 ? 'quartalsweise' : `alle ${interval} Quartale`) + day;
		case 'year':
			return interval === 1 ? 'jährlich' : `alle ${interval} Jahre`;
	}
}
