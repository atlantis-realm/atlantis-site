<script lang="ts">
	import { ongoingEvents, upcomingEvents } from '#lib/content/events.js';
</script>

<svelte:head>
	<title>Events · Atlantis</title>
</svelte:head>

<main>
	<h1>Events</h1>
	<p>Regular things we do together. All welcome unless noted otherwise.</p>

	<h2>Upcoming</h2>
	<ul>
		{#each upcomingEvents as event (event.name)}
			<li><strong>{event.name}:</strong> {event.description}</li>
		{/each}
	</ul>

	<h2>Ongoing</h2>
	<ul>
		{#each ongoingEvents as event (event.name)}
			<li><strong>{event.name}:</strong> {event.description}</li>
		{/each}
	</ul>

	<h2 class="added">Streams</h2>
	<p class="added">Stream schedule and links go here — who streams, when, and where.</p>
</main>
