import type { Action } from 'svelte/action';

/**
 * Wraps each letter of an element's text in its own span, so the letters can wave in turn on
 * hover (styles in app.css). Spaces stay plain text so long headings still wrap. The element keeps
 * its full text as its accessible name; the letter spans are hidden from assistive tech.
 *
 * Pass the text when it can change (e.g. `use:wave={post.title}`); otherwise it's read from the
 * element once.
 */
export const wave: Action<HTMLElement, string | undefined> = (node, text) => {
	const split = (value: string): void => {
		node.setAttribute('aria-label', value);
		let index = 0;
		node.replaceChildren(
			...[...value].map((char) => {
				if (char === ' ') return document.createTextNode(' ');
				const span = document.createElement('span');
				span.className = 'wave-char';
				span.setAttribute('aria-hidden', 'true');
				span.style.setProperty('--i', String(index++));
				span.textContent = char;
				return span;
			})
		);
	};
	split(text ?? node.textContent ?? '');

	return {
		update(value) {
			split(value ?? node.textContent ?? '');
		}
	};
};
