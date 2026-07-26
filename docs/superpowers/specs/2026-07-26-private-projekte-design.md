# Private Projekte (SmartTasks) — Design

**Datum:** 2026-07-26 · **Anlass:** Task #291 · **Status:** von Micha freigegeben (Brainstorming-Session 26.07.2026)

## Ziel

Private Tasks (Familie, Ferienhaus) in SmartTasks führen, sauber getrennt vom Team:
Holger, Ulf und künftige Kollegen sehen davon nichts — in keiner Liste, keiner Suche,
keinem Event. Claude (AI-User) behält vollen Zugriff und übernimmt das private
Task-Management mit. Harte Anforderung: die Performance der App darf nicht leiden.

## Entscheidungen (Brainstorming 26.07.2026)

1. **AI-Zugriff:** Claude sieht und verwaltet private Tasks vollständig.
   „Privat" heißt: unsichtbar für andere Menschen — nicht für Claude.
2. **Zuschnitt:** Privates lebt in **eigenen privaten Projekten** (z. B.
   „Ferienhaus Altglobsow"). Kein Flag pro Task.
3. **Generisch:** Jeder Human-User kann private Projekte besitzen — kein
   Micha-Sonderfall im Code.
4. **Transparenz:** Die UI sagt ehrlich „Privat — nur für dich und Claude
   sichtbar". Auch fremde private Projekte sind für Claude lesbar (Claude ist
   ein globaler API-User, kein Pro-User-Assistent).

Verworfene Alternativen: `privat`-Flag pro Task (Projektnamen würden leaken,
mehr Prüfstellen, keine private Board-Heimat) · separate private Instanz
(zwei Systeme statt einem System of Record).

## Datenmodell

- Neue Spalte `projects.owner_id` (integer, nullable, FK `users.id`, Default `NULL`).
- `NULL` = Team-Projekt (alle Bestandsprojekte unverändert), gesetzt = privat.
- Keine Änderung an `tasks` & Co.: Ein Task ist privat genau dann, wenn sein
  Projekt privat ist. Kommentare, Attachments, Status-Historie und verknüpfte
  Dokumente erben das über den Task bzw. das Projekt.
- Tasks ohne Projekt bleiben team-sichtbar (wie heute).
- Drizzle-Migration; kein Backfill nötig.

## Sichtbarkeitsregel (ein zentraler Baustein)

Neues Modul `src/lib/server/visibility.ts`:

- **Mensch:** Projekt sichtbar ⇔ `owner_id IS NULL OR owner_id = user.id`.
- **AI-User:** alles sichtbar.
- Export als SQL-Bedingung (für Listen-Queries) und als Prädikat
  `canSeeProject(user, project)` (für Einzel-Checks und SSE).

Service-Signaturen werden user-bewusst (`listTasks(db, user, filters)` statt
`listTasks(db, filters)`), damit der Compiler jede vergessene Stelle meldet.

## Durchsetzung (alle Austrittsstellen)

| Stelle | Maßnahme |
|---|---|
| `listTasks` (Board-UI, `GET /api/tasks`, Suche `q`, `today`, `open`) | zusätzliche WHERE-Bedingung: `project_id IS NULL` oder Projekt sichtbar. Suche damit automatisch dicht. |
| `getTask` + alles darüber (Detail, PATCH, Kommentare, Attachments, Status) | Sichtbarkeits-Check an der Engstelle → **404** bei fremd-privat |
| `GET /attachments/:id` | Check über den zugehörigen Task |
| `listProjects` / `getProject` / `PATCH /projects/:id` | gleiche Regel; fremd-privat → 404 |
| Dokumente (Liste, Suche, Detail) | Docs mit `projectId` eines fremden privaten Projekts unsichtbar; Docs ohne Projekt team-sichtbar |
| SSE `GET /api/events` | Stream kennt seinen User (`locals.user`); pro Event `canSeeProject`-Check vor dem Senden, fremd-private Events werden verworfen |
| `/api/docs` (API-Hilfe) | Verhalten dokumentieren (auch für künftige AI-Sessions) |

**404 statt 403** für fremde private Ressourcen — kein Existenz-Leak.

## Rechteregeln

- Ein Mensch kann `ownerId` nur auf **sich selbst** setzen (Create oder PATCH).
- Nur der Owner kann sein privates Projekt wieder öffentlich machen.
- AI darf private Projekte mit beliebigem Human-Owner anlegen (Claude legt
  z. B. „Ferienhaus Altglobsow" mit Owner Micha an).
- Einen **Owner-Wechsel** gibt es nicht (`ownerId` privat→privat auf anderen
  User ist ungültig) — wer das braucht, macht das Projekt öffentlich oder legt
  neu an. Hält die Regeln klein.
- **Assignee-Regel:** Tasks in privaten Projekten dürfen nur den Owner oder
  einen AI-User als Assignee haben (Validation bei Create/Update/Verschieben).
- Bestehendes Projekt privat setzen: nur erlaubt, wenn kein Task des Projekts
  einen fremden Assignee hat.
- Task-Verschiebung privat → öffentlich macht ihn sichtbar; das können ohnehin
  nur Owner oder AI auslösen (bewusste Aktion, keine Extra-Warnung in v1).

## UI (minimal)

- Projekt-Formular: Checkbox **„Privat — nur für dich und Claude sichtbar"**.
- Schloss-Symbol überall, wo der Projektname gerendert wird (Badge, Filter, Detail).
- Öffentlich-Machen mit Bestätigungsdialog („Alle Tasks werden fürs Team sichtbar").
- Sonst keine UI-Änderung — Listen/Board filtern serverseitig.

## Nicht in v1 (bewusst)

- **Private Locations:** private Projekte nutzen Location `None` oder eine
  bestehende — neue Location-Namen wären global sichtbar. Späterer Ausbau möglich.
- Pro-User-AI-Trennung (Claude sieht alle privaten Projekte; steht transparent
  in der UI).
- Teilen privater Projekte mit einzelnen Kollegen.

## Prozess-Notiz (Claude, außerhalb des Codes)

Private Tasks erscheinen in Claudes API-Pulls (Standup etc.). Claude behandelt
sie in allem, was Dritte sehen könnten (Team-Ausgaben, Docs, Kommentare
öffentlicher Tasks), wie „Nicht-öffentlich"-Inhalte: nie zitieren, nie verlinken.

## Performance

- Kein zusätzlicher JOIN im heißen Pfad: die Sichtbarkeits-Bedingung ist eine
  Subquery auf die Projekttabelle (~47 Zeilen, im SQLite-Cache) bzw. eine einmal
  pro Request gelesene ID-Liste.
- Board bleibt eine einzige Query. SSE-Check ist ein Mini-Lookup pro Event.
- Erwartung: keine messbare Verschlechterung; Stichprobe vor/nach Merge
  (Board-Ladezeit) genügt als Nachweis.

## Tests

- **Service (Vitest, Muster vorhanden):** Nicht-Owner sieht fremde private
  Projekte/Tasks/Docs nirgends (Liste, Detail → 404, Suche `q`, `today`);
  Owner und AI sehen alles; `ownerId`-Rechteregeln; Assignee-Validation;
  Privat-Setzen-Validation.
- **SSE:** Event zu fremd-privatem Task erreicht den Client nicht; eigener und
  AI-Client erhalten es.
- **e2e (Playwright):** Login als zweiter User → privates Projekt weder im
  Board noch per direkter URL noch in der Suche auffindbar; Owner-Login sieht es.
