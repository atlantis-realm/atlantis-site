<script lang="ts">
	import OceanPage from '#lib/components/layout/OceanPage.svelte';
	import { ongoingEvents, upcomingEvents } from '#lib/content/events.js';
</script>

<svelte:head>
	<title>Events · Atlantis</title>
</svelte:head>

<OceanPage title="Events">
	<section class="card">
		<p>Regular things we do together. All welcome unless noted otherwise.</p>
	</section>

	{#each [{ heading: 'Upcoming', events: upcomingEvents }, { heading: 'Ongoing', events: ongoingEvents }] as group (group.heading)}
		<section class="card">
			<h2>{group.heading}</h2>
			<ul class="events">
				{#each group.events as event (event.name)}
					<li class="event">
						<h3>{event.name}</h3>
						<p>{event.description}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<section class="card">
		<h2 class="added">Streams</h2>
		<p class="added">Stream schedule and links go here — who streams, when, and where.</p>
	</section>
</OceanPage>

<style>
	.events {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* Each event is a panel within its section's card. */
	.event {
		padding: 1rem 1.25rem;
		border: 1px solid rgb(255 255 255 / 0.1);
		border-radius: 8px;
		background: rgb(255 255 255 / 0.04);
	}

	.event h3 {
		margin: 0 0 0.4rem;
	}

	.event p {
		margin: 0;
	}
</style>
