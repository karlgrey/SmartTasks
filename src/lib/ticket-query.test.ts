import { describe, it, expect } from 'vitest';
import { parseTicketQuery } from './ticket-query';

describe('parseTicketQuery', () => {
	it('parses a bare number as an exact ticket reference', () => {
		expect(parseTicketQuery('186')).toEqual({ digits: '186', prefix: false });
		expect(parseTicketQuery(' 186 ')).toEqual({ digits: '186', prefix: false });
	});

	it('parses the #-form as a prefix reference (matches while typing)', () => {
		expect(parseTicketQuery('#186')).toEqual({ digits: '186', prefix: true });
		expect(parseTicketQuery('#18')).toEqual({ digits: '18', prefix: true });
	});

	it('returns null for anything that is not a ticket reference', () => {
		expect(parseTicketQuery('wood')).toBeNull();
		expect(parseTicketQuery('186 wood')).toBeNull();
		expect(parseTicketQuery('#')).toBeNull();
		expect(parseTicketQuery('18a')).toBeNull();
		expect(parseTicketQuery('')).toBeNull();
	});
});
