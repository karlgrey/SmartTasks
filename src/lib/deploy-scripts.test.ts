import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #803: sudoers matcht Befehl + Argumente WOERTLICH. Auf labs darf `deploy`
// (sudo -l, Stand 06.10.2026) nur genau diese Formen ohne Passwort:
//   /usr/bin/systemctl start|stop|restart smarttasks
// `restart smarttasks.service` ist fuer sudo ein anderer Befehl -> Passwort-
// Prompt -> Deploy baut, startet aber nicht neu (Dienst lief 18.09.-02.10.
// mit altem Code). Dieser Test haelt die Deploy-Skripte an der Regel fest.
const ALLOWED = /^(\/usr\/bin\/)?systemctl (start|stop|restart) smarttasks$/;

function sudoSystemctlCommands(path: string, vars: Record<string, string> = {}): string[] {
	return readFileSync(path, 'utf8')
		.split('\n')
		.map((l) => l.trim())
		.filter((l) => !l.startsWith('#') && /\bsudo\b.*\bsystemctl\b/.test(l))
		.map((l) =>
			l
				.replace(/^.*?\bsudo\s+(-\S+\s+)*/, '')
				.replace(/'\$(\w+)'|"\$(\w+)"|\$(\w+)/g, (_m, a, b, c) => vars[a ?? b ?? c] ?? `$${a ?? b ?? c}`)
				.trim()
		);
}

describe('Deploy-Skripte vs. sudoers (#803)', () => {
	it('scripts/deploy-vps.sh startet den Dienst in exakt der erlaubten Form neu', () => {
		const cmds = sudoSystemctlCommands('scripts/deploy-vps.sh');
		expect(cmds.length).toBeGreaterThan(0);
		for (const c of cmds) expect(c).toMatch(ALLOWED);
	});

	it('deploy.sh startet den Dienst in exakt der erlaubten Form neu', () => {
		const src = readFileSync('deploy.sh', 'utf8');
		const service = src.match(/SERVICE="\$\{SERVICE:-([^}]+)\}"/)?.[1];
		expect(service).toBe('smarttasks');
		const cmds = sudoSystemctlCommands('deploy.sh', { SERVICE: service! });
		expect(cmds.length).toBeGreaterThan(0);
		for (const c of cmds) expect(c).toMatch(ALLOWED);
	});
});
