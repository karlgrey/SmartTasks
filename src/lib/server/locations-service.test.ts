import { describe, it, expect } from 'vitest';
import { listLocations, createLocation, updateLocation } from './locations-service';
import { testDb } from './test-utils';

describe('locations', () => {
	it('creates, lists (name asc), renames, and archives', () => {
		const db = testDb();
		const b = createLocation(db, { name: 'Wohnwerk Wandlitz' });
		const a = createLocation(db, { name: '  Schiffmühle  ' });
		expect(a.name).toBe('Schiffmühle');
		expect(listLocations(db).map((l) => l.name)).toEqual(['Schiffmühle', 'Wohnwerk Wandlitz']);
		expect(updateLocation(db, b.id, { archived: true }).archived).toBe(true);
		expect(updateLocation(db, a.id, { name: 'Zukunftspark' }).name).toBe('Zukunftspark');
	});

	it('rejects empty names, 404s, and no-ops on empty patch', () => {
		const db = testDb();
		expect(() => createLocation(db, { name: '  ' })).toThrowError('name is required');
		expect(() => updateLocation(db, 99, { name: 'x' })).toThrowError('location not found');
		const l = createLocation(db, { name: 'Office' });
		expect(() => updateLocation(db, l.id, { name: ' ' })).toThrowError('name is required');
		expect(updateLocation(db, l.id, {})).toEqual(l);
	});

	it('rejects duplicate names with a 400', () => {
		const db = testDb();
		createLocation(db, { name: 'Office' });
		expect(() => createLocation(db, { name: ' Office ' })).toThrowError(
			'location name already exists'
		);
		const other = createLocation(db, { name: 'Studio' });
		expect(() => updateLocation(db, other.id, { name: 'Office' })).toThrowError(
			'location name already exists'
		);
		// renaming to its own name is fine
		expect(updateLocation(db, other.id, { name: 'Studio' }).name).toBe('Studio');
	});
});
