import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Neon and holographic objects, each on its own transparent canvas over the water. There's no
// bloom pass (it would need an opaque canvas), so glow is faked: a neon line is a hot core tube
// inside a much wider, faint halo tube, both additive and ignoring depth, so overlapping light
// adds up the way real neon does. Holographic solids get a rim glow with drifting scanlines, like
// the globe. Glass gets a shader of its own (see `glass`).

const CYAN = new THREE.Color('hsl(185, 90%, 60%)');
const HOT = new THREE.Color('hsl(320, 100%, 65%)');
const AMBER = new THREE.Color('hsl(38, 100%, 60%)');
const BLUE = new THREE.Color('hsl(192, 100%, 60%)');
const SPOTIFY = new THREE.Color('#1ed760');
const WHITE = new THREE.Color(0xffffff);

const FOV = 35;
// Every object is built to fit in a circle this big (plus its bob), so they all share a camera.
const VIEW_RADIUS = 1.6;
const CAMERA_DISTANCE = VIEW_RADIUS / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
// How far the object leans towards the cursor (radians), and how quickly it follows.
const TILT = 0.25;
const TILT_RATE = 4;

// Additive light in premultiplied colour, with each pixel's alpha as bright as its brightest
// channel. The browser then lays the canvas over the water as light: a faint halo barely covers
// it, a hot core covers it fully. (Plain additive blending with alpha 1 turns a faint halo into a
// dark, nearly opaque patch; leaving alpha at 0 is invalid premultiplied colour, which some GPUs
// drop entirely.) The built-in sprite and line shaders premultiply themselves under this flag;
// the shaders here output premultiplied colour through `light()`, and sprites (whose shader
// doesn't premultiply) get it from their texture.
const glowing = {
	blending: THREE.AdditiveBlending,
	premultipliedAlpha: true,
	depthTest: false,
	depthWrite: false,
	transparent: true
} as const;

const lightChunk = /* glsl */ `
	vec4 light(vec3 color) {
		color = clamp(color, 0.0, 1.0);
		return vec4(color, max(color.r, max(color.g, color.b)));
	}
`;

const facingVertex = /* glsl */ `
	varying vec3 vNormal;
	varying vec3 vView;
	void main() {
		vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
		vNormal = normalize(normalMatrix * normal);
		vView = normalize(-viewPosition.xyz);
		gl_Position = projectionMatrix * viewPosition;
	}
`;

// The tube itself: white-hot where it faces you, its colour towards the edges, like lit glass.
const coreMaterial = (color: THREE.Color, intensity: { value: number }) =>
	new THREE.ShaderMaterial({
		uniforms: { uColor: { value: color }, uIntensity: intensity },
		vertexShader: facingVertex,
		fragmentShader: /* glsl */ `
			${lightChunk}
			uniform vec3 uColor;
			uniform float uIntensity;
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				float facing = abs(dot(vNormal, vView));
				vec3 color = mix(uColor, vec3(1.0), pow(facing, 4.0) * 0.75);
				gl_FragColor = light(color * (0.5 + 0.5 * facing) * uIntensity);
			}
		`,
		...glowing
	});

// The light around it: strongest along the middle and fading to nothing at its silhouette.
const haloMaterial = (color: THREE.Color, intensity: { value: number }) =>
	new THREE.ShaderMaterial({
		uniforms: { uColor: { value: color }, uIntensity: intensity },
		vertexShader: facingVertex,
		fragmentShader: /* glsl */ `
			${lightChunk}
			uniform vec3 uColor;
			uniform float uIntensity;
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				float glow = pow(abs(dot(vNormal, vView)), 3.0) * 0.3;
				gl_FragColor = light(uColor * glow * uIntensity);
			}
		`,
		...glowing
	});

// Rim glow plus faint scanlines drifting down, as on the globe.
const holoMaterial = (color: THREE.Color, time: { value: number }, strength = 1) =>
	new THREE.ShaderMaterial({
		uniforms: { uColor: { value: color }, uTime: time, uStrength: { value: strength } },
		vertexShader: facingVertex,
		fragmentShader: /* glsl */ `
			${lightChunk}
			uniform vec3 uColor;
			uniform float uTime;
			uniform float uStrength;
			varying vec3 vNormal;
			varying vec3 vView;
			void main() {
				float rim = pow(1.0 - abs(dot(vNormal, vView)), 2.5);
				float scan = 0.7 + 0.3 * sin(gl_FragCoord.y * 0.9 - uTime * 4.0);
				gl_FragColor = light(uColor * (0.06 + rim * 0.8) * scan * uStrength);
			}
		`,
		side: THREE.DoubleSide,
		...glowing
	});

const additiveLine = (color: THREE.Color, opacity: number) =>
	new THREE.LineBasicMaterial({ color, opacity, ...glowing });

// Soft round glow: white-hot core fading out.
function glowTexture(): THREE.CanvasTexture {
	const size = 64;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(
		size / 2,
		size / 2,
		0,
		size / 2,
		size / 2,
		size / 2
	);
	gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
	gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
	gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
	gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, size, size);
	const texture = new THREE.CanvasTexture(canvas);
	texture.premultiplyAlpha = true;
	return texture;
}

type Neon = { group: THREE.Group; intensity: { value: number } };

// One neon "tube" along any number of curves, merged into a single core mesh and a single halo.
// Pieces that should flicker or dim together can share one `intensity`.
function neon(
	curves: THREE.Curve<THREE.Vector3>[],
	color: THREE.Color,
	radius = 0.03,
	intensity = { value: 1 }
): Neon {
	const tubes = (r: number) =>
		mergeGeometries(
			curves.map((curve) => {
				const segments = Math.max(8, Math.ceil(curve.getLength() / 0.03));
				return new THREE.TubeGeometry(curve, segments, r, 8, false);
			})
		);
	const group = new THREE.Group();
	group.add(
		new THREE.Mesh(tubes(radius * 5), haloMaterial(color, intensity)),
		new THREE.Mesh(tubes(radius), coreMaterial(color, intensity))
	);
	return { group, intensity };
}

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

// Straight segments through the points, kept sharp at the corners.
function polyline(points: THREE.Vector3[], closed = false): THREE.CurvePath<THREE.Vector3> {
	const path = new THREE.CurvePath<THREE.Vector3>();
	const ends = closed ? [...points, points[0]] : points;
	for (let i = 1; i < ends.length; i++) path.add(new THREE.LineCurve3(ends[i - 1], ends[i]));
	return path;
}

function arc(radius: number, from: number, to: number, center = v(0, 0)): THREE.Vector3[] {
	const steps = Math.max(8, Math.ceil(Math.abs(to - from) * 24));
	return Array.from({ length: steps + 1 }, (_, i) => {
		const angle = from + ((to - from) * i) / steps;
		return v(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, center.z);
	});
}

const circle = (radius: number) => polyline(arc(radius, 0, Math.PI * 2));

function glowSprite(map: THREE.Texture, color: THREE.Color, size: number): THREE.Sprite {
	const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, ...glowing }));
	sprite.scale.setScalar(size);
	return sprite;
}

// Faulty-sign flicker: mostly steady, with the odd quick stutter.
function flicker(time: number): number {
	const tick = Math.floor(time * 14);
	const noise = Math.abs(Math.sin(tick * 12.9898) * 43758.5453) % 1;
	return noise > 0.95 ? 0.25 + noise * 0.3 : 0.92 + 0.08 * Math.sin(time * 50);
}

type Built = { root: THREE.Object3D; update(time: number): void };
type Context = { glow: THREE.Texture; time: { value: number } };

// A polyhedron's edges as straight curves (for neon), and its corners without the repeats.
function edgeCurves(shape: THREE.BufferGeometry): THREE.Curve<THREE.Vector3>[] {
	const edges = new THREE.EdgesGeometry(shape).getAttribute('position');
	const curves: THREE.Curve<THREE.Vector3>[] = [];
	for (let i = 0; i < edges.count; i += 2) {
		curves.push(
			new THREE.LineCurve3(
				v(edges.getX(i), edges.getY(i), edges.getZ(i)),
				v(edges.getX(i + 1), edges.getY(i + 1), edges.getZ(i + 1))
			)
		);
	}
	return curves;
}

function cornersOf(shape: THREE.BufferGeometry): THREE.Vector3[] {
	const positions = shape.getAttribute('position');
	const corners = new Map<string, THREE.Vector3>();
	for (let i = 0; i < positions.count; i++) {
		const corner = v(positions.getX(i), positions.getY(i), positions.getZ(i));
		corners.set(
			corner
				.toArray()
				.map((n) => n.toFixed(3))
				.join(),
			corner
		);
	}
	return [...corners.values()];
}

// A d20, for the dice themes: a holographic shell with neon edges, a counter-spinning wire core
// and glowing corners.
function d20({ glow, time }: Context): Built {
	const root = new THREE.Group();
	const shape = new THREE.IcosahedronGeometry(1.15, 0);
	root.add(new THREE.Mesh(shape, holoMaterial(CYAN, time)));
	root.add(neon(edgeCurves(shape), CYAN, 0.018).group);
	for (const corner of cornersOf(shape)) {
		const sprite = glowSprite(glow, WHITE, 0.22);
		sprite.position.copy(corner);
		root.add(sprite);
	}

	const core = new THREE.LineSegments(
		new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.45, 0)),
		additiveLine(HOT, 0.9)
	);
	root.add(core);

	return {
		root,
		update(t) {
			root.rotation.set(t * 0.25, t * 0.4, 0);
			core.rotation.set(-t * 0.9, -t * 0.6, 0);
		}
	};
}

// A holographic jellyfish: the bell pulses, pushing it up, and the tentacles trail in waves.
const TENTACLES = 10;
const TENTACLE_POINTS = 32;

function jellyfish({ glow, time }: Context): Built {
	const root = new THREE.Group();
	const bell = new THREE.Group();
	bell.position.y = 0.35;
	bell.add(
		new THREE.Mesh(
			new THREE.SphereGeometry(0.9, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
			holoMaterial(CYAN, time, 1.3)
		)
	);
	const rim = neon([circle(0.9)], CYAN, 0.02);
	rim.group.rotation.x = Math.PI / 2;
	bell.add(rim.group);
	for (let i = 0; i < 4; i++) {
		const angle = (i / 4) * Math.PI * 2;
		const organ = glowSprite(glow, HOT, 0.35);
		organ.position.set(Math.cos(angle) * 0.3, 0.35, Math.sin(angle) * 0.3);
		bell.add(organ);
	}
	root.add(bell);

	const tentacles = Array.from({ length: TENTACLES }, (_, i) => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.BufferAttribute(new Float32Array(TENTACLE_POINTS * 3), 3)
		);
		const line = new THREE.Line(geometry, additiveLine(i % 2 ? HOT : CYAN, 0.7));
		line.frustumCulled = false;
		root.add(line);
		return { geometry, angle: (i / TENTACLES) * Math.PI * 2, phase: i * 1.7 };
	});

	return {
		root,
		update(t) {
			const pulse = Math.sin(t * 2);
			bell.scale.set(1 + pulse * 0.07, 1 - pulse * 0.06, 1 + pulse * 0.07);
			root.position.y = Math.sin(t * 2 - 0.8) * 0.08;
			root.rotation.y = t * 0.15;
			const rimRadius = 0.85 * bell.scale.x;
			for (const { geometry, angle, phase } of tentacles) {
				const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
				for (let k = 0; k < TENTACLE_POINTS; k++) {
					const along = k / (TENTACLE_POINTS - 1);
					const sway = Math.sin(t * 2 - along * 5 + phase) * 0.18 * along;
					const radius = rimRadius * (1 - along * 0.35) + sway;
					positions.setXYZ(
						k,
						Math.cos(angle + sway * 0.6) * radius,
						bell.position.y - along * 1.8,
						Math.sin(angle + sway * 0.6) * radius
					);
				}
				positions.needsUpdate = true;
			}
		}
	};
}

// Three neon rings turning on their own axes around a glowing core.
function gyroscope({ glow, time }: Context): Built {
	const root = new THREE.Group();
	const rings = [
		{ radius: 1.3, color: CYAN, axis: v(1, 0, 0), speed: 0.7 },
		{ radius: 1.05, color: HOT, axis: v(0, 1, 0), speed: -0.9 },
		{ radius: 0.8, color: AMBER, axis: v(1, 1, 0).normalize(), speed: 1.2 }
	].map(({ radius, color, axis, speed }) => {
		const ring = neon([circle(radius)], color, 0.025);
		root.add(ring.group);
		return { group: ring.group, axis, speed };
	});
	root.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 32, 16), holoMaterial(WHITE, time)));
	root.add(glowSprite(glow, CYAN, 1.1));

	return {
		root,
		update(t) {
			for (const { group, axis, speed } of rings) {
				group.quaternion.setFromAxisAngle(axis, t * speed);
			}
			root.rotation.z = Math.sin(t * 0.4) * 0.2;
		}
	};
}

// A jaw from -> to, zig-zagging into teeth that point into the mouth (to the right going from
// -> to, which is the mouth side for both jaws of a fish facing left).
function jaw(from: THREE.Vector3, to: THREE.Vector3, count: number, size = 0.13) {
	const points: THREE.Vector3[] = [];
	const normal = v(to.y - from.y, -(to.x - from.x))
		.normalize()
		.multiplyScalar(size);
	for (let i = 0; i <= count * 2; i++) {
		const point = from.clone().lerp(to, i / (count * 2));
		if (i % 2) point.add(normal);
		points.push(point);
	}
	return polyline(points);
}

// The Spotify logo's three bars, longest and thickest first, turned upright into gills for a fish
// facing left with a body of radius 1.
function spotifyGills() {
	return [
		{ x: -0.05, half: 0.62, radius: 0.05 },
		{ x: 0.22, half: 0.5, radius: 0.04 },
		{ x: 0.46, half: 0.38, radius: 0.032 }
	].map(({ x, half, radius }) => {
		const bend = 0.6;
		const reach = half / Math.sin(bend);
		return { curve: polyline(arc(reach, -bend, bend, v(x - reach, 0))), radius };
	});
}

// The Spotify logo as an anglerfish: the circle is its body with a toothy mouth cut out of the
// front, the three bars are its gills, and a lure dangles in front of it from a stalk on its head.
// It flickers like a sign on its way out.
function angler({ glow }: Context): Built {
	const root = new THREE.Group();
	const fish = new THREE.Group();
	root.add(fish);
	// Every tube shares one power supply, so the whole sign flickers at once.
	const power = { value: 1 };
	const tube = (curves: THREE.Curve<THREE.Vector3>[], color: THREE.Color, radius: number) =>
		neon(curves, color, radius, power);
	// Sprites are dimmed by colour as well as opacity, to stay premultiplied.
	const dim = (sprite: THREE.Sprite, color: THREE.Color, amount: number) => {
		sprite.material.opacity = amount;
		sprite.material.color.copy(color).multiplyScalar(amount);
	};

	// Facing left. The mouth is a wedge cut into the circle, hinged a third of the way in.
	const upper = Math.PI - 0.5;
	const lower = Math.PI + 0.5;
	const hinge = v(-0.35, -0.05);
	const body = tube(
		[polyline([...arc(1, lower, upper + Math.PI * 2), hinge], true)],
		SPOTIFY,
		0.045
	);
	fish.add(body.group);

	// Teeth along both jaws, pointing into the mouth.
	const mouthTop = v(Math.cos(upper), Math.sin(upper));
	const mouthBottom = v(Math.cos(lower), Math.sin(lower));
	fish.add(tube([jaw(mouthTop, hinge, 4), jaw(hinge, mouthBottom, 4)], WHITE, 0.012).group);

	// The logo's three bars, longest and thickest first, turned upright into gills.
	for (const { curve, radius } of spotifyGills()) fish.add(tube([curve], SPOTIFY, radius).group);

	const eye = tube([circle(0.09)], WHITE, 0.012);
	eye.group.position.set(-0.5, 0.42, 0);
	fish.add(eye.group);
	const pupil = glowSprite(glow, SPOTIFY, 0.12);
	pupil.position.copy(eye.group.position);
	fish.add(pupil);

	// Dorsal spines along the top of the head.
	fish.add(
		tube(
			[0.9, 1.2, 1.5].map((angle) =>
				polyline([
					v(Math.cos(angle), Math.sin(angle)),
					v(Math.cos(angle) * 1.22, Math.sin(angle) * 1.22)
				])
			),
			SPOTIFY,
			0.02
		).group
	);

	// The tail, hinged at the back of the body.
	const tail = tube(
		[polyline([v(0, 0.12), v(0.6, 0.5), v(0.42, 0), v(0.6, -0.5), v(0, -0.12)])],
		SPOTIFY,
		0.035
	);
	tail.group.position.x = 0.98;
	fish.add(tail.group);

	// The lure: a stalk from the top of the head arching out over the mouth, swaying on its base.
	const lure = new THREE.Group();
	const base = v(Math.cos(1.85), Math.sin(1.85));
	lure.position.copy(base);
	const bulb = v(-0.95, -0.05);
	const stalk = tube(
		[new THREE.QuadraticBezierCurve3(v(0, 0), v(-0.35, 0.7), bulb)],
		SPOTIFY,
		0.014
	);
	const light = glowSprite(glow, WHITE, 0.4);
	const halo = glowSprite(glow, SPOTIFY, 0.9);
	light.position.copy(bulb);
	halo.position.copy(bulb);
	lure.add(stalk.group, light, halo);
	fish.add(lure);

	fish.scale.setScalar(0.95);

	return {
		root,
		update(t) {
			root.position.y = Math.sin(t * 1.1) * 0.08;
			root.rotation.set(0, Math.sin(t * 0.5) * 0.45, Math.sin(t * 1.1 + 1) * 0.05);
			tail.group.rotation.y = Math.sin(t * 4) * 0.5;
			lure.rotation.z = Math.sin(t * 1.6) * 0.12;
			const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
			power.value = flicker(t);
			dim(halo, SPOTIFY, (0.5 + 0.5 * pulse) * power.value);
			dim(light, WHITE, power.value);
			dim(pupil, SPOTIFY, power.value);
			light.scale.setScalar(0.32 + 0.12 * pulse);
		}
	};
}

// Glass. There's nothing in the canvas behind it to refract (the water is on another canvas), so
// it reflects and refracts a made-up underwater room instead: dark teal below, light from the
// surface above, a bright strip and two coloured lights to catch as highlights. The three colour
// channels bend by slightly different amounts, which splits the edges into rainbows. Mostly clear
// face-on and more solid at grazing angles (Fresnel), with an optional soap-film shimmer. Drawn
// in premultiplied colour with normal blending, so it dims what's behind it a little, like glass.
type GlassOptions = {
	tint?: THREE.Color;
	ior?: number;
	dispersion?: number;
	// How much of the refracted room shows through (a bubble is nearly all reflection).
	body?: number;
	iridescence?: number;
	// Surface wobble, for the bubble.
	wobble?: number;
	// How strongly the room's coloured lights glint. A flat facet catches a light all at once,
	// so faceted glass wants this lower or whole faces flash solid colour.
	glints?: number;
	// Light from within the glass, in this colour: strongest through the thick middle, with a lit
	// rim, like uranium glass.
	glowColor?: THREE.Color;
	glow?: number;
	// Soap-bubble colours glowing from the surface itself, strongest towards the edges, so the
	// glass shimmers even where it reflects nothing bright.
	filmGlow?: number;
	// 0 lets the film run the full rainbow; 1 keeps it to soft pinks, violets, blues and cyans,
	// so neighbouring facets don't clash.
	filmFocus?: number;
	// Where on the palette a focused film sits: 0.13 runs pink to cyan, 0.5 cyan to green.
	filmHue?: number;
	// Hologram treatment on top of the glow: scanlines, a band of light sweeping up through it,
	// and a shifting rainbow rim.
	holo?: number;
};

const glassMaterial = (
	time: { value: number },
	side: THREE.Side,
	{
		tint = WHITE,
		ior = 1.45,
		dispersion = 0.03,
		body = 0.6,
		iridescence = 0,
		wobble = 0,
		glints = 1,
		glowColor = CYAN,
		glow = 0,
		filmGlow = 0,
		filmFocus = 0,
		filmHue = 0.13,
		holo = 0
	}: GlassOptions
) =>
	new THREE.ShaderMaterial({
		uniforms: {
			uTime: time,
			uTint: { value: tint },
			uIor: { value: ior },
			uDispersion: { value: dispersion },
			uBody: { value: body },
			uIridescence: { value: iridescence },
			uWobble: { value: wobble },
			uGlints: { value: glints },
			uGlowColor: { value: glowColor },
			uGlow: { value: glow },
			uFilmGlow: { value: filmGlow },
			uFilmFocus: { value: filmFocus },
			uFilmHue: { value: filmHue },
			uHolo: { value: holo },
			uLightA: { value: CYAN },
			uLightB: { value: HOT }
		},
		// World space, so the room stays put while the object turns and the highlights slide over it.
		vertexShader: /* glsl */ `
			uniform float uTime;
			uniform float uWobble;
			varying vec3 vNormal;
			varying vec3 vView;
			varying vec3 vLocal;
			varying vec3 vWorld;
			void main() {
				vec3 p = position;
				p += normal * uWobble * (
					sin(p.x * 4.0 + uTime * 1.7) * sin(p.y * 3.0 - uTime * 1.3) +
					0.5 * sin(p.z * 5.0 + uTime * 2.1)
				);
				vec4 world = modelMatrix * vec4(p, 1.0);
				vNormal = normalize(mat3(modelMatrix) * normal);
				vView = normalize(cameraPosition - world.xyz);
				vLocal = position;
				vWorld = world.xyz;
				gl_Position = projectionMatrix * viewMatrix * world;
			}
		`,
		fragmentShader: /* glsl */ `
			uniform float uTime;
			uniform vec3 uTint;
			uniform float uIor;
			uniform float uDispersion;
			uniform float uBody;
			uniform float uIridescence;
			uniform vec3 uLightA;
			uniform vec3 uLightB;
			uniform float uGlints;
			uniform vec3 uGlowColor;
			uniform float uGlow;
			uniform float uFilmGlow;
			uniform float uFilmFocus;
			uniform float uFilmHue;
			uniform float uHolo;
			varying vec3 vNormal;
			varying vec3 vView;
			varying vec3 vLocal;
			varying vec3 vWorld;

			vec3 room(vec3 d) {
				vec3 color = mix(vec3(0.0, 0.03, 0.05), vec3(0.03, 0.2, 0.24), smoothstep(-0.4, 0.9, d.y));
				color += vec3(0.75, 0.95, 1.0) * pow(max(d.y, 0.0), 20.0) * 2.5;
				color += vec3(1.5) * (1.0 - smoothstep(0.0, 0.07, abs(d.y - 0.3))) * smoothstep(-0.2, 0.7, d.z);
				color += uLightA * smoothstep(0.9, 0.99, dot(d, normalize(vec3(-0.9, 0.2, 0.4)))) * 3.0 * uGlints;
				color += uLightB * smoothstep(0.9, 0.99, dot(d, normalize(vec3(0.8, -0.3, 0.5)))) * 3.0 * uGlints;
				return color;
			}

			void main() {
				vec3 n = normalize(vNormal);
				// The back-face pass sees the inside of the glass, so its normals face inwards. (three.js
				// swaps the winding for back-side materials, so gl_FrontFacing can't tell us.)
				#ifdef FLIP_SIDED
					n = -n;
				#endif
				vec3 v = normalize(vView);
				float facing = clamp(dot(n, v), 0.0, 1.0);
				float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);

				vec3 reflected = room(reflect(-v, n));
				vec3 refracted = vec3(
					room(refract(-v, n, 1.0 / (uIor - uDispersion))).r,
					room(refract(-v, n, 1.0 / uIor)).g,
					room(refract(-v, n, 1.0 / (uIor + uDispersion))).b
				);

				// Thin-film colours, shifting with the angle and drifting over the surface.
				float film = facing * 1.6 + 0.3 * sin(vLocal.y * 4.0 + vLocal.x * 3.0 + uTime * 0.8);
				// Focused, the film only moves through a short stretch of the palette below, from uFilmHue.
				film = mix(film, uFilmHue + film * 0.22, uFilmFocus);
				vec3 sheen = 0.5 + 0.5 * cos(6.2832 * (film + vec3(0.0, 0.33, 0.67)));
				sheen = mix(sheen, vec3(0.8), uFilmFocus * 0.25);
				vec3 shimmer = mix(vec3(1.0), sheen * 1.2, uIridescence);

				vec3 color = refracted * uTint * uBody + reflected * shimmer * (fresnel * 2.0 + 0.15);
				color += sheen * uIridescence * pow(1.0 - facing, 3.0) * 0.3;

				vec3 emission = uGlowColor * uGlow * (0.12 + 0.25 * facing + 0.9 * pow(1.0 - facing, 2.0));
				float scan = 0.7 + 0.3 * sin(gl_FragCoord.y * 0.9 - uTime * 4.0);
				// Sweeps up through the world, not the object, so it stays level as the object turns.
				float sweep = exp(-pow((vWorld.y - (mod(uTime * 0.5, 3.4) - 1.7)) * 5.0, 2.0));
				emission *= mix(1.0, scan, uHolo);
				emission += (uGlowColor * 0.8 + 0.2) * sweep * uHolo * 0.6;
				emission += sheen * pow(1.0 - facing, 2.0) * uHolo * 0.5;
				emission += sheen * uFilmGlow * (0.12 + 0.6 * pow(1.0 - facing, 1.5));
				color = clamp(color + emission, 0.0, 1.0);
				float alpha = max(0.06 + fresnel * 0.7, max(color.r, max(color.g, color.b)));
				gl_FragColor = vec4(color, alpha);
			}
		`,
		side,
		blending: THREE.NormalBlending,
		premultipliedAlpha: true,
		depthTest: false,
		depthWrite: false,
		transparent: true
	});

// Back faces first, then the front, so the far side of the glass shows through the near side.
// Anything drawn with a render order between (-1 and 1) sits inside the glass.
function glass(
	geometry: THREE.BufferGeometry,
	time: { value: number },
	options: GlassOptions = {}
) {
	const back = new THREE.Mesh(geometry, glassMaterial(time, THREE.BackSide, options));
	const front = new THREE.Mesh(geometry, glassMaterial(time, THREE.FrontSide, options));
	back.renderOrder = -1;
	front.renderOrder = 1;
	const group = new THREE.Group();
	group.add(back, front);
	return group;
}

// Neon running through a glass tube bent into a ring, like a real neon sign.
function tube({ time }: Context): Built {
	const root = new THREE.Group();
	const light = neon([circle(0.95)], HOT, 0.035);
	root.add(light.group);
	root.add(
		glass(new THREE.TorusGeometry(0.95, 0.2, 48, 128), time, {
			tint: new THREE.Color('hsl(320, 60%, 85%)'),
			dispersion: 0.05
		})
	);

	return {
		root,
		update(t) {
			root.rotation.set(0.9 + Math.sin(t * 0.4) * 0.3, t * 0.35, 0.2);
		}
	};
}

// A sigil to float things over: a blue ring, a broken one inside it, and fine purple ticks
// between them, lying flat (tipped a little towards the viewer). Turn it on its z axis.
const SIGIL_ARCS = 6;
const SIGIL_TICKS = 36;

function sigilRing(): THREE.Group {
	const sigil = new THREE.Group();
	const arcs = Array.from({ length: SIGIL_ARCS }, (_, i) => {
		const start = (i / SIGIL_ARCS) * Math.PI * 2 + 0.12;
		return polyline(arc(0.78, start, start + (Math.PI * 2) / SIGIL_ARCS - 0.24));
	});
	const ticks = Array.from({ length: SIGIL_TICKS }, (_, i) => {
		const angle = (i / SIGIL_TICKS) * Math.PI * 2;
		const inner = i % 3 ? 0.86 : 0.83;
		return new THREE.LineCurve3(
			v(Math.cos(angle) * inner, Math.sin(angle) * inner),
			v(Math.cos(angle) * 0.92, Math.sin(angle) * 0.92)
		);
	});
	sigil.add(
		neon([circle(1.0)], BLUE, 0.012).group,
		neon(arcs, BLUE, 0.012).group,
		neon(ticks, HOT, 0.006).group
	);
	sigil.rotation.x = -Math.PI / 2 + 0.3;
	return sigil;
}

// The holo d20 cut from solid glass: a neon d20 turning inside it, and the glass's edges picked
// out in faint light. Clear, with soap-bubble colours in its highlights and edges, or glowing
// with the hologram treatment.
type GlassStyle = 'clear' | 'iridescent' | 'holo';

const glassD20 =
	(style: GlassStyle) =>
	({ glow, time }: Context): Built => {
		const root = new THREE.Group();
		const die = new THREE.Group();
		root.add(die);
		const shape = new THREE.IcosahedronGeometry(1.15, 0);
		die.add(
			glass(shape, time, {
				tint: new THREE.Color('hsl(190, 60%, 85%)'),
				ior: 1.5,
				dispersion: 0.05,
				glints: style === 'iridescent' ? 0.4 : 0.25,
				iridescence: style === 'iridescent' ? 0.6 : 0,
				filmGlow: style === 'iridescent' ? 0.35 : 0,
				filmFocus: style === 'iridescent' ? 1 : 0,
				glow: style === 'holo' ? 0.35 : 0,
				holo: style === 'holo' ? 1 : 0
			})
		);
		die.add(
			new THREE.LineSegments(
				new THREE.EdgesGeometry(shape),
				additiveLine(style === 'holo' ? CYAN : WHITE, style === 'holo' ? 0.5 : 0.3)
			)
		);

		const core = new THREE.Group();
		const coreShape = new THREE.IcosahedronGeometry(0.5, 0);
		core.add(neon(edgeCurves(coreShape), HOT, 0.014).group, glowSprite(glow, HOT, 0.9));
		die.add(core);

		// The iridescent one floats over a sigil, scaled down to make room for it.
		const sigil = style === 'iridescent' ? sigilRing() : undefined;
		if (sigil) {
			die.scale.setScalar(0.75);
			sigil.position.y = -0.85;
			root.add(sigil);
		}

		return {
			root,
			update(t) {
				die.rotation.set(t * 0.2, t * 0.3, 0);
				core.rotation.set(-t * 0.7, -t * 0.5, 0);
				if (sigil) {
					die.position.y = 0.32 + Math.sin(t * 1.1) * 0.06;
					sigil.rotation.z = -t * 0.25;
				}
			}
		};
	};

// The gyroscope rebuilt like the glass tube: each ring is a glass tube with neon running through
// it, turning round a small glass orb with a light inside.
function armillary({ glow, time }: Context): Built {
	const root = new THREE.Group();
	const rings = [
		{ radius: 1.3, color: CYAN, axis: v(1, 0, 0), speed: 0.5 },
		{ radius: 1.04, color: AMBER, axis: v(0, 1, 0), speed: -0.65 },
		{ radius: 0.78, color: HOT, axis: v(1, 1, 0).normalize(), speed: 0.85 }
	].map(({ radius, color, axis, speed }) => {
		const ring = new THREE.Group();
		ring.add(
			neon([circle(radius)], color, 0.016).group,
			glass(new THREE.TorusGeometry(radius, 0.075, 32, 160), time, {
				tint: color.clone().lerp(WHITE, 0.6),
				dispersion: 0.05
			})
		);
		root.add(ring);
		return { ring, axis, speed };
	});
	root.add(glowSprite(glow, CYAN, 0.9));
	root.add(glass(new THREE.SphereGeometry(0.3, 48, 24), time, { dispersion: 0.04 }));

	return {
		root,
		update(t) {
			for (const { ring, axis, speed } of rings) ring.quaternion.setFromAxisAngle(axis, t * speed);
			root.rotation.z = Math.sin(t * 0.4) * 0.15;
		}
	};
}

// A cut crystal floating over a turning sigil: a six-sided point of glass with a line of light
// through its heart and its facet edges picked out.
function crystal({ glow, time }: Context): Built {
	const root = new THREE.Group();

	const gem = new THREE.Group();
	// Flat-shaded, so each facet catches the light on its own.
	const shape = new THREE.LatheGeometry(
		[
			new THREE.Vector2(0, -0.95),
			new THREE.Vector2(0.48, -0.4),
			new THREE.Vector2(0.52, 0.3),
			new THREE.Vector2(0, 1.15)
		],
		6
	).toNonIndexed();
	shape.computeVertexNormals();
	gem.add(
		glass(shape, time, {
			tint: new THREE.Color('hsl(200, 70%, 88%)'),
			ior: 1.6,
			dispersion: 0.07,
			iridescence: 0.15,
			glints: 0.35
		}),
		new THREE.LineSegments(new THREE.EdgesGeometry(shape, 10), additiveLine(WHITE, 0.3)),
		neon([new THREE.LineCurve3(v(0, -0.55), v(0, 0.75))], CYAN, 0.012).group,
		glowSprite(glow, CYAN, 0.7)
	);
	root.add(gem);

	const sigil = sigilRing();
	sigil.position.y = -0.85;
	root.add(sigil);

	return {
		root,
		update(t) {
			gem.rotation.y = t * 0.4;
			gem.position.y = 0.25 + Math.sin(t * 1.1) * 0.06;
			sigil.rotation.z = -t * 0.25;
		}
	};
}

// A soap bubble: almost no body, all thin-film colour, wobbling as it drifts.
function bubble({ time }: Context): Built {
	const root = glass(new THREE.SphereGeometry(1.05, 96, 48), time, {
		ior: 1.02,
		dispersion: 0,
		body: 0.04,
		iridescence: 1,
		wobble: 0.03
	});

	return {
		root,
		update(t) {
			root.position.set(Math.sin(t * 0.5) * 0.08, Math.sin(t * 0.8) * 0.1, 0);
			root.rotation.y = t * 0.2;
		}
	};
}

// The Spotify anglerfish blown as a soap bubble: a bubble body with its film kept to Spotify
// greens, the logo's bars glowing inside it as gills, teeth and an eye, a tail of two small bubble
// lobes, and a lure with a tiny bubble on the end.
function bubbleAngler({ glow, time }: Context): Built {
	const root = new THREE.Group();
	const fish = new THREE.Group();
	root.add(fish);
	const film = (wobble: number) => ({
		ior: 1.02,
		dispersion: 0,
		body: 0.04,
		iridescence: 0.8,
		filmGlow: 0.22,
		filmFocus: 1,
		filmHue: 0.5,
		glints: 0.3,
		wobble
	});

	fish.add(glass(new THREE.SphereGeometry(1, 96, 48), time, film(0.02)));
	for (const { curve, radius } of spotifyGills()) fish.add(neon([curve], SPOTIFY, radius).group);

	// No mouth can be cut from a bubble, so the jaws sit just inside its front edge.
	const upper = v(Math.cos(Math.PI - 0.5), Math.sin(Math.PI - 0.5)).multiplyScalar(0.94);
	const lower = v(Math.cos(Math.PI + 0.5), Math.sin(Math.PI + 0.5)).multiplyScalar(0.94);
	const hinge = v(-0.4, -0.05);
	fish.add(neon([jaw(upper, hinge, 4, 0.11), jaw(hinge, lower, 4, 0.11)], WHITE, 0.01).group);

	const eye = neon([circle(0.08)], WHITE, 0.01);
	eye.group.position.set(-0.48, 0.4, 0);
	const pupil = glowSprite(glow, SPOTIFY, 0.11);
	pupil.position.copy(eye.group.position);
	fish.add(eye.group, pupil);

	// The tail: two flattened bubbles splayed from a hinge at the back.
	const tail = new THREE.Group();
	for (const side of [1, -1]) {
		const lobe = glass(new THREE.SphereGeometry(0.4, 48, 24), time, film(0));
		lobe.scale.set(1, 0.5, 0.3);
		lobe.rotation.z = side * 0.55;
		lobe.position.set(0.3, side * 0.2, 0);
		tail.add(lobe);
	}
	tail.position.x = 0.95;
	fish.add(tail);

	// The lure, swaying on its base at the top of the head, with a small lit bubble on the end.
	const lure = new THREE.Group();
	lure.position.set(Math.cos(1.85), Math.sin(1.85), 0);
	const tip = v(-0.95, -0.05);
	const light = glowSprite(glow, WHITE, 0.3);
	const halo = glowSprite(glow, SPOTIFY, 0.7);
	const bead = glass(new THREE.SphereGeometry(0.12, 32, 16), time, film(0));
	light.position.copy(tip);
	halo.position.copy(tip);
	bead.position.copy(tip);
	lure.add(
		neon([new THREE.QuadraticBezierCurve3(v(0, 0), v(-0.35, 0.7), tip)], SPOTIFY, 0.012).group,
		light,
		halo,
		bead
	);
	fish.add(lure);

	fish.scale.setScalar(0.92);

	return {
		root,
		update(t) {
			root.position.y = Math.sin(t * 1.1) * 0.08;
			root.rotation.set(0, Math.sin(t * 0.5) * 0.45, Math.sin(t * 1.1 + 1) * 0.05);
			tail.rotation.y = Math.sin(t * 4) * 0.5;
			lure.rotation.z = Math.sin(t * 1.6) * 0.12;
			// Dimmed by colour as well as opacity, to stay premultiplied.
			const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
			halo.material.opacity = 0.5 + 0.5 * pulse;
			halo.material.color.copy(SPOTIFY).multiplyScalar(halo.material.opacity);
		}
	};
}

const OBJECTS = {
	d20,
	jellyfish,
	gyroscope,
	angler,
	glassD20: glassD20('clear'),
	iridescentD20: glassD20('iridescent'),
	holoGlassD20: glassD20('holo'),
	tube,
	armillary,
	crystal,
	bubble,
	bubbleAngler
} satisfies Record<string, (context: Context) => Built>;

export type NeonObjectKind = keyof typeof OBJECTS;

export class NeonStage {
	private readonly canvas: HTMLCanvasElement;
	private readonly scene = new THREE.Scene();
	private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
	private readonly renderer: THREE.WebGLRenderer;
	// Leans towards the cursor; the object animates inside it.
	private readonly holder = new THREE.Group();
	private readonly object: Built;
	private readonly glow = glowTexture();
	private readonly time = { value: 0 };
	private readonly timer = new THREE.Timer();
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private pointer: { x: number; y: number } | null = null;
	private animationFrameId: number | null = null;
	private destroyed = false;

	constructor(canvas: HTMLCanvasElement, kind: NeonObjectKind) {
		this.canvas = canvas;
		this.camera.position.z = CAMERA_DISTANCE;
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setClearColor(0x000000, 0);

		this.object = OBJECTS[kind]({ glow: this.glow, time: this.time });
		this.holder.add(this.object.root);
		this.scene.add(this.holder);

		window.addEventListener('pointermove', this.onPointerMove, { passive: true });
		document.documentElement.addEventListener('pointerleave', this.onPointerLeave);

		this.resize();
	}

	private onPointerMove = (event: PointerEvent): void => {
		this.pointer = { x: event.clientX, y: event.clientY };
	};

	private onPointerLeave = (): void => {
		this.pointer = null;
	};

	resize(): void {
		const width = this.canvas.clientWidth;
		const height = this.canvas.clientHeight;
		if (width <= 0 || height <= 0) return;

		this.camera.aspect = width / height;
		// Pull back when the box is narrower than it is tall, so the object still fits across it.
		this.camera.zoom = Math.min(1, this.camera.aspect);
		this.camera.updateProjectionMatrix();
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(width, height, false);
		if (this.animationFrameId == null) this.render(0);
	}

	private render(delta: number): void {
		if (!this.reducedMotion) this.time.value += delta;
		this.object.update(this.time.value);

		// Lean towards the cursor, by how far it is from the middle of the canvas (in canvas sizes).
		let tiltX = 0;
		let tiltY = 0;
		if (this.pointer) {
			const rect = this.canvas.getBoundingClientRect();
			const x = (this.pointer.x - (rect.left + rect.width / 2)) / rect.width;
			const y = (this.pointer.y - (rect.top + rect.height / 2)) / rect.height;
			tiltY = THREE.MathUtils.clamp(x, -1, 1) * TILT;
			tiltX = THREE.MathUtils.clamp(y, -1, 1) * TILT;
		}
		const follow = this.reducedMotion ? 1 : 1 - Math.exp(-TILT_RATE * delta);
		this.holder.rotation.x += (tiltX - this.holder.rotation.x) * follow;
		this.holder.rotation.y += (tiltY - this.holder.rotation.y) * follow;

		this.renderer.render(this.scene, this.camera);
	}

	private tick = (timestamp: number): void => {
		if (this.destroyed) return;
		this.timer.update(timestamp);
		this.render(Math.min(this.timer.getDelta(), 0.1));
		this.animationFrameId = requestAnimationFrame(this.tick);
	};

	// Runs while on screen.
	start(): void {
		if (this.destroyed || this.animationFrameId != null) return;
		this.timer.reset();
		this.animationFrameId = requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (this.animationFrameId == null) return;
		cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = null;
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stop();
		this.timer.disconnect();
		window.removeEventListener('pointermove', this.onPointerMove);
		document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
		this.scene.traverse((object) => {
			// Sprites share one geometry across the whole app, so only their materials go.
			if (object instanceof THREE.Sprite) object.material.dispose();
			else if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
				object.geometry.dispose();
				(object.material as THREE.Material).dispose();
			}
		});
		this.glow.dispose();
		this.scene.clear();
		this.renderer.dispose();
	}
}
