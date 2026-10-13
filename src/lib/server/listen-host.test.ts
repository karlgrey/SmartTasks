import { describe, it, expect } from 'vitest';
import { applyDefaultListenHost, DEFAULT_LISTEN_HOST } from './listen-host';

describe('applyDefaultListenHost', () => {
	it('setzt HOST auf 127.0.0.1, wenn nicht gesetzt', () => {
		const env: Record<string, string | undefined> = {};
		applyDefaultListenHost(env);
		expect(env.HOST).toBe('127.0.0.1');
		expect(DEFAULT_LISTEN_HOST).toBe('127.0.0.1');
	});

	it('setzt HOST auch bei leerem String', () => {
		const env: Record<string, string | undefined> = { HOST: '' };
		applyDefaultListenHost(env);
		expect(env.HOST).toBe('127.0.0.1');
	});

	it('lässt einen gesetzten Wert unangetastet', () => {
		const env: Record<string, string | undefined> = { HOST: '0.0.0.0' };
		applyDefaultListenHost(env);
		expect(env.HOST).toBe('0.0.0.0');
	});
});
