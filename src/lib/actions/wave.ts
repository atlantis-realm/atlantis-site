import type { Action } from 'svelte/action';

/**
 * Wraps each letter of an element's text in its own span, so the letters can wave in turn on
 * hover (styles in app.css). Each word's letters sit together in a span that doesn't wrap, and
 * the spaces between words stay plain text, so long headings wrap between words rather than
 * mid-word. The element keeps its full text as its accessible name; the letter spans are hidden
 * from assistive tech.
 *
 * Pass the text when it can change (e.g. `use:wave={post.title}`); otherwise it's read from the
 * element once.
 */
export const wave: Action<HTMLElement, string | undefined> = (node, text) => {
	const split = (value: string): void => {
		node.setAttribute('aria-label', value);
		let index = 0;
		const parts: Node[] = [];
		value.split(' ').forEach((word, w) => {
			if (w > 0) parts.push(document.createTextNode(' '));
			if (!word) return;
			const wordSpan = document.createElement('span');
			wordSpan.className = 'wave-word';
			wordSpan.setAttribute('aria-hidden', 'true');
			for (const char of word) {
				const span = document.createElement('span');
				span.className = 'wave-char';
				span.style.setProperty('--i', String(index++));
				span.textContent = char;
				wordSpan.append(span);
			}
			parts.push(wordSpan);
		});
		node.replaceChildren(...parts);
	};
	split(text ?? node.textContent ?? '');

	return {
		update(value) {
			split(value ?? node.textContent ?? '');
		}
	};
};
