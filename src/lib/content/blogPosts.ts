export type BlogPost = {
	slug: string;
	title: string;
	author: string;
	date: string;
	excerpt: string;
	body: string[];
};

export const blogPosts: BlogPost[] = [
	{
		slug: 'welcome-tabs',
		title: 'Welcome to the new Atlantis site',
		author: 'Tabs',
		date: '2026-07-23',
		excerpt: 'Building this site — and the community around it.',
		body: [
			"We're putting together a proper home for Atlantis on the web — somewhere to find events, read updates, and poke at dice themes between streams.",
			'Cupcake ipsum dolor sit amet chocolate cake. Jelly beans carrot cake bonbon muffin. Pastry wafer soufflé tiramisu halvah.',
			'More soon. For now: say hi in Discord if you want to help shape what we build next.'
		]
	},
	{
		slug: 'hello-alom',
		title: 'Hello from Alom',
		author: 'Alom',
		date: '2026-07-23',
		excerpt: 'A quick note from one of the people behind the scenes.',
		body: [
			'Glad you found us. Atlantis is a weird and lovely corner of the internet, and this site is our attempt to show that off properly.',
			'Cupcake ipsum dolor sit amet sugar plum. Cotton candy croissant danish lollipop. Cheesecake macaroon gingerbread jelly-o.',
			'See you around.'
		]
	}
];

export function getPost(slug: string): BlogPost | undefined {
	return blogPosts.find((post) => post.slug === slug);
}
