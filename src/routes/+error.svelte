<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'} · Atlantis</title>
</svelte:head>

<main>
	<h1>{page.status === 404 ? 'Lost at sea' : 'Something went wrong'}</h1>
	<p>
		{#if page.status === 404}
			This page doesn't exist. Maybe it sank?
		{:else}
			{page.error?.message ?? 'An unexpected error occurred.'}
		{/if}
	</p>
	<p><a href="/">Back to home</a></p>
</main>
