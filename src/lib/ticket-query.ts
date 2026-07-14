// Tasks are referenced everywhere as #<id> (e.g. #186). A search query that is
// a bare number or the #-form is treated as a ticket reference IN ADDITION to
// the normal title/description text search — the digits might as well appear
// in a title.
//
// Semantics: a bare number ("186") hits exactly that task id; the #-form
// ("#18") hits by id prefix, so the match narrows while typing "#186".
export function parseTicketQuery(q: string): { digits: string; prefix: boolean } | null {
	const m = /^(#?)(\d+)$/.exec(q.trim());
	if (!m) return null;
	return { digits: m[2], prefix: m[1] === '#' };
}
