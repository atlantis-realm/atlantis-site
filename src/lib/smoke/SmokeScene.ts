import * as THREE from 'three';

// Experiment: dropping through the water surface, from bright "magical" water down into the dark.
// See SMOKE_PLAN.md for the stages.
// The camera always looks straight ahead and only sinks: it starts just above the surface, the
// surface passes through it, and then the surface's underside recedes overhead.
// All motion runs on the GPU from shared uTime / uDepth uniforms; the CPU only advances them.

// Height of the water surface.
const WATER_LEVEL = 0;
// Light falls through a circular opening in the surface, spreading into one wide cone below it.
const OPENING_CENTRE = new THREE.Vector3(0, WATER_LEVEL, -2);
// Same as the homepage well (HomeScene WELL_RADIUS), so this reads as looking up from inside it.
const OPENING_RADIUS = 1.5;
// How far the cone's walls lean outwards (radians).
const CONE_SPREAD = 0.42;
const CONE_LENGTH = 20;
// Enough sides that the wide cone's silhouette stays round.
const CONE_SEGMENTS = 128;
const CONE_INTENSITY = 0.45;
// The water surface: a plane big enough that its edges are always lost in the distance fade.
const SURFACE_SIZE = 1000;
const SURFACE_INTENSITY = 0.8;
// The light above the water, as a direction towards it. Nothing in the scene uses three.js lights
// (every material is a custom shader), so this is passed to the shaders that need it; when a real
// light is added above the water, point it the same way so their highlights agree.
const SKY_LIGHT_DIRECTION = new THREE.Vector3(-0.3, 0.35, -1).normalize();
// The glow inside the water, centred under the pool opening, and how far it reaches (metres).
const INNER_GLOW_RADIUS = 9;
// Bubbles: a burst when the camera plunges through the surface, plus a few always drifting up.
const BURST_BUBBLES = 140;
const DRIFT_BUBBLES = 40;
// Height of the band of drifting bubbles kept around the camera; they wrap within it (metres).
const DRIFT_RANGE = 10;
// Marine snow: specks drifting in a box that follows the camera, so they stream past as it sinks.
const SNOW_COUNT = 700;
// Box size (metres): width, height, and how far in front of the camera it reaches.
const SNOW_BOX = new THREE.Vector3(10, 8, 12);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Scroll-driven descent. Depth runs 0 (just above the surface) to 1 (bottom of the section).
// Camera height at the start, above the water, and how far below the water it ends (metres).
// With these the surface passes through the camera about 9% of the way down.
const START_HEIGHT = 1.2;
const DESCENT = 12;
// How quickly depth catches up to the scroll position (higher is snappier).
const DEPTH_DAMPING = 6;
// Nothing in the scene needs to be crisp (soft light, blobs, grain), so render at a lower pixel
// density than the screen's: cheaper per frame and a much smaller offscreen target.
const MAX_PIXEL_RATIO = 1.5;
const TOUCH_PIXEL_RATIO = 1;
// Bloom: the chain starts at 1/4 size (the first pass shrinks straight from full size, which the
// soft glow can't tell apart from going via 1/2) and is halved BLOOM_LEVELS - 1 more times
// (4 levels -> down to 1/32 size, a wide soft glow). Then the brightness where glow starts and
// how gradually it ramps in, and how strongly it's added.
// Every level adds its own copy on the way back up, so the glow is several times brighter than
// the strength alone suggests; keep the strength low.
const BLOOM_LEVELS = 4;
const BLOOM_THRESHOLD = 0.45;
const BLOOM_KNEE = 0.4;
const BLOOM_STRENGTH = 0.12;
// The glow is soft and added faintly, so 8 bits per channel is plenty (half the memory of half
// float), and like the scene target it needs no depth buffer.
const BLOOM_TARGET_OPTIONS = { depthBuffer: false };

// Background palette. Shallow is the stream transitions palette plus a sunrise rose and a mauve
// (its rust accent shifted); deep is Active Theory-style teal-black. The composite writes these
// straight to the screen with no colour-space conversion, so they're plain 0..1 sRGB values.
const PALETTE = {
	cobalt: 0x2c5fae,
	cyan: 0x55bfdc,
	rose: 0xf0a3b4,
	gold: 0xffe6a6,
	mauve: 0x7a4f8c,
	haze: 0xeef1e2,
	deepBase: 0x03090b,
	deepGlow: 0x0e3a44,
	// The abyss, past the teal: near-black navy, lit only by faint glows drifting round the edges.
	// The glows are our cobalt, mauve and a slate-teal, darkened right down.
	abyssBase: 0x04060a,
	abyssCobalt: 0x1f2c4a,
	abyssMauve: 0x2a2440,
	abyssSlate: 0x18303b,
	// Daytime above the water: a pale pink haze at the horizon, light blue overhead.
	skyHorizon: 0xf3d9e4,
	skyZenith: 0x8fc7ec
};

function displayColor(hex: number): THREE.Vector3 {
	return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/*
 * The light is one wide open cone hanging from the opening, drawn additively. Its fragment shader
 * fades it by how squarely the surface faces the camera: the middle of the cone (seen face-on) is
 * bright and the silhouette (seen edge-on) falls to nothing, so it reads as a soft volume rather
 * than a hollow tube. Both the near and far walls draw, which gives the shafts some parallax.
 *
 * Shafts are noise around the cone's circumference rather than separate meshes, drifting slowly.
 * Near the surface their contrast is low, so the cone reads as one even column of light; as you
 * sink the contrast rises, and it breaks into rays while the whole cone fades out.
 */
const coneVertexShader = /* glsl */ `
	varying vec3 vNormal;
	varying vec3 vViewPosition;
	varying vec2 vUv;

	void main() {
		vUv = uv;
		vNormal = normalize(normalMatrix * normal);
		vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
		vViewPosition = viewPosition.xyz;
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const coneFragmentShader = /* glsl */ `
	uniform float uTime;
	uniform float uDepth;
	uniform float uIntensity;
	uniform vec3 uWarm;
	uniform vec3 uCool;

	varying vec3 vNormal;
	varying vec3 vViewPosition;
	varying vec2 vUv;

	float hash(float n) {
		return fract(sin(n * 12.9898) * 43758.5453);
	}

	// Value noise that repeats every period units, so it wraps around the cone without a seam.
	float loopNoise(float x, float period) {
		float i = floor(x);
		float f = fract(x);
		float a = hash(mod(i, period));
		float b = hash(mod(i + 1.0, period));
		return mix(a, b, f * f * (3.0 - 2.0 * f));
	}

	void main() {
		// With multisampling, uv can land just outside 0..1 at the cone's rim, and pow() of a negative
		// is undefined (it drew black outlines), so clamp first.
		vec2 uv = clamp(vUv, 0.0, 1.0);
		float facing = abs(dot(normalize(vNormal), normalize(-vViewPosition)));
		float edge = pow(facing, 2.0);
		// uv.y runs 0 at the wide bottom to 1 at the opening; fade out downwards and soften the top cut.
		float along = pow(uv.y, 1.4) * smoothstep(1.0, 0.9, uv.y);

		// How ray-like the light is: barely at the surface, clearly by halfway down.
		float rays = smoothstep(0.05, 0.6, uDepth);
		// Two layers of noise around the circumference, drifting slowly in opposite directions.
		// Drift is in noise cells per second (one cell is roughly one shaft). Keep the speed constant:
		// scaling it by depth multiplies the change by the elapsed time, so scrolling made the
		// shafts jump.
		float drift = uTime * 0.04;
		float n = 0.6 * loopNoise(uv.x * 40.0 + drift, 40.0)
			+ 0.4 * loopNoise(uv.x * 72.0 - drift * 0.7 + 7.0, 72.0);
		float shafts = mix(1.0, n * n * 2.4, mix(0.1, 0.5, rays));

		// Warm near the opening, cooling to cyan further down the cone.
		vec3 color = mix(uCool, uWarm, smoothstep(0.55, 1.0, uv.y));
		// The light is gone by the bottom of the scroll, so the cone's far end never shows.
		float fade = 1.0 - smoothstep(0.45, 0.85, uDepth);
		gl_FragColor = vec4(color * edge * along * shafts * uIntensity * fade, 1.0);
	}
`;

/*
 * The water surface: one plane the camera sinks through, drawn as two meshes with their own
 * shaders, one per side (each mesh only draws its own side, and the side the camera can't see
 * is switched off).
 *
 * Underneath (most of the scroll): a rippling ceiling with soft light patches and one connected
 * net of caustic lines, tinted from the palette and fading into the distance. The ripple slopes
 * come from smooth gradient noise with time as its third dimension (so the pattern evolves rather
 * than slides), like the ripple stinger in ../transitions. The lines are the edges of a cell
 * pattern, so they meet at junctions like real caustics, bent hard by the slopes and finer noise
 * so they curve and drift, with some stretches fading out. Line width gets an extra pixel or so
 * based on how fast the pattern changes on screen (fwidth), so distant lines don't shimmer.
 *
 * On top (only before the plunge): lit water. A ripple height field (broad swells plus finer
 * wavelets) gives each pixel a surface slope; that tilts the reflection of an astral sky (rose-gold and cyan glow low down, mauve, cobalt overhead),
 * mixed with the water's own deep colour by the Fresnel effect (more reflection the flatter you
 * look across it), with tiny sharp highlights. Detail fades with distance, so the far water
 * settles into a calm reflection instead of shimmering. (Painted veils and streaks in the style
 * of the vortex stinger were tried first; they looked plastic, because real water's look comes
 * from light on the ripples' many slopes.)
 */
const surfaceVertexShader = /* glsl */ `
	varying vec3 vWorldPosition;

	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vWorldPosition = worldPosition.xyz;
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

/** Smooth 3D gradient noise and fbm, shared by both sides of the water surface. */
const noiseGlsl = /* glsl */ `
	// Well-mixed -1..1 gradient per lattice point (Dave Hoskins' hash33).
	vec3 hash3(vec3 p) {
		p = fract(p * vec3(0.1031, 0.103, 0.0973));
		p += dot(p, p.yxz + 33.33);
		return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
	}

	// 3D gradient noise, roughly -1..1. Quintic blending keeps it smooth, so unlike value noise
	// there's no visible grid.
	float gnoise(vec3 p) {
		vec3 i = floor(p);
		vec3 f = fract(p);
		vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
		float n000 = dot(hash3(i), f);
		float n100 = dot(hash3(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0));
		float n010 = dot(hash3(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0));
		float n110 = dot(hash3(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0));
		float n001 = dot(hash3(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0));
		float n101 = dot(hash3(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0));
		float n011 = dot(hash3(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0));
		float n111 = dot(hash3(i + vec3(1.0)), f - vec3(1.0));
		return 1.8 * mix(
			mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
			mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
			u.z
		);
	}

	// Three octaves, each rotated so their lattices don't line up. Roughly -1..1.
	float fbm(vec3 p) {
		const mat3 turn = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
		float n = gnoise(p) * 0.57;
		p = turn * p * 2.03;
		n += gnoise(p) * 0.29;
		p = turn * p * 2.03;
		return n + gnoise(p) * 0.14;
	}
`;

const surfaceBelowFragmentShader = /* glsl */ `
	${noiseGlsl}
	uniform float uTime;
	uniform float uDepth;
	uniform float uIntensity;
	uniform vec3 uRose;
	uniform vec3 uCyan;
	uniform vec3 uGold;
	uniform vec3 uMauve;

	varying vec3 vWorldPosition;

	// Distance to the nearest cell edge (second-nearest minus nearest centre distance). Each cell's
	// centre circles slowly at its own phase.
	float cellEdge(vec2 p, float t) {
		vec2 cell = floor(p);
		vec2 f = fract(p);
		float nearest = 8.0;
		float second = 8.0;
		for (int j = -1; j <= 1; j++) {
			for (int i = -1; i <= 1; i++) {
				vec2 g = vec2(float(i), float(j));
				vec2 o = hash3(vec3(cell + g, 0.0)).xy;
				o = 0.5 + 0.35 * sin(t + 3.1416 * o);
				float d = length(g + o - f);
				if (d < nearest) {
					second = nearest;
					nearest = d;
				} else if (d < second) {
					second = d;
				}
			}
		}
		return second - nearest;
	}

	void main() {
		vec2 p = vWorldPosition.xz;
		vec3 toSurface = vWorldPosition - cameraPosition;
		float dist = length(toSurface);
		// Ripple slopes, evolving slowly.
		vec3 q = vec3(p * 0.3, uTime * 0.12);
		vec2 slope = vec2(fbm(q), fbm(q + vec3(5.2, 1.3, 0.0)));

		// One layer of caustic lines: the edges of cells about 1.5 m across, bent hard by the slopes
		// and again by finer noise, so the outlines lose their polygon shape. A soft glow around
		// each line keeps them from looking drawn.
		vec2 detail = vec2(gnoise(vec3(p * 1.3, uTime * 0.3)), gnoise(vec3(p * 1.3 + 7.0, uTime * 0.3)));
		float e = cellEdge(p * 0.65 + slope * 1.5 + detail * 0.25, uTime * 0.25);
		float line = 1.0 - smoothstep(0.0, 0.05 + fwidth(e) * 1.5, e);
		line += exp(-e * 8.0) * 0.3;
		// Lines are brightest where the light focuses and dimmer elsewhere, and some stretches fade
		// out altogether, so the net never reads as a complete grid of cells.
		line *= mix(0.3, 1.0, smoothstep(-0.4, 0.4, slope.x - slope.y));
		line *= mix(0.1, 1.0, smoothstep(-0.45, 0.25, gnoise(vec3(p * 0.9 + 3.0, uTime * 0.15))));

		// Ripple sheen: small wavelets catching the light, over broader patches where the whole
		// surface tilts towards it.
		float wavelets = fbm(vec3(p * 1.1 + slope * 0.8, uTime * 0.25));
		float sheen = smoothstep(0.05, 0.55, wavelets) * 0.6 + smoothstep(0.0, 0.6, slope.x + slope.y * 0.5) * 0.4;

		// Large slow patches of colour across the surface.
		float hue = fbm(vec3(p * 0.03 + 40.0, uTime * 0.01)) * 0.5 + 0.5;
		vec3 tint = mix(uRose, uCyan, smoothstep(0.3, 0.6, hue));
		tint = mix(tint, uGold, smoothstep(0.65, 0.85, hue) * 0.6);
		tint = mix(tint, uMauve, smoothstep(0.35, 0.15, hue) * 0.5);

		// Fade with distance and towards the horizon, where the plane is seen nearly edge-on and
		// the lines would crowd together.
		float grazing = abs(toSurface.y) / max(dist, 0.001);
		float visible = exp(-dist * 0.07) * smoothstep(0.03, 0.3, grazing);

		float light = line * 0.7 + sheen * 0.3 + 0.04;
		vec3 color = tint * light * visible;
		// The light is gone deep down; the surface is far overhead by then anyway.
		float fade = 1.0 - smoothstep(0.35, 0.75, uDepth);
		gl_FragColor = vec4(color * uIntensity * fade, 1.0);
	}
`;

const surfaceAboveFragmentShader = /* glsl */ `
	${noiseGlsl}
	uniform float uTime;
	uniform float uIntensity;
	uniform vec3 uCobalt;
	uniform vec3 uCyan;
	uniform vec3 uHaze;
	uniform vec3 uRose;
	uniform vec3 uMauve;
	uniform vec3 uGold;
	uniform vec3 uLightDirection;
	uniform vec2 uGlowCentre; // x, z
	uniform vec3 uSkyHorizon;
	uniform vec3 uSkyZenith;
	uniform float uGlowRadius;

	varying vec3 vWorldPosition;

	// Ripple height: broad swells plus finer wavelets, each evolving at its own pace. Each layer
	// is turned by a different angle so the noise's square grids never line up with each other or
	// the view. The finer layers fade as a pixel's footprint grows: once a layer's ripples are
	// smaller than a couple of pixels, sampling them just makes moire, which on the noise grid
	// showed up as moving straight lines.
	float rippleHeight(vec2 p, float t, float footprint) {
		float h = fbm(vec3(mat2(0.96, 0.28, -0.28, 0.96) * p * 0.6, t * 0.2));
		h += fbm(vec3(mat2(0.6, 0.8, -0.8, 0.6) * p * 1.9 + 5.0, t * 0.45)) * 0.4
			* smoothstep(0.35, 0.12, footprint);
		h += gnoise(vec3(mat2(0.28, -0.96, 0.96, 0.28) * p * 5.3 + 11.0, t * 0.9)) * 0.12
			* smoothstep(0.1, 0.035, footprint);
		return h;
	}

	void main() {
		vec2 p = vWorldPosition.xz;
		float t = uTime;
		vec3 toSurface = vWorldPosition - cameraPosition;
		float dist = length(toSurface);
		vec3 view = toSurface / max(dist, 0.001);

		// How much water one pixel covers (metres). Fine ripple layers fade as it grows, and the
		// far water flattens into a calm reflection, as it does in real life.
		float footprint = length(fwidth(p));
		float detail = exp(-dist * 0.12);
		float strength = mix(0.15, 0.6, detail);

		// The surface's slope at this point, from the height a few centimetres either side.
		const float e = 0.03;
		float h = rippleHeight(p, t, footprint);
		float hx = rippleHeight(p + vec2(e, 0.0), t, footprint);
		float hz = rippleHeight(p + vec2(0.0, e), t, footprint);
		vec3 normal = normalize(vec3(-(hx - h) / e * strength, 1.0, -(hz - h) / e * strength));

		// What the water reflects: the daytime sky, pink haze at the horizon to light blue overhead.
		vec3 reflected = reflect(view, normal);
		vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.45, reflected.y));
		// Fresnel: water reflects more the flatter you look across it, and shows its own colour
		// when you look down into it.
		float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
		// Its own colour, like a pool on a sunny day: bright aqua, paler where the ripples crest.
		vec3 body = mix(uCyan, uCobalt, 0.25);
		body = mix(body, mix(uCyan, uHaze, 0.5), smoothstep(0.2, 0.7, h) * 0.3);

		// What makes it magical: soft blobs of rose, mauve and violet drifting through the water on
		// their own slow loops, like the gradients under the surface. Their outlines are bent by
		// noise so they aren't circles. They colour the water, and also glow up through the
		// reflection a little, since at a low angle the reflection would otherwise hide them.
		vec2 bp = p + vec2(fbm(vec3(p * 0.08, t * 0.03)), fbm(vec3(p * 0.08 + 9.0, t * 0.03))) * 5.0;
		vec3 tint = vec3(0.0);
		float tintWeight = 0.0;
		for (int i = 0; i < 6; i++) {
			float fi = float(i);
			float angle = fi * 2.39996 + t * (0.03 + fi * 0.007) * (mod(fi, 2.0) * 2.0 - 1.0);
			vec2 centre = uGlowCentre + vec2(cos(angle), sin(angle) * 0.7) * (5.0 + fi * 4.5);
			float radius = 3.2 + 1.0 * sin(t * 0.05 + fi * 1.9) + fi * 0.4;
			vec2 d = bp - centre;
			float w = exp(-dot(d, d) / (radius * radius));
			vec3 c = i == 0 || i == 3 || i == 5 ? uRose : i == 1 ? uMauve : i == 2 ? mix(uMauve, uCobalt, 0.5) : mix(uRose, uGold, 0.35);
			tint += c * w;
			tintWeight += w;
		}
		// A clear edge to each patch, so blue water shows between them.
		float magic = smoothstep(0.2, 0.75, tintWeight);
		tint /= max(tintWeight, 0.001);
		body = mix(body, tint, magic * 0.7);

		vec3 color = mix(body * 0.8, sky, fresnel);
		color = mix(color, tint * 1.05, magic * (1.0 - 0.45 * fresnel) * 0.35);

		// Lit from inside: a glow in the water, strongest around the pool and fading outwards, with
		// a warm gold heart in cyan and mauve. It comes out through the surface on top of the
		// reflection (only a little less where you look across the water rather than into it), and
		// most through thin wave crests.
		float glowFalloff = exp(-pow(length(p - uGlowCentre) / uGlowRadius, 2.0) * 2.0);
		vec3 innerColor = mix(mix(uCyan, uMauve, 0.3), mix(uGold, uRose, 0.4), glowFalloff * glowFalloff);
		float crest = smoothstep(-0.1, 0.6, h);
		color += innerColor * glowFalloff * (0.3 + 0.7 * crest) * (1.0 - 0.5 * fresnel) * 0.25;
		// Sun glints where a ripple faces the light above exactly.
		color += vec3(1.0, 0.97, 0.9) * pow(max(dot(reflected, uLightDirection), 0.0), 300.0) * detail;

		// Far water fades into the horizon haze, so it meets the sky without a seam.
		float visible = exp(-dist * 0.025);
		gl_FragColor = vec4(mix(uSkyHorizon, color * uIntensity, visible), 1.0);
	}
`;

/*
 * Bubbles, drawn as camera-facing quads; everything about their motion is worked out in the
 * vertex shader from time, so nothing is updated per bubble on the CPU.
 *
 * Burst bubbles (aKind 0) start around the point where the camera went through the surface.
 * They're dragged down for a moment, then rise and spread out, wobbling, and pop when they
 * reach the surface. Drifting bubbles (aKind 1) rise forever in a band that wraps around the
 * camera's height, so as the camera sinks they stream up past it.
 *
 * The fragment shader aims for a photographed bubble rather than a drawn one: a soft silvery
 * edge that brightens towards the outline, a nearly clear middle, a small sharp highlight on top
 * and a faint bright crescent at the bottom (light from above, refracted through the bubble).
 * Bigger bubbles are flattened and their outline wobbles, and bubbles close to the camera are
 * out of focus, with blurred edges.
 */
const bubbleVertexShader = /* glsl */ `
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater;
	uniform float uBurstTime;
	uniform vec3 uBurstOrigin;
	uniform float uWaterLevel;
	uniform float uDriftRange;

	attribute vec3 aStart; // burst: offset from the origin; drift: world x/z and a starting height
	attribute float aSize;
	attribute float aSpeed;
	attribute float aPhase;
	attribute float aKind;

	varying vec2 vUv;
	varying float vAlpha;
	varying float vBig;
	varying float vBlur;
	varying float vPhase;

	void main() {
		vec3 centre;
		float alpha;
		if (aKind < 0.5) {
			float age = uTime - uBurstTime;
			// Dragged down by the plunge, easing off, while buoyancy takes over.
			float drag = 0.8 * (1.0 - exp(-age * 2.5));
			centre = uBurstOrigin + vec3(aStart.x, 0.0, aStart.z) * (1.0 + age * 0.25);
			centre.y += aStart.y - drag + aSpeed * age;
			alpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(5.0, 8.0, age));
		} else {
			// Wrap the rising height into a band centred on the camera.
			float rise = aStart.y + aSpeed * uTime - cameraPosition.y;
			float y = mod(rise, uDriftRange) - uDriftRange * 0.5;
			centre = vec3(aStart.x, cameraPosition.y + y, aStart.z);
			// Fade at the band's ends so wrapping doesn't pop.
			alpha = smoothstep(0.5, 0.35, abs(y / uDriftRange)) * 0.7;
		}
		// Wobble side to side as they rise.
		centre.x += sin(uTime * 2.7 + aPhase) * 0.04;
		centre.z += cos(uTime * 2.1 + aPhase * 1.7) * 0.04;
		// Pop at the surface, and only exist under it.
		alpha *= smoothstep(uWaterLevel, uWaterLevel - 0.15, centre.y) * uUnderwater;
		// Less light reaches them deeper down.
		alpha *= mix(1.0, 0.3, smoothstep(0.0, 0.8, uDepth));

		vec4 viewPosition = modelViewMatrix * vec4(centre, 1.0);
		// Out of focus when very close to the camera.
		float blur = mix(0.06, 0.4, smoothstep(1.6, 0.4, -viewPosition.z));

		vUv = position.xy * 2.0;
		// Blurring spreads the same light over a bigger area, so it gets dimmer.
		vAlpha = alpha * (1.0 - blur * 0.6);
		vBig = smoothstep(0.02, 0.05, aSize);
		vBlur = blur;
		vPhase = aPhase;
		viewPosition.xy += position.xy * aSize * 2.0;
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const bubbleFragmentShader = /* glsl */ `
	uniform vec3 uColor;
	uniform float uTime;

	varying vec2 vUv;
	varying float vAlpha;
	varying float vBig;
	varying float vBlur;
	varying float vPhase;

	void main() {
		if (vAlpha <= 0.0) discard;
		// Flatten big bubbles (they rise as squashed, wobbling caps) and wobble their outline.
		vec2 q = vec2(vUv.x, vUv.y / mix(1.0, 0.8, vBig));
		float angle = atan(q.y, q.x);
		float wobble = sin(angle * 3.0 + uTime * 5.0 + vPhase) * 0.6 + sin(angle * 2.0 - uTime * 3.7 + vPhase * 2.0) * 0.4;
		// Leave a margin inside the quad so blurred edges aren't cut off.
		float radius = 0.72 * (1.0 + wobble * 0.07 * vBig);
		float r = length(q) / radius;
		float inside = 1.0 - smoothstep(1.0 - vBlur, 1.0 + vBlur * 0.3, r);
		if (inside <= 0.0) discard;

		float up = q.y / radius;
		// Thin silvery edge, lit mostly from above: bright along the top, fading down the sides.
		float edge = pow(min(r, 1.0), 16.0) * inside * mix(0.15, 1.0, smoothstep(-0.3, 0.9, up));
		// Light from above refracted to the bottom of the bubble, and a faint wash of it inside;
		// this is what gives it volume rather than the outline.
		float crescent = smoothstep(0.5, 0.92, r) * smoothstep(0.0, -0.75, up) * inside * 0.4;
		float wash = (1.0 - r * r) * smoothstep(0.6, -0.8, up) * inside * 0.06;
		// Small sharp highlight, slightly stretched sideways, and a fainter one low on the far side;
		// both smear out when out of focus.
		float sharpness = mix(160.0, 25.0, vBlur);
		vec2 h = (q / radius - vec2(-0.32, 0.5)) * vec2(1.0, 1.6);
		vec2 h2 = (q / radius - vec2(0.4, -0.55)) * vec2(1.0, 2.0);
		float highlight = exp(-dot(h, h) * sharpness) * 0.85 + exp(-dot(h2, h2) * sharpness) * 0.2;

		vec3 light = uColor * (edge * 0.45 + crescent + wash) + vec3(1.0) * highlight;
		gl_FragColor = vec4(light * vAlpha, 1.0);
	}
`;

/*
 * Marine snow: tiny specks drawn as GPU points. Each drifts slowly down with a lazy swirl, and
 * its position wraps inside a box kept in front of the camera, so as the camera sinks the
 * specks stream up past it. A speck's brightness is how much light reaches it: all of it inside
 * the light cone, about a third outside, and none once the light is gone deep down (the same
 * fade as the cone), so the snow disappears in the dark.
 */
const snowVertexShader = /* glsl */ `
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater;
	uniform float uWaterLevel;
	uniform vec3 uBox;
	uniform vec3 uConeTop; // centre of the opening
	uniform vec2 uCone; // radius at the top, tan of the spread
	uniform float uPointScale; // pixels per metre at 1 m away

	attribute float aSize;
	attribute float aPhase;

	varying float vAlpha;

	void main() {
		vec3 drift = position;
		drift.y -= uTime * (0.02 + fract(aPhase * 7.3) * 0.03);
		drift.x += sin(uTime * 0.15 + aPhase) * 0.3;
		drift.z += cos(uTime * 0.12 + aPhase * 1.7) * 0.3;
		// Wrap into the box: centred on the camera across and up/down, in front of it in depth.
		vec3 boxMin = cameraPosition + vec3(-0.5 * uBox.x, -0.5 * uBox.y, -uBox.z);
		vec3 rel = mod(drift - boxMin, uBox);
		vec3 world = boxMin + rel;
		// Fade near the box's walls so wrapping doesn't pop.
		vec3 n = rel / uBox;
		vec3 walls = smoothstep(0.0, 0.1, n) * smoothstep(1.0, 0.85, n);

		// Light reaching the speck: inside the cone, some ambient outside, gone in the deep.
		float below = uWaterLevel - world.y;
		float coneRadius = uCone.x + max(below, 0.0) * uCone.y;
		float inCone = smoothstep(coneRadius * 1.1, coneRadius * 0.6, length(world.xz - uConeTop.xz));
		float light = mix(0.35, 1.0, inCone) * (1.0 - smoothstep(0.4, 0.85, uDepth));

		vec4 viewPosition = viewMatrix * vec4(world, 1.0);
		float pixels = aSize * uPointScale / -viewPosition.z;
		// Specks smaller than a couple of pixels would flicker; draw them at that size, dimmer.
		gl_PointSize = max(pixels, 2.0);
		float coverage = min(pixels / 2.0, 1.0);

		vAlpha = light * coverage * walls.x * walls.y * walls.z * uUnderwater * step(0.0, below);
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const snowFragmentShader = /* glsl */ `
	uniform vec3 uColor;

	varying float vAlpha;

	void main() {
		float r = length(gl_PointCoord - 0.5) * 2.0;
		float speck = 1.0 - smoothstep(0.2, 1.0, r);
		if (speck <= 0.0 || vAlpha <= 0.0) discard;
		gl_FragColor = vec4(uColor * speck * vAlpha * 0.9, 1.0);
	}
`;

/*
 * Soft colour blobs for the background glow, placed around the edges so the middle stays clear
 * for the light. x/y run -1..1 across the screen's width/height; radius is in screen heights.
 * Near the surface each glows in its own colour; deep down they all turn a dim teal.
 */
const BLOBS: { x: number; y: number; radius: number; color: keyof typeof PALETTE }[] = [
	{ x: -0.85, y: 0.55, radius: 0.45, color: 'cyan' },
	{ x: 0.85, y: 0.5, radius: 0.5, color: 'rose' },
	{ x: -0.8, y: -0.55, radius: 0.5, color: 'mauve' },
	{ x: 0.8, y: -0.6, radius: 0.45, color: 'gold' },
	{ x: 0.1, y: 0.9, radius: 0.55, color: 'cobalt' },
	{ x: -0.15, y: -0.95, radius: 0.5, color: 'cyan' }
];

/*
 * Bloom, between the scene render and the composite. The scene's bright parts are shrunk to 1/4
 * size, then halved again at each level, softening at each step, then enlarged back up step by step, adding each
 * level back in, which gives a wide, smooth glow for a few cheap low-resolution passes. The
 * filters are the dual-filter kind (5 taps down, 8 taps up), weighted so the result has no
 * blocky steps. Only the 3D scene glows; the background colours are added afterwards.
 */
const bloomDownShader = /* glsl */ `
	uniform sampler2D tInput;
	uniform vec2 uTexel; // one texel of the input
	uniform float uPrefilter; // 1 on the first pass: keep only the bright parts
	uniform float uThreshold;
	uniform float uKnee;

	varying vec2 vUv;

	void main() {
		vec3 c = texture2D(tInput, vUv).rgb * 4.0;
		c += texture2D(tInput, vUv - uTexel).rgb;
		c += texture2D(tInput, vUv + uTexel).rgb;
		c += texture2D(tInput, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
		c += texture2D(tInput, vUv - vec2(uTexel.x, -uTexel.y)).rgb;
		c /= 8.0;
		if (uPrefilter > 0.5) {
			float brightness = max(c.r, max(c.g, c.b));
			c *= smoothstep(uThreshold, uThreshold + uKnee, brightness);
		}
		gl_FragColor = vec4(c, 1.0);
	}
`;

const bloomUpShader = /* glsl */ `
	uniform sampler2D tLow; // the smaller, already-blurred level
	uniform sampler2D tHigh; // this level's downsampled image, added back in
	uniform vec2 uTexel; // one texel of tLow

	varying vec2 vUv;

	void main() {
		vec2 t = uTexel;
		vec3 c = texture2D(tLow, vUv + vec2(-2.0 * t.x, 0.0)).rgb;
		c += texture2D(tLow, vUv + vec2(2.0 * t.x, 0.0)).rgb;
		c += texture2D(tLow, vUv + vec2(0.0, 2.0 * t.y)).rgb;
		c += texture2D(tLow, vUv + vec2(0.0, -2.0 * t.y)).rgb;
		c += texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb * 2.0;
		c += texture2D(tLow, vUv + vec2(t.x, t.y)).rgb * 2.0;
		c += texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb * 2.0;
		c += texture2D(tLow, vUv + vec2(-t.x, -t.y)).rgb * 2.0;
		gl_FragColor = vec4(c / 12.0 + texture2D(tHigh, vUv).rgb, 1.0);
	}
`;

/*
 * Final full-screen pass, run after the 3D scene is drawn into an offscreen target. There's no
 * fog or smoke: the water's atmosphere is all here, in screen space.
 * - Base colour: a smooth lift under everything, so dark areas read as water instead of black.
 * - Glow: the blobs above, each a Gaussian falloff drifting on its own slow loop and breathing in
 *   brightness. Sinking nudges them upward, so scrolling stirs them as well as time.
 * - Vignette and slight colour fringing towards the edges.
 * - Grain: per-pixel noise that changes every frame; hides banding and reads as murk.
 * Everything blends from the shallow palette to the deep one as depth goes 0 -> 1, and all of it
 * only applies once the camera is under the surface.
 */
const compositeVertexShader = /* glsl */ `
	varying vec2 vUv;

	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;

const compositeFragmentShader = /* glsl */ `
	uniform sampler2D tScene;
	uniform sampler2D tBloom;
	uniform float uBloomStrength;
	uniform vec2 uResolution;
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater; // 0 above the surface, 1 below
	uniform vec4 uBlobs[BLOB_COUNT]; // x, y, radius, phase
	uniform vec3 uBlobColors[BLOB_COUNT];
	uniform vec3 uCobalt;
	uniform vec3 uRose;
	uniform vec3 uDeepBase;
	uniform vec3 uDeepGlow;
	uniform vec3 uAbyssBase;
	uniform vec3 uSkyHorizon;
	uniform vec3 uSkyZenith;
	uniform vec3 uAbyssLights[3];

	varying vec2 vUv;

	// Well-mixed 0..1 hash (Dave Hoskins' hash12). Cheaper hashes repeat every few dozen pixels on
	// whole-pixel coordinates, which made the grain show up as regular banding.
	float hash(vec2 p) {
		vec3 p3 = fract(vec3(p.xyx) * 0.1031);
		p3 += dot(p3, p3.yzx + 33.33);
		return fract((p3.x + p3.y) * p3.z);
	}

	void main() {
		// Colour fringing: red and blue sampled slightly apart, growing towards the edges (about 5px
		// in the corners), like looking through water. Underwater only.
		vec2 fromCentre = vUv - 0.5;
		vec2 fringe = fromCentre * dot(fromCentre, fromCentre) * 0.012 * uUnderwater;
		vec3 scene = vec3(
			texture2D(tScene, vUv + fringe).r,
			texture2D(tScene, vUv).g,
			texture2D(tScene, vUv - fringe).b
		);
		// Centred coordinates in screen heights, so blobs are round rather than stretched.
		float aspect = uResolution.x / uResolution.y;
		vec2 halfSize = vec2(aspect, 1.0) * 0.5;
		vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
		// 0 = shallow and magical, 1 = deep and dark; most of the light is gone by 80% of the way down.
		float deep = smoothstep(0.0, 0.7, uDepth);
		// Past the teal, the abyss: 0 until 72% of the way down, 1 by 95%.
		float abyss = smoothstep(0.72, 0.95, uDepth);

		// Base: cobalt below, warming to rose towards the top of the screen (towards the light).
		vec3 shallowBase = mix(uCobalt * 0.2, uRose * 0.24, smoothstep(-0.5, 0.5, p.y));
		vec3 base = mix(mix(shallowBase, uDeepBase, deep), uAbyssBase, abyss);

		vec3 glow = vec3(0.0);
		for (int i = 0; i < BLOB_COUNT; i++) {
			vec4 blob = uBlobs[i];
			float phase = blob.w;
			vec2 centre = blob.xy * halfSize;
			centre += vec2(sin(uTime * 0.07 + phase), cos(uTime * 0.053 + phase * 1.3)) * 0.12;
			centre.y += uDepth * 0.25;
			vec2 d = p - centre;
			float weight = exp(-dot(d, d) / (blob.z * blob.z));
			weight *= 0.75 + 0.25 * sin(uTime * 0.13 + phase * 2.0);
			vec3 deepColor = uDeepGlow * mix(vec3(0.85, 1.0, 1.1), vec3(1.1, 1.0, 0.85), fract(phase));
			glow += mix(uBlobColors[i] * 0.4, deepColor * 0.85, deep) * weight;
		}
		// Deep down, pull what's left of the glow out to the edges, Active Theory style.
		glow *= mix(1.0, smoothstep(0.25, 0.9, length(p)), deep);

		// The abyss's only light: three big, faint glows creeping round just outside the frame, so
		// only their edges bleed in, like light moving somewhere out of view. Alternate ones go the
		// other way, each slowly swells and shrinks, and scrolling nudges them round.
		vec3 abyssGlow = vec3(0.0);
		for (int i = 0; i < 3; i++) {
			float fi = float(i);
			float direction = mod(fi, 2.0) * 2.0 - 1.0;
			float angle = fi * 2.094 + uTime * (0.03 + fi * 0.008) * direction + uDepth * 1.5;
			vec2 centre = vec2(cos(angle), sin(angle)) * (halfSize + 0.15);
			vec2 d = p - centre;
			float radius = 0.55 + 0.15 * sin(uTime * 0.07 + fi * 2.0);
			abyssGlow += uAbyssLights[i] * exp(-dot(d, d) / (radius * radius)) * 0.7;
		}
		glow = mix(glow, abyssGlow, abyss);

		// Above the water the air is clear: just the scene, no water colour or grain.
		vec3 color = scene + texture2D(tBloom, vUv).rgb * uBloomStrength + (base + glow) * uUnderwater;

		// Above the water: a daytime sky above the horizon. The camera always looks level, so the
		// horizon is always the middle of the screen; the far water fades into the same horizon
		// colour, so the join doesn't show.
		vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.5, 1.0, vUv.y));
		color = mix(color, sky, smoothstep(0.485, 0.5, vUv.y) * (1.0 - uUnderwater));

		// Vignette: darker corners, more so deeper down. Underwater only.
		float vignette = smoothstep(1.2, 0.35, length(p));
		// Lighter in the abyss, where the light lives at the edges.
		color *= mix(1.0, vignette, mix(mix(0.35, 0.6, deep), 0.3, abyss) * uUnderwater);

		// Two hashes summed give a triangular distribution, which dithers dark gradients more evenly.
		vec2 seed = gl_FragCoord.xy + fract(uTime * 0.37) * vec2(1013.0, 619.0);
		float grain = hash(seed) + hash(seed + 71.3) - 1.0;
		color += grain * mix(0.03, 0.045, deep) * uUnderwater;

		gl_FragColor = vec4(max(color, 0.0), 1.0);
	}
`;

export class SmokeScene {
	private readonly scene = new THREE.Scene();
	// Far enough to draw the water out to the horizon; there's no depth buffer, so it costs nothing.
	private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
	private readonly renderer: THREE.WebGLRenderer;
	private readonly timer = new THREE.Timer();
	// One uniform object shared by every material, so a single write per frame moves everything.
	private readonly time = { value: 0 };
	// Shared the same way: 0 just under the pool, 1 at the bottom of the scroll.
	private readonly depth = { value: 0 };
	// The 3D scene renders here first; the composite pass then draws it to the screen.
	// 8 bits per channel: the background gradients are added later in the composite, so this only
	// holds the light, and the grain added on top dithers its faint ends. No multisampling: it
	// would hold several copies of every pixel, and nothing here has hard edges that need it (the
	// caustic lines smooth themselves). No depth buffer: everything in the scene is additive and
	// never writes depth, so draw order doesn't matter.
	private readonly sceneTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
	// 0 while the camera is above the surface, 1 once it's below.
	private readonly underwater = { value: 0 };
	// When and where the camera last plunged through the surface; starts the bubble burst.
	private readonly burstTime = { value: -1000 };
	private readonly burstOrigin = { value: new THREE.Vector3() };
	private readonly bubbles: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
	private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly composite: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly compositeScene = new THREE.Scene();
	// Bloom chain: bloomDown[i] is 1/2^(i+2) size; bloomUp[i] matches bloomDown[i] and holds the
	// glow built back up from the smaller levels. bloomUp[0] is the finished glow.
	private readonly bloomDown = Array.from(
		{ length: BLOOM_LEVELS },
		() => new THREE.WebGLRenderTarget(1, 1, BLOOM_TARGET_OPTIONS)
	);
	private readonly bloomUp = Array.from(
		{ length: BLOOM_LEVELS - 1 },
		() => new THREE.WebGLRenderTarget(1, 1, BLOOM_TARGET_OPTIONS)
	);
	private readonly bloomDownMaterial = new THREE.ShaderMaterial({
		vertexShader: compositeVertexShader,
		fragmentShader: bloomDownShader,
		uniforms: {
			tInput: { value: null },
			uTexel: { value: new THREE.Vector2() },
			uPrefilter: { value: 0 },
			uThreshold: { value: BLOOM_THRESHOLD },
			uKnee: { value: BLOOM_KNEE }
		},
		depthTest: false,
		depthWrite: false
	});
	private readonly bloomUpMaterial = new THREE.ShaderMaterial({
		vertexShader: compositeVertexShader,
		fragmentShader: bloomUpShader,
		uniforms: {
			tLow: { value: null },
			tHigh: { value: null },
			uTexel: { value: new THREE.Vector2() }
		},
		depthTest: false,
		depthWrite: false
	});
	// One full-screen quad, given whichever bloom material the pass needs.
	private readonly bloomQuad = new THREE.Mesh(
		new THREE.PlaneGeometry(2, 2),
		this.bloomDownMaterial
	);
	private readonly bloomScene = new THREE.Scene().add(this.bloomQuad);
	private targetDepth = 0;
	// Reduced motion holds the scene still on its first frame and follows the scroll exactly.
	private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	private readonly cone: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
	private readonly surfaceGeometry = new THREE.PlaneGeometry(SURFACE_SIZE, SURFACE_SIZE).rotateX(
		Math.PI / 2
	);
	private readonly surfaceBelow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly surfaceAbove: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

	constructor(canvas: HTMLCanvasElement) {
		// No antialiasing or depth buffer on the canvas: only the full-screen composite is drawn to it.
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, depth: false });
		const touch = window.matchMedia('(pointer: coarse)').matches;
		this.renderer.setPixelRatio(
			Math.min(window.devicePixelRatio, touch ? TOUCH_PIXEL_RATIO : MAX_PIXEL_RATIO)
		);
		this.renderer.setClearColor(0x000000, 1);

		this.cone = this.createCone();
		// Laid flat, the plane faces down, so its front is the underside.
		this.surfaceBelow = this.createSurface(surfaceBelowFragmentShader, THREE.FrontSide, {
			uDepth: this.depth,
			uRose: { value: displayColor(PALETTE.rose) },
			uCyan: { value: displayColor(PALETTE.cyan) },
			uGold: { value: displayColor(PALETTE.gold) },
			uMauve: { value: displayColor(PALETTE.mauve) }
		});
		this.surfaceAbove = this.createSurface(surfaceAboveFragmentShader, THREE.BackSide, {
			uCobalt: { value: displayColor(PALETTE.cobalt) },
			uCyan: { value: displayColor(PALETTE.cyan) },
			uHaze: { value: displayColor(PALETTE.haze) },
			uRose: { value: displayColor(PALETTE.rose) },
			uMauve: { value: displayColor(PALETTE.mauve) },
			uGold: { value: displayColor(PALETTE.gold) },
			uLightDirection: { value: SKY_LIGHT_DIRECTION },
			uGlowCentre: { value: new THREE.Vector2(OPENING_CENTRE.x, OPENING_CENTRE.z) },
			uGlowRadius: { value: INNER_GLOW_RADIUS },
			uSkyHorizon: { value: displayColor(PALETTE.skyHorizon) },
			uSkyZenith: { value: displayColor(PALETTE.skyZenith) }
		});
		this.bubbles = this.createBubbles();
		this.snow = this.createSnow();

		this.composite = new THREE.Mesh(
			new THREE.PlaneGeometry(2, 2),
			new THREE.ShaderMaterial({
				vertexShader: compositeVertexShader,
				fragmentShader: compositeFragmentShader,
				defines: { BLOB_COUNT: BLOBS.length },
				uniforms: {
					tScene: { value: this.sceneTarget.texture },
					tBloom: { value: this.bloomUp[0].texture },
					uBloomStrength: { value: BLOOM_STRENGTH },
					uResolution: { value: new THREE.Vector2(1, 1) },
					uTime: this.time,
					uDepth: this.depth,
					uUnderwater: this.underwater,
					uBlobs: {
						value: BLOBS.map(
							(blob, i) => new THREE.Vector4(blob.x, blob.y, blob.radius, i * GOLDEN_ANGLE)
						)
					},
					uBlobColors: { value: BLOBS.map((blob) => displayColor(PALETTE[blob.color])) },
					uCobalt: { value: displayColor(PALETTE.cobalt) },
					uRose: { value: displayColor(PALETTE.rose) },
					uDeepBase: { value: displayColor(PALETTE.deepBase) },
					uDeepGlow: { value: displayColor(PALETTE.deepGlow) },
					uAbyssBase: { value: displayColor(PALETTE.abyssBase) },
					uSkyHorizon: { value: displayColor(PALETTE.skyHorizon) },
					uSkyZenith: { value: displayColor(PALETTE.skyZenith) },
					uAbyssLights: {
						value: [PALETTE.abyssCobalt, PALETTE.abyssMauve, PALETTE.abyssSlate].map(displayColor)
					}
				},
				depthTest: false,
				depthWrite: false
			})
		);
		// Positioned in clip space by its vertex shader, so it's always on screen.
		this.composite.frustumCulled = false;
		this.bloomQuad.frustumCulled = false;
		this.compositeScene.add(this.composite);

		this.updateCamera();
		this.setActive(true);
	}

	/** Start or stop rendering, e.g. while the section is scrolled out of view. */
	setActive(active: boolean): void {
		this.renderer.setAnimationLoop(active ? (time) => this.frame(time) : null);
	}

	private createSnow(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
		const start = new Float32Array(SNOW_COUNT * 3);
		const size = new Float32Array(SNOW_COUNT);
		const phase = new Float32Array(SNOW_COUNT);
		for (let i = 0; i < SNOW_COUNT; i++) {
			// Anywhere; the shader wraps every speck into the box around the camera.
			start[i * 3] = Math.random() * SNOW_BOX.x;
			start[i * 3 + 1] = Math.random() * SNOW_BOX.y;
			start[i * 3 + 2] = Math.random() * SNOW_BOX.z;
			// Mostly dust, the odd bigger flake (metres).
			size[i] = 0.006 + Math.random() ** 4 * 0.02;
			phase[i] = Math.random() * Math.PI * 2;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(start, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
		geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

		const material = new THREE.ShaderMaterial({
			vertexShader: snowVertexShader,
			fragmentShader: snowFragmentShader,
			uniforms: {
				uTime: this.time,
				uDepth: this.depth,
				uUnderwater: this.underwater,
				uWaterLevel: { value: WATER_LEVEL },
				uBox: { value: SNOW_BOX },
				uConeTop: { value: OPENING_CENTRE },
				uCone: { value: new THREE.Vector2(OPENING_RADIUS, Math.tan(CONE_SPREAD)) },
				uPointScale: { value: 1 },
				uColor: { value: displayColor(PALETTE.cyan).lerp(new THREE.Vector3(1, 1, 1), 0.7) }
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const points = new THREE.Points(geometry, material);
		// Positioned entirely in the vertex shader, so the CPU-side bounds mean nothing.
		points.frustumCulled = false;
		this.scene.add(points);
		return points;
	}

	private createBubbles(): THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
		const count = BURST_BUBBLES + DRIFT_BUBBLES;
		const start = new Float32Array(count * 3);
		const size = new Float32Array(count);
		const speed = new Float32Array(count);
		const phase = new Float32Array(count);
		const kind = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			const burst = i < BURST_BUBBLES;
			if (burst) {
				// Around and in front of the camera, from just under the surface to 2.5 m down.
				start[i * 3] = (Math.random() - 0.5) * 3;
				start[i * 3 + 1] = -0.2 - Math.random() * 2.3;
				start[i * 3 + 2] = -0.6 - Math.random() * 3.5;
				// Mostly small, a few big ones.
				size[i] = 0.008 + Math.random() ** 3 * 0.05;
				speed[i] = 0.4 + Math.random() * 0.8;
			} else {
				start[i * 3] = (Math.random() - 0.5) * 6;
				start[i * 3 + 1] = Math.random() * DRIFT_RANGE;
				start[i * 3 + 2] = 4.5 - Math.random() * 6;
				size[i] = 0.006 + Math.random() ** 2 * 0.025;
				speed[i] = 0.25 + Math.random() * 0.35;
			}
			phase[i] = Math.random() * Math.PI * 2;
			kind[i] = burst ? 0 : 1;
		}

		const geometry = new THREE.InstancedBufferGeometry();
		const quad = new THREE.PlaneGeometry(1, 1);
		geometry.setIndex(quad.index);
		geometry.setAttribute('position', quad.getAttribute('position'));
		geometry.instanceCount = count;
		geometry.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 3));
		geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
		geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
		geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
		geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));

		const material = new THREE.ShaderMaterial({
			vertexShader: bubbleVertexShader,
			fragmentShader: bubbleFragmentShader,
			uniforms: {
				uTime: this.time,
				uDepth: this.depth,
				uUnderwater: this.underwater,
				uBurstTime: this.burstTime,
				uBurstOrigin: this.burstOrigin,
				uWaterLevel: { value: WATER_LEVEL },
				uDriftRange: { value: DRIFT_RANGE },
				uColor: { value: displayColor(PALETTE.cyan).lerp(new THREE.Vector3(1, 1, 1), 0.6) }
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const mesh = new THREE.Mesh(geometry, material);
		// Positioned entirely in the vertex shader, so the CPU-side bounds mean nothing.
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		return mesh;
	}

	private createSurface(
		fragmentShader: string,
		side: THREE.Side,
		uniforms: Record<string, THREE.IUniform>
	): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
		const material = new THREE.ShaderMaterial({
			vertexShader: surfaceVertexShader,
			fragmentShader,
			uniforms: { uTime: this.time, uIntensity: { value: SURFACE_INTENSITY }, ...uniforms },
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side
		});
		const mesh = new THREE.Mesh(this.surfaceGeometry, material);
		mesh.position.y = WATER_LEVEL;
		this.scene.add(mesh);
		return mesh;
	}

	private createCone(): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
		const bottomRadius = OPENING_RADIUS + CONE_LENGTH * Math.tan(CONE_SPREAD);
		const geometry = new THREE.CylinderGeometry(
			OPENING_RADIUS,
			bottomRadius,
			CONE_LENGTH,
			CONE_SEGMENTS,
			1,
			true
		);
		// Hang the cone from its top so the mesh origin sits in the opening.
		geometry.translate(0, -CONE_LENGTH / 2, 0);
		const material = new THREE.ShaderMaterial({
			vertexShader: coneVertexShader,
			fragmentShader: coneFragmentShader,
			uniforms: {
				uTime: this.time,
				uDepth: this.depth,
				uIntensity: { value: CONE_INTENSITY },
				uWarm: { value: displayColor(PALETTE.gold).lerp(displayColor(PALETTE.rose), 0.35) },
				uCool: { value: displayColor(PALETTE.cyan) }
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(OPENING_CENTRE);
		this.scene.add(mesh);
		return mesh;
	}

	/** Scroll progress 0..1 over the page's track. */
	setScroll(progress: number): void {
		this.targetDepth = THREE.MathUtils.clamp(progress, 0, 1);
	}

	private updateCamera(): void {
		// Only the height changes; the camera always looks straight ahead.
		const y = THREE.MathUtils.lerp(
			WATER_LEVEL + START_HEIGHT,
			WATER_LEVEL - DESCENT,
			this.depth.value
		);
		this.camera.position.set(0, y, 5);
		this.camera.lookAt(0, y, -2);
		// Only one side of the water can be seen at a time; skip the other entirely.
		const above = y > WATER_LEVEL;
		this.surfaceAbove.visible = above;
		this.surfaceBelow.visible = !above;
		// The light cone only exists in the water; from above it would glow through the surface.
		this.cone.visible = !above;
		// The water colour switches on as the camera crosses the surface, blended over 10 cm so it
		// isn't a single-frame cut.
		this.underwater.value =
			1 - THREE.MathUtils.smoothstep(y, WATER_LEVEL - 0.05, WATER_LEVEL + 0.05);
	}

	private frame(time: number): void {
		this.timer.update(time);
		if (!this.reducedMotion) this.time.value = this.timer.getElapsed();
		this.depth.value = this.reducedMotion
			? this.targetDepth
			: THREE.MathUtils.damp(
					this.depth.value,
					this.targetDepth,
					DEPTH_DAMPING,
					this.timer.getDelta()
				);
		const wasUnderwater = this.underwater.value > 0.5;
		this.updateCamera();
		// Plunging in (not surfacing) starts a burst of bubbles where the camera went through.
		if (!wasUnderwater && this.underwater.value > 0.5 && this.depth.value < this.targetDepth) {
			this.burstTime.value = this.time.value;
			this.burstOrigin.value.set(this.camera.position.x, WATER_LEVEL, this.camera.position.z);
		}
		this.renderer.setRenderTarget(this.sceneTarget);
		this.renderer.render(this.scene, this.camera);
		this.renderBloom();
		this.renderer.setRenderTarget(null);
		this.renderer.render(this.compositeScene, this.camera);
	}

	private renderBloom(): void {
		const down = this.bloomDownMaterial.uniforms;
		const up = this.bloomUpMaterial.uniforms;
		this.bloomQuad.material = this.bloomDownMaterial;
		let input: THREE.WebGLRenderTarget = this.sceneTarget;
		this.bloomDown.forEach((target, i) => {
			down.tInput.value = input.texture;
			down.uTexel.value.set(1 / input.width, 1 / input.height);
			down.uPrefilter.value = i === 0 ? 1 : 0;
			this.renderer.setRenderTarget(target);
			this.renderer.render(this.bloomScene, this.camera);
			input = target;
		});
		this.bloomQuad.material = this.bloomUpMaterial;
		let low = this.bloomDown[BLOOM_LEVELS - 1];
		for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
			up.tLow.value = low.texture;
			up.tHigh.value = this.bloomDown[i].texture;
			up.uTexel.value.set(1 / low.width, 1 / low.height);
			this.renderer.setRenderTarget(this.bloomUp[i]);
			this.renderer.render(this.bloomScene, this.camera);
			low = this.bloomUp[i];
		}
	}

	resize(width: number, height: number): void {
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		this.sceneTarget.setSize(size.x, size.y);
		this.bloomDown.forEach((target, i) => {
			const scale = 2 ** (i + 2);
			target.setSize(
				Math.max(1, Math.floor(size.x / scale)),
				Math.max(1, Math.floor(size.y / scale))
			);
			this.bloomUp[i]?.setSize(target.width, target.height);
		});
		this.composite.material.uniforms.uResolution.value.copy(size);
		// Pixels per metre at 1 m from the camera, for sizing the snow points.
		this.snow.material.uniforms.uPointScale.value =
			size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
	}

	destroy(): void {
		this.renderer.setAnimationLoop(null);
		this.cone.geometry.dispose();
		this.cone.material.dispose();
		this.surfaceGeometry.dispose();
		this.surfaceBelow.material.dispose();
		this.surfaceAbove.material.dispose();
		this.bubbles.geometry.dispose();
		this.bubbles.material.dispose();
		this.snow.geometry.dispose();
		this.snow.material.dispose();
		this.composite.geometry.dispose();
		this.composite.material.dispose();
		this.sceneTarget.dispose();
		for (const target of [...this.bloomDown, ...this.bloomUp]) target.dispose();
		this.bloomDownMaterial.dispose();
		this.bloomUpMaterial.dispose();
		this.bloomQuad.geometry.dispose();
		this.renderer.dispose();
	}
}
