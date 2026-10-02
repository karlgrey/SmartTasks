<script lang="ts">
	import type { Rhythm, RhythmUnit } from '$lib/types';

	let {
		rhythm = $bindable(),
		onunitchange
	}: { rhythm: Rhythm; onunitchange?: (unit: RhythmUnit) => void } = $props();

	const UNITS: [RhythmUnit, string][] = [
		['day', 'täglich'],
		['week', 'wöchentlich'],
		['month', 'monatlich'],
		['quarter', 'quartalsweise'],
		['year', 'jährlich']
	];
	const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
	const unitNoun: Record<RhythmUnit, string> = {
		day: 'Tag(e)',
		week: 'Woche(n)',
		month: 'Monat(e)',
		quarter: 'Quartal(e)',
		year: 'Jahr(e)'
	};

	function changeUnit(unit: RhythmUnit) {
		const next: Rhythm = { unit, interval: rhythm.interval };
		if (unit === 'week') next.weekday = rhythm.weekday ?? 1;
		if (unit === 'month' || unit === 'quarter') next.dayOfMonth = rhythm.dayOfMonth ?? 1;
		rhythm = next;
		onunitchange?.(unit);
	}
</script>

<div class="rhythm">
	<label>
		<span>Rhythmus</span>
		<select aria-label="Einheit" value={rhythm.unit} onchange={(e) => changeUnit(e.currentTarget.value as RhythmUnit)}>
			{#each UNITS as [v, label] (v)}<option value={v}>{label}</option>{/each}
		</select>
	</label>
	<label>
		<span>alle … {unitNoun[rhythm.unit]}</span>
		<input
			type="number"
			min="1"
			aria-label="Intervall"
			value={rhythm.interval}
			oninput={(e) => (rhythm = { ...rhythm, interval: Number(e.currentTarget.value) || 1 })}
		/>
	</label>
	{#if rhythm.unit === 'week'}
		<label>
			<span>Wochentag</span>
			<select
				aria-label="Wochentag"
				value={rhythm.weekday ?? 1}
				onchange={(e) => (rhythm = { ...rhythm, weekday: Number(e.currentTarget.value) })}
			>
				{#each WEEKDAYS as w, i (i)}<option value={i + 1}>{w}</option>{/each}
			</select>
		</label>
	{:else if rhythm.unit === 'month' || rhythm.unit === 'quarter'}
		<label>
			<span>Tag im Monat</span>
			<input
				type="number"
				min="1"
				max="31"
				aria-label="Monatstag"
				value={rhythm.dayOfMonth ?? 1}
				oninput={(e) => (rhythm = { ...rhythm, dayOfMonth: Number(e.currentTarget.value) || 1 })}
			/>
		</label>
	{/if}
</div>

<style>
	.rhythm {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	label {
		display: grid;
		gap: 3px;
		font-size: 12px;
		color: var(--muted);
	}
	select,
	input {
		padding: 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		min-width: 0;
	}
	input[type='number'] {
		width: 90px;
	}
</style>
