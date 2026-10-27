export type ProjectLink = {
	href: string;
	label: string;
	/** Optional icon shown before the label (see ProjectIcon). */
	icon?: 'spotify';
};

export type Project = {
	title: string;
	description: string;
	participants: string[];
	/** Write-ups about the project (blog posts, articles). */
	writeups?: ProjectLink[];
	/** Where the project itself lives. */
	link?: ProjectLink;
};

// TODO: set to the Syrenware playlist's Spotify URL; the link is hidden until then.
const SYRENWARE_PLAYLIST_URL: string | undefined = undefined;

export const projects: Project[] = [
	{
		title: 'Design jam',
		description:
			'A collective mood board to define our design language direction, and brainstorm ideas for visualising Atlantis as an actual city.',
		participants: []
	},
	{
		title: 'Syrenware',
		description: 'A collaborative playlist to share favourite songs with each other. :D',
		participants: [],
		link: SYRENWARE_PLAYLIST_URL
			? { href: SYRENWARE_PLAYLIST_URL, label: 'Visit Syrenware playlist', icon: 'spotify' }
			: undefined
	},
	{
		title: 'Stream dice themes',
		description: 'Preview materials and grab the !dicethemes chat command for each one.',
		participants: [],
		link: { href: '/ladyofcode/dice-themes', label: 'Browse stream dice themes' }
	}
];
