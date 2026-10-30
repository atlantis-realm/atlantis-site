<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { ongoingEvents, upcomingEvents } from '#lib/content/events.js';

	const groups = [
		{ label: 'upcoming_even.ts', events: upcomingEvents },
		{ label: 'ongoing_even.ts', events: ongoingEvents }
	];
</script>

<svelte:head>
	<title>Events · Atlantis</title>
</svelte:head>

<OceanPage title="Events">
	<section class="card hud">
		<p>Regular things we do together. All welcome unless noted otherwise.</p>
	</section>

	<!-- Each group's events are banded together, side by side. -->
	{#each groups as group (group.label)}
		<section>
			<h2 class="file-label">&lt;&lt; {group.label}</h2>
			<ul class="hud-band">
				{#each group.events as event (event.name)}
					<li>
						<h3>{event.name}</h3>
						<p>{event.description}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<section class="card hud">
		<h2 class="added">Streams</h2>
		<p class="added">Stream schedule and links go here — who streams, when, and where.</p>
	</section>
</OceanPage>
