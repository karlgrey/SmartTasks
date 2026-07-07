import { rmSync } from 'node:fs';
import { createDb } from '../src/lib/server/db';
import { createUser } from '../src/lib/server/auth';
import { createProject } from '../src/lib/server/projects-service';

rmSync('.e2e', { recursive: true, force: true });
const db = createDb('.e2e/test.db');
createUser(db, { name: 'Micha', email: 'micha@e2e.test', type: 'human', password: 'e2e-password-1' });
createUser(db, { name: 'Claude', type: 'ai', color: '#8b5cf6' });
createProject(db, { name: 'Website' });
console.log('e2e db seeded');
