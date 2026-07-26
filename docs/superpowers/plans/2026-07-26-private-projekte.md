# Private Projekte Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projekte können einen Owner haben (`projects.owner_id`); private Projekte samt Tasks/Docs/Events sind nur für den Owner und AI-User sichtbar — dicht an allen Austrittsstellen, ohne messbare Performance-Kosten.

**Architecture:** Eine neue nullable Spalte `projects.owner_id` + ein zentrales Modul `visibility.ts`, dessen SQL-Bedingungen und Prädikate in alle Services (tasks, projects, documents, comments, attachments) und den SSE-Stream eingezogen werden. Service-Signaturen werden user-bewusst (`listTasks(db, user, filters)`), damit der Compiler jede vergessene Stelle meldet. Fremde private Ressourcen antworten mit 404 (kein Existenz-Leak).

**Tech Stack:** SvelteKit 2 / Svelte 5, better-sqlite3 + Drizzle ORM (Migrationen via drizzle-kit, werden beim Boot in `createDb` automatisch angewandt), Vitest (Service-Tests, Muster: `testDb()` + `seedUsers()` aus `src/lib/server/test-utils.ts`), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-26-private-projekte-design.md`

## Global Constraints

- **404 statt 403** für fremde private Ressourcen (Meldungstexte identisch zu „not found"-Bestand: `'task not found'`, `'project not found'`, `'document not found'`).
- **AI-User sehen alles** (`user.type === 'ai'`), dürfen aber private Projekte NICHT öffentlich machen (nur der Owner).
- **Assignee-Regel:** Tasks in privaten Projekten nur mit Assignee = Owner, AI-User oder `null`.
- **Kein Owner-Wechsel** privat→privat auf anderen User (400).
- **UI-Sprache ist Englisch** (Bestand: „All projects", „Add task…") — neue Copy englisch. Abweichung von der Spec (dort deutsch formuliert): bewusst, Konsistenz gewinnt.
- **Keine Projekt-Management-UI im Bestand** — die Checkbox aus der Spec entfällt ersatzlos; private Projekte werden per API angelegt (Claude). UI-Umfang: Schloss-Kennzeichnung. Abweichung beim Abschluss an Micha melden.
- Nach jedem Task: `npm run test:unit` grün; Tasks 6–8 zusätzlich `npm run check`.
- Commits auf einem Feature-Branch `feat/291-private-projekte`, Messages im Bestandsstil: `feat(#291): …`.

---

### Task 1: Schema + Migration `projects.owner_id` + DTO

**Files:**
- Modify: `src/lib/server/db/schema.ts:30-37` (projects-Tabelle)
- Modify: `src/lib/types.ts:26-33` (ProjectDTO)
- Create: `drizzle/0005_private_projects.sql` (generiert)
- Test: `src/lib/server/db/db.test.ts`

**Interfaces:**
- Produces: `projects.ownerId: number | null` (Drizzle-Spalte `owner_id`, FK users.id, Default NULL); `ProjectDTO.ownerId: number | null`. Alle späteren Tasks bauen darauf.

- [ ] **Step 1: Failing Test schreiben** — in `src/lib/server/db/db.test.ts` ergänzen:

```ts
it('projects have a nullable ownerId (private projects)', () => {
	const db = testDb();
	const { micha } = seedUsers(db);
	const pub = db.insert(projects).values({ name: 'Team' }).returning().get();
	expect(pub.ownerId).toBeNull();
	const priv = db.insert(projects).values({ name: 'Privat', ownerId: micha.id }).returning().get();
	expect(priv.ownerId).toBe(micha.id);
});
```

Imports oben ergänzen: `import { projects } from './schema';` sowie `import { testDb, seedUsers } from '../test-utils';` (an vorhandene Import-Struktur der Datei anpassen).

- [ ] **Step 2: Test läuft rot** — Run: `npx vitest run src/lib/server/db/db.test.ts` · Expected: FAIL (`ownerId` existiert nicht / Property-Fehler).

- [ ] **Step 3: Schema erweitern** — in `schema.ts` der projects-Tabelle hinzufügen (nach `wikiRef`):

```ts
	ownerId: integer('owner_id').references(() => users.id)
```

- [ ] **Step 4: Migration generieren** — Run: `npx drizzle-kit generate --name private_projects` · Expected: neue Datei `drizzle/0005_private_projects.sql` mit `ALTER TABLE \`projects\` ADD \`owner_id\` integer REFERENCES users(id);`. Datei ansehen und das bestätigen — drizzle-kit darf NICHTS anderes anfassen.

- [ ] **Step 5: DTO erweitern** — in `types.ts` `ProjectDTO` um `ownerId: number | null;` ergänzen.

- [ ] **Step 6: Tests grün** — Run: `npx vitest run src/lib/server/db/db.test.ts` · Expected: PASS (testDb() wendet die neue Migration automatisch an).

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/291-private-projekte
git add src/lib/server/db/schema.ts src/lib/types.ts drizzle/ src/lib/server/db/db.test.ts
git commit -m "feat(#291): projects.owner_id — Schema, Migration, DTO"
```

---

### Task 2: Zentrales Sichtbarkeits-Modul `visibility.ts`

**Files:**
- Create: `src/lib/server/visibility.ts`
- Test: `src/lib/server/visibility.test.ts`

**Interfaces:**
- Consumes: `projects.ownerId` (Task 1), `SafeUser` aus `./auth`, Schema-Tabellen.
- Produces (alle späteren Tasks nutzen exakt diese Namen):
  - `canSeeProject(user: SafeUser, project: { ownerId: number | null }): boolean`
  - `taskVisibilityCond(user: SafeUser): SQL | undefined` — WHERE-Fragment für Queries auf `tasks`
  - `projectVisibilityCond(user: SafeUser): SQL | undefined` — für Queries auf `projects`
  - `documentVisibilityCond(user: SafeUser): SQL | undefined` — für Queries auf `documents`
  - `assertTaskVisible(db: Db, user: SafeUser, task: { projectId: number | null }): void` — wirft `ServiceError(404, 'task not found')`
  - `assertProjectUsable(db: Db, user: SafeUser, projectId: number | null | undefined): (typeof projects.$inferSelect) | null` — lädt das Projekt; nicht vorhanden ODER fremd-privat → `ServiceError(400, 'invalid projectId: project not found')`; gibt die Projektzeile zurück (für Folge-Checks wie die Assignee-Regel); `null`/`undefined` → `null`.

**Wichtig:** `visibility.ts` importiert NUR `./db`, `./db/schema`, `./errors`, `./auth` (Typ) und `drizzle-orm` — keine Services (verhindert Import-Zyklen; deshalb liegt `assertTaskVisible` hier und nicht in tasks-service).

- [ ] **Step 1: Failing Tests schreiben** — `src/lib/server/visibility.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
	canSeeProject, taskVisibilityCond, projectVisibilityCond,
	assertTaskVisible, assertProjectUsable
} from './visibility';
import { testDb, seedUsers } from './test-utils';
import { projects, tasks } from './db/schema';

describe('canSeeProject', () => {
	const pub = { ownerId: null };
	it('humans see public and own private projects, not foreign ones', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		expect(canSeeProject(micha, pub)).toBe(true);
		expect(canSeeProject(micha, { ownerId: micha.id })).toBe(true);
		expect(canSeeProject(micha, { ownerId: micha.id + 99 })).toBe(false);
		expect(canSeeProject(claude, { ownerId: micha.id + 99 })).toBe(true); // AI sees all
	});
});

describe('visibility conds', () => {
	it('are undefined for AI users (no filtering)', () => {
		const db = testDb();
		const { claude } = seedUsers(db);
		expect(taskVisibilityCond(claude)).toBeUndefined();
		expect(projectVisibilityCond(claude)).toBeUndefined();
	});
});

describe('assertTaskVisible / assertProjectUsable', () => {
	it('404s a task in a foreign private project, passes own/public/projectless', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const foreign = db.insert(projects).values({ name: 'P', ownerId: claude.id + 77 }).returning().get();
		// note: owner id points at a user row we create for realism
		expect(() => assertTaskVisible(db, micha, { projectId: foreign.id })).toThrowError('task not found');
		expect(() => assertTaskVisible(db, micha, { projectId: null })).not.toThrow();
		expect(() => assertTaskVisible(db, claude, { projectId: foreign.id })).not.toThrow();
	});
	it('assertProjectUsable: 400 for missing or foreign-private, returns row otherwise', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const own = db.insert(projects).values({ name: 'Mine', ownerId: micha.id }).returning().get();
		const foreign = db.insert(projects).values({ name: 'F', ownerId: micha.id + 99 }).returning().get();
		expect(assertProjectUsable(db, micha, null)).toBeNull();
		expect(assertProjectUsable(db, micha, own.id)?.id).toBe(own.id);
		expect(() => assertProjectUsable(db, micha, foreign.id)).toThrowError('invalid projectId: project not found');
		expect(() => assertProjectUsable(db, micha, 999999)).toThrowError('invalid projectId: project not found');
		expect(assertProjectUsable(db, claude, foreign.id)?.id).toBe(foreign.id);
	});
});
```

(Hinweis für den Implementierer: wo `micha.id + 99` als Fremd-Owner dient, vorher per `createUser(db, { name: 'Other', type: 'human' })` einen echten User anlegen und dessen id verwenden — FK ist aktiv. `createUser` kommt aus `./auth`.)

- [ ] **Step 2: Rot laufen lassen** — Run: `npx vitest run src/lib/server/visibility.test.ts` · Expected: FAIL („Cannot find module './visibility'").

- [ ] **Step 3: Implementieren** — `src/lib/server/visibility.ts`:

```ts
import { eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db';
import { tasks, projects, documents } from './db/schema';
import { ServiceError } from './errors';
import type { SafeUser } from './auth';

export function canSeeProject(user: SafeUser, project: { ownerId: number | null }): boolean {
	return user.type === 'ai' || project.ownerId === null || project.ownerId === user.id;
}

// WHERE fragment for queries on the tasks table. undefined = no filtering (AI).
export function taskVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${tasks.projectId} IS NULL OR ${tasks.projectId} NOT IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.ownerId} IS NOT NULL AND ${projects.ownerId} != ${user.id}))`;
}

export function projectVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${projects.ownerId} IS NULL OR ${projects.ownerId} = ${user.id})`;
}

export function documentVisibilityCond(user: SafeUser): SQL | undefined {
	if (user.type === 'ai') return undefined;
	return sql`(${documents.projectId} IS NULL OR ${documents.projectId} NOT IN (SELECT ${projects.id} FROM ${projects} WHERE ${projects.ownerId} IS NOT NULL AND ${projects.ownerId} != ${user.id}))`;
}

// 404 (not 403): foreign private resources must not reveal their existence.
export function assertTaskVisible(
	db: Db,
	user: SafeUser,
	task: { projectId: number | null }
): void {
	if (user.type === 'ai' || task.projectId === null) return;
	const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
	if (project && !canSeeProject(user, project)) throw new ServiceError(404, 'task not found');
}

// For writes that reference a projectId: missing and foreign-private look identical (400).
export function assertProjectUsable(
	db: Db,
	user: SafeUser,
	projectId: number | null | undefined
): typeof projects.$inferSelect | null {
	if (projectId === null || projectId === undefined) return null;
	const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
	if (!project || !canSeeProject(user, project))
		throw new ServiceError(400, 'invalid projectId: project not found');
	return project;
}
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/server/visibility.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/visibility.ts src/lib/server/visibility.test.ts
git commit -m "feat(#291): zentrales Sichtbarkeits-Modul visibility.ts"
```

---

### Task 3: projects-service — Liste filtern, ownerId-Rechteregeln

**Files:**
- Modify: `src/lib/server/projects-service.ts`
- Test: `src/lib/server/projects-service.test.ts`

**Interfaces:**
- Consumes: `projectVisibilityCond`, `canSeeProject` (Task 2).
- Produces (Routen in Task 6 rufen exakt so auf):
  - `listProjects(db: Db, user: SafeUser): ProjectDTO[]`
  - `createProject(db: Db, user: SafeUser, input: { name: string; color?: string; locationId?: number | null; wikiRef?: string | null; ownerId?: number | null }): ProjectDTO`
  - `updateProject(db: Db, user: SafeUser, id: number, patch: { …bisherige Felder…; ownerId?: number | null }): ProjectDTO`

**Regeln (aus der Spec):**
1. Mensch setzt `ownerId` nur auf sich selbst (sonst 403 `'you can only own private projects yourself'`).
2. AI darf `ownerId` auf jeden Human setzen; Ziel-User muss existieren und `type='human'` sein (400 `'invalid ownerId: must be an existing human user'`).
3. Öffentlich machen (`ownerId: null` auf privatem Projekt): nur der Owner selbst (auch AI → 403 `'only the owner can make a private project public'`).
4. Kein Owner-Wechsel privat→privat auf anderen User (400 `'owner cannot be transferred'`).
5. Privat-Setzen eines Projekts mit Tasks: kein Task darf einen Human-Assignee ≠ neuer Owner haben (400 `'project has tasks assigned to other users'`). (AI-Assignees sind ok.)
6. `updateProject` auf fremd-privates Projekt → 404 `'project not found'`.

- [ ] **Step 1: Failing Tests** — in `projects-service.test.ts` ergänzen (Bestandstests auf neue Signaturen anpassen — `listProjects(db)` → `listProjects(db, micha)` etc.):

```ts
describe('private projects (ownerId)', () => {
	it('listProjects hides foreign private projects from humans, shows all to AI and owner', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		createProject(db, micha, { name: 'Team' });
		createProject(db, micha, { name: 'Privat Micha', ownerId: micha.id });
		const names = (u: SafeUser) => listProjects(db, u).map((p) => p.name);
		expect(names(micha)).toEqual(['Privat Micha', 'Team']);
		expect(names(ulf)).toEqual(['Team']);
		expect(names(claude)).toEqual(['Privat Micha', 'Team']);
	});

	it('humans can only own private projects themselves; AI can assign any human owner', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		expect(() => createProject(db, micha, { name: 'X', ownerId: ulf.id }))
			.toThrowError('you can only own private projects yourself');
		expect(createProject(db, claude, { name: 'Y', ownerId: micha.id }).ownerId).toBe(micha.id);
		expect(() => createProject(db, claude, { name: 'Z', ownerId: claude.id }))
			.toThrowError('invalid ownerId: must be an existing human user'); // AI cannot own
		expect(() => createProject(db, claude, { name: 'Z', ownerId: 999999 }))
			.toThrowError('invalid ownerId: must be an existing human user');
	});

	it('only the owner can make a private project public; no owner transfer', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P', ownerId: micha.id });
		expect(() => updateProject(db, claude, p.id, { ownerId: null }))
			.toThrowError('only the owner can make a private project public');
		expect(() => updateProject(db, micha, p.id, { ownerId: ulf.id }))
			.toThrowError('owner cannot be transferred');
		expect(updateProject(db, micha, p.id, { ownerId: null }).ownerId).toBeNull();
	});

	it('updateProject 404s foreign private projects (no existence leak)', () => {
		const db = testDb();
		const { micha } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P', ownerId: micha.id });
		expect(() => updateProject(db, ulf, p.id, { name: 'hijack' }))
			.toThrowError('project not found');
	});

	it('converting a project to private requires no foreign human assignees', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const p = createProject(db, micha, { name: 'P' });
		createTask(db, micha, { title: 'ulfs task', projectId: p.id, assigneeId: ulf.id });
		expect(() => updateProject(db, micha, p.id, { ownerId: micha.id }))
			.toThrowError('project has tasks assigned to other users');
	});
});
```

Nötige Imports im Testfile: `createUser` aus `./auth`, `createTask` aus `./tasks-service`, `type SafeUser` aus `./auth`.

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/server/projects-service.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implementieren** — `projects-service.ts`:

```ts
import { eq, and, asc, isNotNull, ne } from 'drizzle-orm';
import { projects, users, locations, tasks } from './db/schema';
import { projectVisibilityCond, canSeeProject } from './visibility';

export function listProjects(db: Db, user: SafeUser): ProjectDTO[] {
	return db.select().from(projects)
		.where(projectVisibilityCond(user))
		.orderBy(asc(projects.name)).all();
}

function assertOwnerId(db: Db, user: SafeUser, ownerId: number | null | undefined): void {
	if (ownerId === null || ownerId === undefined) return;
	if (typeof ownerId !== 'number') throw new ServiceError(400, 'invalid ownerId: must be a number');
	const owner = db.select().from(users).where(eq(users.id, ownerId)).get();
	if (!owner || owner.type !== 'human')
		throw new ServiceError(400, 'invalid ownerId: must be an existing human user');
	if (user.type === 'human' && ownerId !== user.id)
		throw new ServiceError(403, 'you can only own private projects yourself');
}

// no task may have a human assignee other than the new owner
function assertNoForeignAssignees(db: Db, projectId: number, ownerId: number): void {
	const foreign = db.select({ id: tasks.id }).from(tasks)
		.innerJoin(users, eq(users.id, tasks.assigneeId))
		.where(and(eq(tasks.projectId, projectId), eq(users.type, 'human'), ne(users.id, ownerId)))
		.get();
	if (foreign) throw new ServiceError(400, 'project has tasks assigned to other users');
}
```

`createProject(db, user, input)`: Signatur um `user` + `input.ownerId` erweitern; nach den bestehenden Asserts `assertOwnerId(db, user, input.ownerId)` aufrufen und `ownerId: input.ownerId ?? null` in `values` aufnehmen.

`updateProject(db, user, id, patch)`: nach dem Laden von `existing`:

```ts
	if (!canSeeProject(user, existing)) throw new ServiceError(404, 'project not found');
	if ('ownerId' in patch && patch.ownerId !== existing.ownerId) {
		if (patch.ownerId === null) {
			if (existing.ownerId !== null && user.id !== existing.ownerId)
				throw new ServiceError(403, 'only the owner can make a private project public');
		} else {
			if (existing.ownerId !== null)
				throw new ServiceError(400, 'owner cannot be transferred');
			assertOwnerId(db, user, patch.ownerId);
			assertNoForeignAssignees(db, id, patch.ownerId);
		}
	}
	if ('ownerId' in patch) next.ownerId = patch.ownerId ?? null;
```

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/server/projects-service.test.ts` · Expected: PASS. (Andere Testdateien dürfen jetzt wegen Signaturen brechen — die kommen in ihren eigenen Tasks dran; nur bei *Kompilierfehlern* in fremden Tests deren Aufrufe mechanisch auf die neue Signatur heben.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/projects-service.ts src/lib/server/projects-service.test.ts
git commit -m "feat(#291): projects-service — Sichtbarkeit + ownerId-Rechteregeln"
```

---

### Task 4: tasks-service — Queries filtern, Schreibpfade absichern, Assignee-Regel

**Files:**
- Modify: `src/lib/server/tasks-service.ts`
- Test: `src/lib/server/tasks-service.test.ts`

**Interfaces:**
- Consumes: `taskVisibilityCond`, `assertTaskVisible`, `assertProjectUsable`, `canSeeProject` (Task 2).
- Produces (Routen in Task 6):
  - `listTasks(db: Db, user: SafeUser, filters?: TaskFilters): TaskDTO[]`
  - `getTask(db: Db, user: SafeUser, id: number): …` (Rückgabetyp unverändert)
  - `createTask` / `updateTask`: Signaturen unverändert (haben `user` schon), neue Checks innen
  - `deleteTask(db, user, id, uploadsPath?)`: unverändert + Check

**Regeln:**
- `listTasks`: `taskVisibilityCond(user)` als zusätzliche Bedingung → Board, Suche `q`, `today`, `open` sind automatisch dicht.
- `getTask`/`updateTask`/`deleteTask`: nach dem Laden `assertTaskVisible(db, user, existing)` → 404.
- `createTask`/`updateTask` mit `projectId`: `assertProjectUsable` (fremd-privat wirkt wie nicht vorhanden, 400).
- Assignee-Regel: Effektives Projekt privat → effektiver Assignee muss `null`, Owner oder AI-User sein, sonst 400 `'tasks in a private project can only be assigned to the owner or an AI user'`. Gilt bei Create und bei Update (auch beim Verschieben in ein privates Projekt).

- [ ] **Step 1: Failing Tests** — in `tasks-service.test.ts` ergänzen (+ Bestand auf neue Signaturen heben: `listTasks(db, {…})` → `listTasks(db, micha, {…})`, `getTask(db, id)` → `getTask(db, micha, id)`):

```ts
describe('private projects — task visibility', () => {
	function privateSetup() {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const priv = createProject(db, micha, { name: 'Privat', ownerId: micha.id });
		const t = createTask(db, micha, { title: 'geheim', projectId: priv.id });
		return { db, micha, claude, ulf, priv, t };
	}

	it('hides tasks of foreign private projects from list, search and today', () => {
		const { db, micha, ulf, claude } = privateSetup();
		expect(listTasks(db, micha).map((t) => t.title)).toContain('geheim');
		expect(listTasks(db, ulf)).toHaveLength(0);
		expect(listTasks(db, ulf, { q: 'geheim' })).toHaveLength(0);
		expect(listTasks(db, claude).map((t) => t.title)).toContain('geheim');
	});

	it('getTask/updateTask/deleteTask answer 404 for non-owners', () => {
		const { db, ulf, t } = privateSetup();
		expect(() => getTask(db, ulf, t.id)).toThrowError('task not found');
		expect(() => updateTask(db, ulf, t.id, { title: 'x' })).toThrowError('task not found');
		expect(() => deleteTask(db, ulf, t.id)).toThrowError('task not found');
	});

	it('creating into an invisible private project fails like a missing project', () => {
		const { db, ulf, priv } = privateSetup();
		expect(() => createTask(db, ulf, { title: 'x', projectId: priv.id }))
			.toThrowError('invalid projectId: project not found');
	});

	it('enforces the assignee rule in private projects (create, update, move-in)', () => {
		const { db, micha, claude, ulf, priv } = privateSetup();
		const err = 'tasks in a private project can only be assigned to the owner or an AI user';
		expect(() => createTask(db, micha, { title: 'x', projectId: priv.id, assigneeId: ulf.id }))
			.toThrowError(err);
		expect(createTask(db, micha, { title: 'ok1', projectId: priv.id, assigneeId: micha.id }).id).toBeGreaterThan(0);
		expect(createTask(db, micha, { title: 'ok2', projectId: priv.id, assigneeId: claude.id }).id).toBeGreaterThan(0);
		const pub = createTask(db, micha, { title: 'wandert', assigneeId: ulf.id });
		expect(() => updateTask(db, micha, pub.id, { projectId: priv.id })).toThrowError(err);
	});
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/server/tasks-service.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implementieren** — `tasks-service.ts`:

`listTasks(db, user, filters = {})`: Signatur erweitern; nach dem Aufbau von `conds`:

```ts
	const vis = taskVisibilityCond(user);
	if (vis) conds.push(vis);
```

Neue Helper (nahe `validateTypes`):

```ts
function assertAssigneeAllowed(
	db: Db,
	project: { ownerId: number | null } | null,
	assigneeId: number | null | undefined
): void {
	if (!project || project.ownerId === null) return;
	if (assigneeId === null || assigneeId === undefined || assigneeId === project.ownerId) return;
	const assignee = db.select().from(users).where(eq(users.id, assigneeId)).get();
	if (!assignee || assignee.type !== 'ai')
		throw new ServiceError(400, 'tasks in a private project can only be assigned to the owner or an AI user');
}
```

`createTask`: vor der Transaktion:

```ts
	const project = assertProjectUsable(db, user, input.projectId);
	assertAssigneeAllowed(db, project, input.assigneeId);
```

`getTask(db, user, id)`: Signatur erweitern; nach `if (!task) throw …`: `assertTaskVisible(db, user, task);`

`updateTask`: nach dem Laden von `existing`:

```ts
	assertTaskVisible(db, user, existing);
	const effectiveProjectId = 'projectId' in patch ? (patch.projectId ?? null) : existing.projectId;
	const project = assertProjectUsable(db, user, effectiveProjectId);
	const effectiveAssignee = 'assigneeId' in patch ? (patch.assigneeId ?? null) : existing.assigneeId;
	assertAssigneeAllowed(db, project, effectiveAssignee);
```

`deleteTask`: nach dem Laden von `existing`: `assertTaskVisible(db, user, existing);`

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/server/tasks-service.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tasks-service.ts src/lib/server/tasks-service.test.ts
git commit -m "feat(#291): tasks-service — Sichtbarkeitsfilter, 404-Pfade, Assignee-Regel"
```

---

### Task 5: comments-, attachments-, documents-service dichtmachen

**Files:**
- Modify: `src/lib/server/comments-service.ts` (addComment)
- Modify: `src/lib/server/attachments-service.ts` (addAttachment, getAttachment, deleteAttachment)
- Modify: `src/lib/server/documents-service.ts` (listDocuments, getDocument, createDocument, updateDocument, deleteDocument, linkTask, unlinkTask, taskRefs)
- Test: die drei zugehörigen `.test.ts`-Dateien

**Interfaces:**
- Consumes: `assertTaskVisible`, `assertProjectUsable`, `documentVisibilityCond`, `taskVisibilityCond`, `canSeeProject` (Task 2).
- Produces (Routen in Task 6):
  - `addComment(db, user, taskId, body)`: Signatur unverändert, wirft jetzt 404 bei fremd-privatem Task
  - `getAttachment(db: Db, user: SafeUser, id: number): AttachmentDTO` (**Signatur neu**: `user`-Parameter)
  - `deleteAttachment(db, user, id, dir)`: unverändert + Check
  - `listDocuments(db: Db, user: SafeUser, filters?: DocFilters): DocumentDTO[]` (**neu**: `user`)
  - `getDocument(db: Db, user: SafeUser, id: number)` (**neu**: `user`)
  - `createDocument` / `updateDocument` / `deleteDocument` / `linkTask` / `unlinkTask`: Signaturen unverändert, neue Checks innen

**Checks im Einzelnen:**
- `addComment`: nach dem Laden des Tasks `assertTaskVisible(db, user, existing)`.
- `addAttachment` (lädt den Task bereits bzw. prüft Existenz): `assertTaskVisible` ergänzen.
- `getAttachment(db, user, id)`: Attachment laden, dann zugehörigen Task laden und `assertTaskVisible`; Fehlertext bei Unsichtbarkeit: `'attachment not found'` (404).
- `deleteAttachment`: gleicher Check vor dem Löschen.
- `listDocuments(db, user, filters)`: `documentVisibilityCond(user)` in `conds` aufnehmen.
- `getDocument(db, user, id)`: Doc laden; wenn `projectId` gesetzt → Projekt laden, `!canSeeProject` → 404 `'document not found'`. **Zusätzlich** in `taskRefs` die Bedingung `taskVisibilityCond(user)` in die WHERE-Klausel aufnehmen (ein team-sichtbares Doc kann mit einem privaten Task verlinkt sein — dessen Titel darf nicht leaken; `taskRefs(db, user, documentId)`).
- `createDocument` / `updateDocument`: `projectId`-Eingaben durch `assertProjectUsable` ersetzen bzw. ergänzen; `updateDocument`/`deleteDocument` prüfen zuerst Sichtbarkeit des bestehenden Docs (404).
- `linkTask` / `unlinkTask`: `assertDocExists` → zusätzlich Doc-Sichtbarkeit (404), `assertTaskExists` → zusätzlich `assertTaskVisible`.

- [ ] **Step 1: Failing Tests** — je Datei einen `describe('private projects', …)`-Block. Kernfälle (Muster wie in Task 4, `privateSetup()`-Helper je Datei duplizieren — Tests sollen unabhängig lesbar sein):

```ts
// comments-service.test.ts
it('rejects comments on tasks in foreign private projects with 404', () => {
	const { db, ulf, t } = privateSetup();
	expect(() => addComment(db, ulf, t.id, 'hi')).toThrowError('task not found');
});

// attachments-service.test.ts
it('hides attachments of foreign private tasks (get/delete → 404)', () => {
	const { db, micha, ulf, t } = privateSetup();
	const dir = mkdtempSync(join(tmpdir(), 'att-'));
	const a = addAttachment(db, micha, t.id, { filename: 'x.png', mime: 'image/png', data: Buffer.from('x') }, dir);
	expect(() => getAttachment(db, ulf, a.id)).toThrowError('attachment not found');
	expect(() => deleteAttachment(db, ulf, a.id, dir)).toThrowError('attachment not found');
	expect(getAttachment(db, micha, a.id).id).toBe(a.id);
	rmSync(dir, { recursive: true, force: true });
});
// (addAttachment-Aufrufform an die tatsächliche Signatur in attachments-service.ts:55 anpassen —
//  vor dem Schreiben des Tests dort nachsehen.)

// documents-service.test.ts
it('hides docs of foreign private projects in list, search and detail', () => {
	const { db, micha, ulf, priv } = privateSetup();
	const doc = createDocument(db, micha, { title: 'Geheimplan', projectId: priv.id });
	expect(listDocuments(db, ulf).map((d) => d.id)).not.toContain(doc.id);
	expect(listDocuments(db, ulf, { q: 'Geheim' })).toHaveLength(0);
	expect(() => getDocument(db, ulf, doc.id)).toThrowError('document not found');
	expect(getDocument(db, micha, doc.id).id).toBe(doc.id);
});

it('does not leak private task titles via taskRefs of a public document', () => {
	const { db, micha, ulf, t } = privateSetup();
	const doc = createDocument(db, micha, { title: 'Öffentlich' });
	linkTask(db, micha, doc.id, t.id);
	expect(getDocument(db, ulf, doc.id).tasks).toHaveLength(0);
	expect(getDocument(db, micha, doc.id).tasks.map((r) => r.id)).toContain(t.id);
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/server/comments-service.test.ts src/lib/server/attachments-service.test.ts src/lib/server/documents-service.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implementieren** — Checks wie oben beschrieben einbauen; `taskRefs` bekommt den `user`-Parameter und `and(eq(documentTasks.documentId, documentId), taskVisibilityCond(user) ?? sql`1=1`)` — oder sauberer: conds-Array mit optionalem Push, Muster wie in `listTasks`.

- [ ] **Step 4: Grün** — Run: die drei Testdateien erneut · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/comments-service.ts src/lib/server/attachments-service.ts src/lib/server/documents-service.ts src/lib/server/*.test.ts
git commit -m "feat(#291): comments/attachments/documents — Sichtbarkeit dicht"
```

---

### Task 6: Alle Aufrufstellen (Routen + Layout-Loads) auf user-bewusste Signaturen heben

**Files:**
- Modify: `src/routes/(app)/+layout.server.ts`
- Modify: `src/routes/docs/+layout.server.ts`, `src/routes/docs/+page.server.ts`
- Modify: `src/routes/api/tasks/+server.ts`, `src/routes/api/tasks/[id]/+server.ts`
- Modify: `src/routes/api/projects/+server.ts`, `src/routes/api/projects/[id]/+server.ts`
- Modify: `src/routes/api/documents/+server.ts`, `src/routes/api/documents/[id]/+server.ts`
- Modify: `src/routes/api/attachments/[id]/+server.ts`
- (Comments-/Attachments-/Documents-Link-Routen unter `src/routes/api/tasks/[id]/…` und `src/routes/api/documents/[id]/tasks/…` prüfen — Services haben die Checks, Signaturen ggf. anpassen)

**Interfaces:**
- Consumes: alle neuen Signaturen aus Tasks 3–5. `requireUser(locals)` (Bestand, `api-utils.ts`) liefert den `SafeUser`.

**Muster** (Beispiel `api/tasks/+server.ts`):

```ts
export const GET: RequestHandler = ({ locals, url }) =>
	run(() => {
		const user = requireUser(locals);
		return json(listTasks(db, user, parseTaskFilters(url.searchParams)));
	});
```

Und `(app)/+layout.server.ts`:

```ts
	return {
		user: locals.user,
		tasks: listTasks(db, locals.user, { open: true }),
		done: listTasks(db, locals.user, { status: 'Done', limit: 50 }),
		users: listUsers(db),
		projects: listProjects(db, locals.user),
		locations: listLocations(db)
	};
```

- [ ] **Step 1: Compiler als Test nutzen** — Run: `npm run check` · Expected: Fehlerliste = exakt die noch nicht angepassten Aufrufstellen.
- [ ] **Step 2: Alle gemeldeten Stellen anpassen** (Muster oben; `getAttachment(db, user, …)`, `listDocuments(db, user, …)`, `getDocument(db, user, …)`, `createProject(db, user, …)`, `updateProject(db, user, …)` nicht vergessen).
- [ ] **Step 3: Grün** — Run: `npm run check && npm run test:unit` · Expected: beide PASS, 0 Fehler.
- [ ] **Step 4: Commit**

```bash
git add src/routes src/lib
git commit -m "feat(#291): Routen + Layout-Loads auf user-bewusste Services umgestellt"
```

---

### Task 7: SSE-Stream filtern

**Files:**
- Modify: `src/lib/server/visibility.ts` (canSeeEvent)
- Modify: `src/routes/api/events/+server.ts:29`
- Test: `src/lib/server/visibility.test.ts` (erweitern)

**Interfaces:**
- Consumes: `TaskEvent` aus `./events`, `canSeeProject`.
- Produces: `canSeeEvent(db: Db, user: SafeUser, e: { task: { projectId: number | null } }): boolean`

- [ ] **Step 1: Failing Test** — in `visibility.test.ts`:

```ts
describe('canSeeEvent', () => {
	it('drops events of foreign private projects for humans, passes for owner and AI', () => {
		const db = testDb();
		const { micha, claude } = seedUsers(db);
		const ulf = createUser(db, { name: 'Ulf', type: 'human' });
		const priv = db.insert(projects).values({ name: 'P', ownerId: micha.id }).returning().get();
		const e = { task: { projectId: priv.id } };
		expect(canSeeEvent(db, micha, e)).toBe(true);
		expect(canSeeEvent(db, ulf, e)).toBe(false);
		expect(canSeeEvent(db, claude, e)).toBe(true);
		expect(canSeeEvent(db, ulf, { task: { projectId: null } })).toBe(true);
	});
});
```

- [ ] **Step 2: Rot** — Run: `npx vitest run src/lib/server/visibility.test.ts` · Expected: FAIL.
- [ ] **Step 3: Implementieren** — in `visibility.ts`:

```ts
export function canSeeEvent(
	db: Db,
	user: SafeUser,
	e: { task: { projectId: number | null } }
): boolean {
	if (user.type === 'ai' || e.task.projectId === null) return true;
	const project = db.select().from(projects).where(eq(projects.id, e.task.projectId)).get();
	return !project || canSeeProject(user, project);
}
```

In `api/events/+server.ts`: `const user = requireUser(locals);` (statt nur `requireUser(locals);`) und Zeile 29 ersetzen durch:

```ts
			unsubscribe = subscribe((e) => {
				if (!canSeeEvent(db, user, e)) return;
				send(`data: ${JSON.stringify(e)}\n\n`);
			});
```

(Imports: `db` aus `$lib/server/db`, `canSeeEvent` aus `$lib/server/visibility`.)

- [ ] **Step 4: Grün** — Run: `npx vitest run src/lib/server/visibility.test.ts && npm run check` · Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/lib/server/visibility.ts src/lib/server/visibility.test.ts src/routes/api/events/+server.ts
git commit -m "feat(#291): SSE-Events pro Verbindung nach Sichtbarkeit gefiltert"
```

---

### Task 8: UI — Schloss-Kennzeichnung privater Projekte

**Files:**
- Modify: `src/lib/components/FilterBar.svelte:47` (Projekt-Dropdown)
- Modify: `src/lib/components/TaskCard.svelte:30` (Projekt-Badge)
- Modify: `src/routes/(app)/task/[id]/+page.svelte` (Projekt-Select im Detail — Stelle per `grep -n "projects" …` finden, gleiches Muster)

**Interfaces:**
- Consumes: `ProjectDTO.ownerId` (Task 1). Serverseitig sind fremde private Projekte bereits herausgefiltert (Task 6) — die UI sieht nur eigene.

- [ ] **Step 1: FilterBar** — Option-Text erweitern:

```svelte
<option value={p.id} selected={current.get('project') === String(p.id)}>{p.ownerId != null ? `🔒 ${p.name}` : p.name}</option>
```

- [ ] **Step 2: TaskCard** — Badge erweitern:

```svelte
{#if project}<span class="badge" style="background:{project.color}22;color:{project.color}">{project.ownerId != null ? '🔒 ' : ''}{project.name}</span>{/if}
```

- [ ] **Step 3: Task-Detail** — Projekt-Select-Optionen mit demselben `🔒 `-Präfix versehen.
- [ ] **Step 4: Verifizieren** — Run: `npm run check` · Expected: PASS. Manuelle Sichtprüfung: `npm run dev`, privates Projekt per API anlegen (curl mit Bearer-Key aus lokaler Seed), Board zeigt 🔒 in Dropdown und Badge.
- [ ] **Step 5: Commit**

```bash
git add src/lib/components src/routes
git commit -m "feat(#291): UI — Schloss-Kennzeichnung privater Projekte"
```

---

### Task 9: API-Doku (`/api/docs`) aktualisieren

**Files:**
- Modify: `src/lib/server/api-docs.ts` (Zeile 27: Projects-Felder; neuer Abschnitt nach „## Projects, locations & TheBrain2")

**Interfaces:** — (reiner Text)

- [ ] **Step 1: Projects-Zeile erweitern** — `{name, color?, archived?, locationId?, wikiRef?, ownerId?}`.
- [ ] **Step 2: Neuen Abschnitt einfügen:**

```markdown
## Private projects
- A project with `ownerId` set is private: visible only to its (human) owner and to AI users.
  Tasks, comments, attachments, linked documents and SSE events inherit this via the project.
- Foreign private resources answer **404** (as if they did not exist), never 403.
- Humans may only set `ownerId` to themselves; AI users may set any human owner.
  Only the owner can set `ownerId` back to null (make it public). Owners cannot be transferred.
- Tasks in a private project can only be assigned to the owner or an AI user.
- Note for AI users: you can read every private project. Treat other users' private
  tasks as confidential — never quote or reference them in team-visible output.
```

- [ ] **Step 3: Verifizieren** — Run: `npm run test:unit && npm run check` · Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add src/lib/server/api-docs.ts
git commit -m "docs(#291): /api/docs — private projects dokumentiert"
```

---

### Task 10: e2e — Dichtigkeit aus Nutzersicht

**Files:**
- Modify: `e2e/seed.ts` (zweiten Human-User „Ulf" ergänzen, Muster des bestehenden Seeds übernehmen: `ulf@e2e.test` / `e2e-password-2`)
- Create: `e2e/private-projects.spec.ts`

**Interfaces:**
- Consumes: Login-Flow wie in `e2e/board.spec.ts`; API via Playwright `request` mit Session-Cookie.

- [ ] **Step 1: Seed erweitern** — in `e2e/seed.ts` analog zum bestehenden Micha-User einen zweiten Human anlegen.
- [ ] **Step 2: Spec schreiben** — `e2e/private-projects.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('private project is invisible to other users', async ({ page, request }) => {
	// Micha logs in via API and creates a private project + task
	const login = await request.post('/api/auth/login', {
		data: { email: 'micha@e2e.test', password: 'e2e-password-1' }
	});
	expect(login.ok()).toBeTruthy();
	const me = await (await request.get('/api/users')).json();
	const michaId = me.find((u: { name: string }) => u.name === 'Micha').id;
	const project = await (
		await request.post('/api/projects', { data: { name: 'Privat E2E', ownerId: michaId } })
	).json();
	const task = await (
		await request.post('/api/tasks', { data: { title: 'Geheimer Task', projectId: project.id, status: 'To Do' } })
	).json();

	// Ulf logs in via UI: neither project nor task anywhere
	await page.goto('/login');
	await page.getByPlaceholder('Email').fill('ulf@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-2');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('[data-column="To Do"]')).toBeVisible();
	await expect(page.locator('.card', { hasText: 'Geheimer Task' })).toHaveCount(0);
	await expect(page.locator('option', { hasText: 'Privat E2E' })).toHaveCount(0);
	const detail = await page.request.get(`/api/tasks/${task.id}`);
	expect(detail.status()).toBe(404);
});

test('owner sees the private project with a lock marker', async ({ page }) => {
	await page.goto('/login');
	await page.getByPlaceholder('Email').fill('micha@e2e.test');
	await page.getByPlaceholder('Password').fill('e2e-password-1');
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.locator('.card', { hasText: 'Geheimer Task' })).toBeVisible();
	await expect(page.locator('option', { hasText: '🔒 Privat E2E' })).toHaveCount(1);
});
```

(Playwright-`request` teilt den Cookie-Jar nicht mit `page` — der API-Login oben nutzt den separaten `request`-Context, der UI-Login läuft über `page`. Genau das wollen wir: zwei Identitäten. Falls der zweite Test vom ersten abhängt — Playwright läuft Tests einer Datei seriell im selben Worker, Projekt bleibt in der DB bestehen; sonst Setup im zweiten Test wiederholen.)

- [ ] **Step 3: Laufen lassen** — Run: `npm run test:e2e -- private-projects.spec.ts` · Expected: PASS (e2e-Setup ggf. gemäß `playwright.config.ts` — webServer startet automatisch).
- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(#291): e2e — private Projekte für Dritte unsichtbar, Owner sieht Schloss"
```

---

### Task 11: Abschluss — Gesamtlauf, Performance-Stichprobe, Merge-Vorbereitung

**Files:** — (keine neuen)

- [ ] **Step 1: Gesamtlauf** — Run: `npm run check && npm run test:unit && npm run test:e2e` · Expected: alles PASS.
- [ ] **Step 2: Performance-Stichprobe** — `npm run dev`; Board-Ladezeit (Netzwerk-Tab, `/`-Dokument) vor/nach dem Feature vergleichen (main vs. Branch, je 3 Ladevorgänge). Erwartung laut Spec: kein messbarer Unterschied (Subquery auf ~47-Zeilen-Tabelle). Ergebniszahlen im PR/Merge-Commit notieren.
- [ ] **Step 3: Merge auf main** — per Bestandsmuster (`merge: …`-Commit, vgl. `git log`), NICHT deployen ohne Michas Go.
- [ ] **Step 4: SmartTasks pflegen** — Kommentar an Task #291 (Statuszeile → Bullets → nächster Schritt; inkl. der zwei Spec-Abweichungen: keine Projekt-UI ⇒ keine Checkbox, Copy englisch) und Status → Review. Erledigt die Hauptsession, nicht der Subagent.

---

## Self-Review (gegen die Spec geprüft)

- **Spec-Abdeckung:** Datenmodell → Task 1 · Sichtbarkeitsregel → Task 2 · Durchsetzungstabelle (listTasks/getTask/Attachments/Projects/Documents/SSE/api-docs) → Tasks 3–7, 9 · Rechteregeln inkl. Owner-Wechsel-Verbot und Assignee-Regel → Tasks 3–4 · UI → Task 8 (reduziert: keine Projekt-UI im Bestand, als Abweichung dokumentiert) · Tests → in jedem Task + Task 10 · Performance-Nachweis → Task 11.
- **Bewusst NICHT abgedeckt (Spec „Nicht in v1"):** private Locations, Pro-User-AI-Trennung, Teilen mit einzelnen Kollegen. Der Bestätigungsdialog beim Öffentlich-Machen entfällt mit der Projekt-UI (API-only); die Prozess-Notiz für Claude lebt in `/api/docs` (Task 9) statt im App-Code.
- **Typ-Konsistenz:** Signaturen in „Interfaces"-Blöcken der Tasks 2–7 gegeneinander abgeglichen (`listTasks(db, user, filters)`, `getTask(db, user, id)`, `getAttachment(db, user, id)`, `listDocuments(db, user, filters)`, `getDocument(db, user, id)`, `canSeeEvent(db, user, e)`).
