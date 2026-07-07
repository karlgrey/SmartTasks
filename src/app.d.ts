import type { SafeUser } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			user: SafeUser | null;
		}
	}
}

export {};
