// "Today" for the operation is always Europe/Berlin-local, regardless of the
// server's or the browser's own timezone — dueDates are date-only strings
// (YYYY-MM-DD) and must be compared against the same local calendar day.
export function todayInBerlin(): string {
	// en-CA formats as YYYY-MM-DD, matching the dueDate storage format.
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}
