import type { RequestHandler } from './$types';
import { API_DOCS } from '$lib/server/api-docs';

export const GET: RequestHandler = () =>
	new Response(API_DOCS, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
