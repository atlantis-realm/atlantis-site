import * as THREE from 'three';
import { MOODS, type Mood } from '#lib/water/mood.js';

export const POOL_RADIUS = 1.5;
const CONE_SPREAD = 0.42;
const CONE_LENGTH = 20;
const CONE_SEGMENTS = 128;
const CONE_INTENSITY = 0.45;
const RAY_COUNT = 26;
const RAY_LENGTH = 18;
const RAY_SPREAD = 50;
const RAY_NEAR = 4;
const RAY_FAR = 35;
const RAY_LEAN = 0.18;
const RAY_INTENSITY = 0.35;
const SURFACE_SIZE = 1000;
const SURFACE_INTENSITY = 0.8;
const SKY_LIGHT_DIRECTION = new THREE.Vector3(-0.3, 0.35, -1).normalize();
const BURST_BUBBLES = 140;
const DRIFT_BUBBLES = 40;
const DRIFT_RANGE = 10;
const SNOW_COUNT = 700;
const SNOW_BOX = new THREE.Vector3(10, 8, 12);
const GLOW_COUNT = 7000;
const GLOW_SPREAD = new THREE.Vector2(60, 75);
const GLOW_LAYER = 2;
const GLOW_FADE_START = 2.5;
const GLOW_FADE_END = 6;
const RAIN_COUNT = 3000;
const RAIN_BOX = new THREE.Vector3(24, 10, 30);
const MOOD_SECONDS = 0.9;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const TARGET_PIXEL_RATIO = 1.5;
const BLOOM_LEVELS = 4;
const BLOOM_THRESHOLD = 0.45;
const BLOOM_KNEE = 0.4;
const BLOOM_STRENGTH = 0.12;
const BLOOM_TARGET_OPTIONS = { depthBuffer: false };

const PALETTE = {
	cobalt: 0x2c5fae,
	cyan: 0x55bfdc,
	rose: 0xf0a3b4,
	gold: 0xffe6a6,
	mauve: 0x7a4f8c,
	haze: 0xeef1e2,
	deepBase: 0x03090b,
	deepGlow: 0x0e3a44,
	abyssBase: 0x04060a,
	abyssCobalt: 0x1f2c4a,
	abyssMauve: 0x2a2440,
	abyssSlate: 0x18303b,
	skyHorizon: 0xf3d9e4,
	skyZenith: 0x8fc7ec,
	skyGround: 0xb9a6b8
};

type Palette = typeof PALETTE;

type MoodLook = {
	palette: Palette;
	stars: number;
	glow: number;
	rain: number;
	fog: number;
	light: number;
};

const LOOKS: Record<Mood, MoodLook> = {
	sunrise: { palette: PALETTE, stars: 0, glow: 0, rain: 0, fog: 0, light: 1 },
	morning: {
		palette: {
			...PALETTE,
			cobalt: 0x3a6fb8,
			cyan: 0x7fd0e6,
			rose: 0xf6c3b0,
			gold: 0xfff0c2,
			mauve: 0x8f86b8,
			haze: 0xf4f6ee,
			deepGlow: 0x12424c,
			skyHorizon: 0xfbe3cf,
			skyZenith: 0xa9d4f2,
			skyGround: 0xc9c3c4
		},
		stars: 0,
		glow: 0,
		rain: 0,
		fog: 0,
		light: 1.2
	},
	twilight: {
		palette: {
			...PALETTE,
			cobalt: 0x283f8f,
			cyan: 0x3f9cc4,
			rose: 0xe8708a,
			gold: 0xffb36b,
			mauve: 0x5e3a86,
			haze: 0xd7c2d8,
			deepBase: 0x03070c,
			deepGlow: 0x10304a,
			skyHorizon: 0xf39a6d,
			skyZenith: 0x3b3f8a,
			skyGround: 0x6e4d6e
		},
		stars: 0.15,
		glow: 0,
		rain: 0,
		fog: 0,
		light: 0.8
	},
	night: {
		palette: {
			cobalt: 0x1b3a7a,
			cyan: 0x2a7fa6,
			rose: 0x5d4a8f,
			gold: 0xb8c8f0,
			mauve: 0x3a2a63,
			haze: 0x8796c0,
			deepBase: 0x02070b,
			deepGlow: 0x0b2c42,
			abyssBase: 0x03050a,
			abyssCobalt: 0x1a2648,
			abyssMauve: 0x231f3c,
			abyssSlate: 0x142836,
			skyHorizon: 0x2b3a6e,
			skyZenith: 0x050a1c,
			skyGround: 0x161b33
		},
		stars: 1,
		glow: 1,
		rain: 0,
		fog: 0,
		light: 0.85
	},
	rain: {
		palette: {
			cobalt: 0x4a6077,
			cyan: 0x6f97a3,
			rose: 0x9d9aa6,
			gold: 0xc9c8bd,
			mauve: 0x6a6878,
			haze: 0xc4c9cc,
			deepBase: 0x05090b,
			deepGlow: 0x1a2d33,
			abyssBase: 0x05070a,
			abyssCobalt: 0x1e2833,
			abyssMauve: 0x232530,
			abyssSlate: 0x1c2a30,
			skyHorizon: 0xb4bcc0,
			skyZenith: 0x8e989f,
			skyGround: 0x9aa2a6
		},
		stars: 0,
		glow: 0,
		rain: 1,
		fog: 1,
		light: 0.45
	}
};

type Levels = Omit<MoodLook, 'palette'>;
const levelsOf = ({ stars, glow, rain, fog, light }: MoodLook): Levels => ({
	stars,
	glow,
	rain,
	fog,
	light
});

function displayColor(hex: number): THREE.Vector3 {
	return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

const coneVertexShader = `
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

const coneFragmentShader = `
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

	float loopNoise(float x, float period) {
		float i = floor(x);
		float f = fract(x);
		float a = hash(mod(i, period));
		float b = hash(mod(i + 1.0, period));
		return mix(a, b, f * f * (3.0 - 2.0 * f));
	}

	void main() {
		vec2 uv = clamp(vUv, 0.0, 1.0);
		float facing = abs(dot(normalize(vNormal), normalize(-vViewPosition)));
		float edge = pow(facing, 2.0);
		float along = pow(uv.y, 1.4) * smoothstep(1.0, 0.9, uv.y);

		float rays = smoothstep(0.05, 0.6, uDepth);
		float drift = uTime * 0.04;
		float n = 0.6 * loopNoise(uv.x * 40.0 + drift, 40.0)
			+ 0.4 * loopNoise(uv.x * 72.0 - drift * 0.7 + 7.0, 72.0);
		float shafts = mix(1.0, n * n * 2.4, mix(0.1, 0.5, rays));

		vec3 color = mix(uCool, uWarm, smoothstep(0.55, 1.0, uv.y));
		float fade = 1.0 - smoothstep(0.45, 0.85, uDepth);
		gl_FragColor = vec4(color * edge * along * shafts * uIntensity * fade, 1.0);
	}
`;

const surfaceVertexShader = `
	#include <common>
	#include <logdepthbuf_pars_vertex>

	varying vec3 vWorldPosition;

	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vWorldPosition = worldPosition.xyz;
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
		#include <logdepthbuf_vertex>
	}
`;

const noiseGlsl = `
	vec3 hash3(vec3 p) {
		p = fract(p * vec3(0.1031, 0.103, 0.0973));
		p += dot(p, p.yxz + 33.33);
		return fract((p.xxy + p.yxx) * p.zyx) * 2.0 - 1.0;
	}

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

	float fbm(vec3 p) {
		const mat3 turn = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64);
		float n = gnoise(p) * 0.57;
		p = turn * p * 2.03;
		n += gnoise(p) * 0.29;
		p = turn * p * 2.03;
		return n + gnoise(p) * 0.14;
	}
`;

const rainRingsGlsl = `
	float rainRings(vec2 p, float t) {
		vec2 cp = p * 2.5;
		vec2 cell = floor(cp);
		float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
		vec2 centre = (vec2(fract(seed * 17.3), fract(seed * 31.7)) - 0.5) * 0.5;
		float age = fract(t * (0.7 + seed * 0.6) + seed * 10.0);
		float r = length(fract(cp) - 0.5 - centre);
		return smoothstep(0.05, 0.0, abs(r - age * 0.45)) * (1.0 - age);
	}
`;

const surfaceBelowFragmentShader = `
	${noiseGlsl}
	${rainRingsGlsl}
	uniform float uTime;
	uniform float uDepth;
	uniform float uIntensity;
	uniform float uRain;
	uniform vec3 uRose;
	uniform vec3 uCyan;
	uniform vec3 uGold;
	uniform vec3 uMauve;

	varying vec3 vWorldPosition;

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
		vec3 q = vec3(p * 0.3, uTime * 0.12);
		vec2 slope = vec2(fbm(q), fbm(q + vec3(5.2, 1.3, 0.0)));

		vec2 detail = vec2(gnoise(vec3(p * 1.3, uTime * 0.3)), gnoise(vec3(p * 1.3 + 7.0, uTime * 0.3)));
		float e = cellEdge(p * 0.65 + slope * 1.5 + detail * 0.25, uTime * 0.25);
		float line = 1.0 - smoothstep(0.0, 0.05 + fwidth(e) * 1.5, e);
		line += exp(-e * 8.0) * 0.3;
		line *= mix(0.3, 1.0, smoothstep(-0.4, 0.4, slope.x - slope.y));
		line *= mix(0.1, 1.0, smoothstep(-0.45, 0.25, gnoise(vec3(p * 0.9 + 3.0, uTime * 0.15))));

		float wavelets = fbm(vec3(p * 1.1 + slope * 0.8, uTime * 0.25));
		float sheen = smoothstep(0.05, 0.55, wavelets) * 0.6 + smoothstep(0.0, 0.6, slope.x + slope.y * 0.5) * 0.4;

		float hue = fbm(vec3(p * 0.03 + 40.0, uTime * 0.01)) * 0.5 + 0.5;
		vec3 tint = mix(uRose, uCyan, smoothstep(0.3, 0.6, hue));
		tint = mix(tint, uGold, smoothstep(0.65, 0.85, hue) * 0.6);
		tint = mix(tint, uMauve, smoothstep(0.35, 0.15, hue) * 0.5);

		float grazing = abs(toSurface.y) / max(dist, 0.001);
		float visible = exp(-dist * 0.07) * smoothstep(0.03, 0.3, grazing);

		float light = line * 0.7 + sheen * 0.3 + 0.04;
		vec3 color = tint * light * visible;
		if (uRain > 0.0) {
			color += mix(tint, vec3(1.0), 0.5) * rainRings(p, uTime) * uRain * visible * 0.6;
		}
		float fade = 1.0 - smoothstep(0.35, 0.75, uDepth);
		gl_FragColor = vec4(color * uIntensity * fade, 1.0);
	}
`;

const surfaceAboveFragmentShader = `
	#include <logdepthbuf_pars_fragment>
	${noiseGlsl}
	${rainRingsGlsl}
	uniform float uTime;
	uniform float uIntensity;
	uniform vec3 uCobalt;
	uniform vec3 uCyan;
	uniform vec3 uHaze;
	uniform vec3 uRose;
	uniform vec3 uMauve;
	uniform vec3 uGold;
	uniform vec3 uLightDirection;
	uniform vec2 uGlowCentre;
	uniform vec3 uSkyHorizon;
	uniform vec3 uSkyZenith;
	uniform float uGlowRadius;
	uniform float uEdgeRadius;
	uniform float uRain;
	uniform float uFog;

	varying vec3 vWorldPosition;

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

		float footprint = length(fwidth(p));
		float detail = exp(-dist * 0.12);
		float strength = mix(0.15, 0.6, detail);

		const float e = 0.03;
		float h = rippleHeight(p, t, footprint);
		float hx = rippleHeight(p + vec2(e, 0.0), t, footprint);
		float hz = rippleHeight(p + vec2(0.0, e), t, footprint);
		vec3 normal = normalize(vec3(-(hx - h) / e * strength, 1.0, -(hz - h) / e * strength));

		vec3 reflected = reflect(view, normal);
		vec3 sky = mix(uSkyHorizon, uSkyZenith, smoothstep(0.0, 0.45, reflected.y));
		float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-view, normal), 0.0), 5.0);
		vec3 body = mix(uCyan, uCobalt, 0.25);
		body = mix(body, mix(uCyan, uHaze, 0.5), smoothstep(0.2, 0.7, h) * 0.3);

		vec2 bp = p + vec2(fbm(vec3(p * 0.9, t * 0.05)), fbm(vec3(p * 0.9 + 9.0, t * 0.05))) * 0.35;
		float magic = smoothstep(0.0, 0.38, fbm(vec3(bp * 2.2 + vec2(t * 0.06, -t * 0.05), t * 0.06)));
		float hue = fbm(vec3(bp * 0.6 + 20.0, t * 0.04)) * 0.5 + 0.5;
		vec3 tint = mix(uRose, uMauve, smoothstep(0.3, 0.55, hue));
		tint = mix(tint, mix(uMauve, uCobalt, 0.5), smoothstep(0.55, 0.8, hue));
		tint = mix(tint, mix(uRose, uGold, 0.35), smoothstep(0.3, 0.1, hue));
		body = mix(body, tint, magic * 0.7);

		vec3 color = mix(body * 0.8, sky, fresnel);
		color = mix(color, tint * 1.05, magic * (1.0 - 0.45 * fresnel) * 0.4);

		#ifdef OPEN_WATER
		float glowFalloff = 0.0;
		#else
		float glowFalloff = exp(-pow(length(p - uGlowCentre) / uGlowRadius, 2.0) * 2.0);
		#endif
		vec3 innerColor = mix(mix(uCyan, uMauve, 0.3), mix(uGold, uRose, 0.4), glowFalloff * glowFalloff);
		float crest = smoothstep(-0.1, 0.6, h);
		color += innerColor * glowFalloff * (0.3 + 0.7 * crest) * (1.0 - 0.5 * fresnel) * 0.45;
		color += vec3(1.0, 0.97, 0.9) * pow(max(dot(reflected, uLightDirection), 0.0), 300.0) * detail;

		if (uRain > 0.0) {
			color += vec3(0.85, 0.9, 0.95) * rainRings(p, t) * uRain * detail * 0.35;
		}

		#ifdef OPEN_WATER
		float visible = exp(-length(vWorldPosition - cameraPosition) * (0.025 + uFog * 0.09));
		gl_FragColor = vec4(mix(uSkyHorizon, color * uIntensity, visible), 1.0);
		#else
		float r = length(p - uGlowCentre) / uEdgeRadius + h * 0.004;
		float inside = 1.0 - smoothstep(0.985, 1.0, r);
		color += mix(uHaze, uCyan, 0.3) * smoothstep(0.93, 0.995, r) * 0.25;
		gl_FragColor = vec4(sRGBTransferEOTF(vec4(color * uIntensity, 1.0)).rgb, inside);
		#include <colorspace_fragment>
		#endif
		#include <logdepthbuf_fragment>
	}
`;

const bubbleVertexShader = `
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater;
	uniform float uBurstTime;
	uniform vec3 uBurstOrigin;
	uniform float uWaterLevel;
	uniform float uDriftRange;

	attribute vec3 aStart;
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
			float drag = 0.8 * (1.0 - exp(-age * 2.5));
			centre = uBurstOrigin + vec3(aStart.x, 0.0, aStart.z) * (1.0 + age * 0.25);
			centre.y += aStart.y - drag + aSpeed * age;
			alpha = smoothstep(0.0, 0.15, age) * (1.0 - smoothstep(5.0, 8.0, age));
		} else {
			float rise = aStart.y + aSpeed * uTime - cameraPosition.y;
			float y = mod(rise, uDriftRange) - uDriftRange * 0.5;
			centre = vec3(cameraPosition.x + aStart.x, cameraPosition.y + y, cameraPosition.z + aStart.z);
			alpha = smoothstep(0.5, 0.35, abs(y / uDriftRange)) * 0.7;
		}
		centre.x += sin(uTime * 2.7 + aPhase) * 0.04;
		centre.z += cos(uTime * 2.1 + aPhase * 1.7) * 0.04;
		alpha *= smoothstep(uWaterLevel, uWaterLevel - 0.15, centre.y) * uUnderwater;
		alpha *= mix(1.0, 0.3, smoothstep(0.0, 0.8, uDepth));

		vec4 viewPosition = modelViewMatrix * vec4(centre, 1.0);
		float blur = mix(0.06, 0.4, smoothstep(1.6, 0.4, -viewPosition.z));

		vUv = position.xy * 2.0;
		vAlpha = alpha * (1.0 - blur * 0.6);
		vBig = smoothstep(0.02, 0.05, aSize);
		vBlur = blur;
		vPhase = aPhase;
		viewPosition.xy += position.xy * aSize * 2.0;
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const bubbleFragmentShader = `
	uniform vec3 uColor;
	uniform float uTime;

	varying vec2 vUv;
	varying float vAlpha;
	varying float vBig;
	varying float vBlur;
	varying float vPhase;

	void main() {
		if (vAlpha <= 0.0) discard;
		vec2 q = vec2(vUv.x, vUv.y / mix(1.0, 0.8, vBig));
		float angle = atan(q.y, q.x);
		float wobble = sin(angle * 3.0 + uTime * 5.0 + vPhase) * 0.6 + sin(angle * 2.0 - uTime * 3.7 + vPhase * 2.0) * 0.4;
		float radius = 0.72 * (1.0 + wobble * 0.07 * vBig);
		float r = length(q) / radius;
		float inside = 1.0 - smoothstep(1.0 - vBlur, 1.0 + vBlur * 0.3, r);
		if (inside <= 0.0) discard;

		float up = q.y / radius;
		float edge = pow(min(r, 1.0), 16.0) * inside * mix(0.15, 1.0, smoothstep(-0.3, 0.9, up));
		float crescent = smoothstep(0.5, 0.92, r) * smoothstep(0.0, -0.75, up) * inside * 0.4;
		float wash = (1.0 - r * r) * smoothstep(0.6, -0.8, up) * inside * 0.06;
		float sharpness = mix(160.0, 25.0, vBlur);
		vec2 h = (q / radius - vec2(-0.32, 0.5)) * vec2(1.0, 1.6);
		vec2 h2 = (q / radius - vec2(0.4, -0.55)) * vec2(1.0, 2.0);
		float highlight = exp(-dot(h, h) * sharpness) * 0.85 + exp(-dot(h2, h2) * sharpness) * 0.2;

		vec3 light = uColor * (edge * 0.45 + crescent + wash) + vec3(1.0) * highlight;
		gl_FragColor = vec4(light * vAlpha, 1.0);
	}
`;

const snowVertexShader = `
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater;
	uniform float uWaterLevel;
	uniform vec3 uBox;
	uniform vec3 uConeTop;
	uniform vec2 uCone;
	uniform float uPointScale;

	attribute float aSize;
	attribute float aPhase;

	varying float vAlpha;

	void main() {
		vec3 drift = position;
		drift.y -= uTime * (0.02 + fract(aPhase * 7.3) * 0.03);
		drift.x += sin(uTime * 0.15 + aPhase) * 0.3;
		drift.z += cos(uTime * 0.12 + aPhase * 1.7) * 0.3;
		vec3 boxMin = cameraPosition + vec3(-0.5 * uBox.x, -0.5 * uBox.y, -uBox.z);
		vec3 rel = mod(drift - boxMin, uBox);
		vec3 world = boxMin + rel;
		vec3 n = rel / uBox;
		vec3 walls = smoothstep(0.0, 0.1, n) * smoothstep(1.0, 0.85, n);

		float below = uWaterLevel - world.y;
		float coneRadius = uCone.x + max(below, 0.0) * uCone.y;
		float inCone = smoothstep(coneRadius * 1.1, coneRadius * 0.6, length(world.xz - uConeTop.xz));
		float light = mix(0.35, 1.0, inCone) * (1.0 - smoothstep(0.4, 0.85, uDepth));

		vec4 viewPosition = viewMatrix * vec4(world, 1.0);
		float pixels = aSize * uPointScale / -viewPosition.z;
		gl_PointSize = max(pixels, 2.0);
		float coverage = min(pixels / 2.0, 1.0);

		vAlpha = light * coverage * walls.x * walls.y * walls.z * uUnderwater * step(0.0, below);
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const snowFragmentShader = `
	uniform vec3 uColor;

	varying float vAlpha;

	void main() {
		float r = length(gl_PointCoord - 0.5) * 2.0;
		float speck = 1.0 - smoothstep(0.2, 1.0, r);
		if (speck <= 0.0 || vAlpha <= 0.0) discard;
		gl_FragColor = vec4(uColor * speck * vAlpha * 0.9, 1.0);
	}
`;

const raysVertexShader = `
	uniform float uTime;

	attribute float aSeed;

	varying vec2 vUv;
	varying float vSeed;

	void main() {
		vUv = uv;
		vSeed = aSeed;
		vec3 p = position;
		p.x += sin(uTime * 0.15 + aSeed * 6.283) * 0.6 * (1.0 - uv.y);
		gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
	}
`;

const raysFragmentShader = `
	uniform float uTime;
	uniform float uDepth;
	uniform float uIntensity;
	uniform vec3 uWarm;
	uniform vec3 uCool;

	varying vec2 vUv;
	varying float vSeed;

	void main() {
		vec2 uv = clamp(vUv, 0.0, 1.0);
		float across = pow(sin(3.14159 * uv.x), 2.0);
		float along = pow(uv.y, 1.6) * smoothstep(1.0, 0.65, uv.y);
		float shimmer = 0.55 + 0.45 * sin(uTime * (0.3 + fract(vSeed * 7.1) * 0.4) + vSeed * 40.0);
		float strength = 0.4 + 0.6 * fract(vSeed * 13.7);
		vec3 color = mix(uCool, uWarm, smoothstep(0.6, 1.0, uv.y));
		float fade = 1.0 - smoothstep(0.45, 0.85, uDepth);
		gl_FragColor = vec4(color * across * along * shimmer * strength * uIntensity * fade, 1.0);
	}
`;

const rainVertexShader = `
	uniform float uTime;
	uniform float uRain;
	uniform float uWaterLevel;
	uniform vec3 uBox;

	attribute float aEnd;
	attribute float aSpeed;

	varying float vAlpha;

	void main() {
		vec3 drop = position;
		drop.y -= uTime * aSpeed;
		vec3 boxMin = cameraPosition + vec3(-0.5 * uBox.x, -0.5 * uBox.y, -uBox.z);
		vec3 rel = mod(drop - boxMin, uBox);
		vec3 world = boxMin + rel + vec3(0.03, 0.35, 0.0) * aEnd;
		vec3 n = rel / uBox;
		vec3 walls = smoothstep(0.0, 0.1, n) * smoothstep(1.0, 0.85, n);
		vAlpha = uRain * walls.x * walls.y * walls.z * step(uWaterLevel, world.y) * mix(0.22, 0.04, aEnd);
		gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
	}
`;

const rainFragmentShader = `
	uniform vec3 uColor;

	varying float vAlpha;

	void main() {
		gl_FragColor = vec4(uColor * vAlpha, 1.0);
	}
`;

const glowVertexShader = `
	uniform float uTime;
	uniform float uLevel;
	uniform float uWaterLevel;
	uniform float uPointScale;
	uniform float uCameraFade;

	attribute float aSize;
	attribute float aPhase;

	varying float vAlpha;
	varying float vHue;

	void main() {
		vec3 world = position;
		world.x += sin(uTime * 0.1 + aPhase) * 0.4;
		world.z += cos(uTime * 0.08 + aPhase * 1.3) * 0.4;
		world.y += sin(uTime * 0.3 + aPhase * 2.1) * 0.08;
		float below = max(uWaterLevel - world.y, 0.0);

		float rate = 0.6 + fract(aPhase * 5.1) * 0.9;
		float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * rate + aPhase * 6.0), 3.0);

		vec4 viewPosition = viewMatrix * vec4(world, 1.0);
		float distance = -viewPosition.z;
		float pixels = aSize * uPointScale / max(distance, 0.01);
		gl_PointSize = max(pixels, 2.0);
		float coverage = min(pixels / 2.0, 1.0);

		float throughWater = cameraPosition.y > uWaterLevel ? exp(-below * 0.9) : 1.0;
		float far = 1.0 - smoothstep(20.0, 55.0, distance);
		vAlpha = uLevel * uCameraFade * pulse * coverage * throughWater * far;
		vHue = fract(aPhase * 3.7);
		gl_Position = projectionMatrix * viewPosition;
	}
`;

const glowFragmentShader = `
	uniform vec3 uTeal;
	uniform vec3 uBlue;

	varying float vAlpha;
	varying float vHue;

	void main() {
		float r = length(gl_PointCoord - 0.5) * 2.0;
		float glow = pow(1.0 - smoothstep(0.0, 1.0, r), 2.0);
		if (glow <= 0.0 || vAlpha <= 0.0) discard;
		vec3 color = mix(uTeal, uBlue, step(0.75, vHue));
		gl_FragColor = vec4(color * glow * vAlpha, 1.0);
	}
`;

const BLOBS: { x: number; y: number; radius: number; color: keyof typeof PALETTE }[] = [
	{ x: -0.85, y: 0.55, radius: 0.45, color: 'cyan' },
	{ x: 0.85, y: 0.5, radius: 0.5, color: 'rose' },
	{ x: -0.8, y: -0.55, radius: 0.5, color: 'mauve' },
	{ x: 0.8, y: -0.6, radius: 0.45, color: 'gold' },
	{ x: 0.1, y: 0.9, radius: 0.55, color: 'cobalt' },
	{ x: -0.15, y: -0.95, radius: 0.5, color: 'cyan' }
];

const bloomDownShader = `
	uniform sampler2D tInput;
	uniform vec2 uTexel;
	uniform float uPrefilter;
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

const bloomUpShader = `
	uniform sampler2D tLow;
	uniform sampler2D tHigh;
	uniform vec2 uTexel;

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

const compositeVertexShader = `
	varying vec2 vUv;

	void main() {
		vUv = uv;
		gl_Position = vec4(position.xy, 0.0, 1.0);
	}
`;

const compositeFragmentShader = `
	uniform sampler2D tScene;
	uniform sampler2D tBloom;
	uniform float uBloomStrength;
	uniform vec2 uResolution;
	uniform float uTime;
	uniform float uDepth;
	uniform float uUnderwater;
	uniform vec4 uBlobs[BLOB_COUNT];
	uniform vec3 uBlobColors[BLOB_COUNT];
	uniform vec3 uCobalt;
	uniform vec3 uRose;
	uniform vec3 uDeepBase;
	uniform vec3 uDeepGlow;
	uniform vec3 uAbyssBase;
	uniform vec3 uAbyssLights[3];

	varying vec2 vUv;

	float hash(vec2 p) {
		vec3 p3 = fract(vec3(p.xyx) * 0.1031);
		p3 += dot(p3, p3.yzx + 33.33);
		return fract((p3.x + p3.y) * p3.z);
	}

	void main() {
		vec2 fromCentre = vUv - 0.5;
		vec2 fringe = fromCentre * dot(fromCentre, fromCentre) * 0.012 * uUnderwater;
		vec3 scene = vec3(
			texture2D(tScene, vUv + fringe).r,
			texture2D(tScene, vUv).g,
			texture2D(tScene, vUv - fringe).b
		);
		float aspect = uResolution.x / uResolution.y;
		vec2 halfSize = vec2(aspect, 1.0) * 0.5;
		vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
		float deep = smoothstep(0.0, 0.7, uDepth);
		float abyss = smoothstep(0.72, 0.95, uDepth);

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
		glow *= mix(1.0, smoothstep(0.25, 0.9, length(p)), deep);

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

		vec3 color = scene + texture2D(tBloom, vUv).rgb * uBloomStrength + (base + glow) * uUnderwater;

		float vignette = smoothstep(1.2, 0.35, length(p));
		color *= mix(1.0, vignette, mix(mix(0.35, 0.6, deep), 0.3, abyss) * uUnderwater);

		vec2 seed = gl_FragCoord.xy + fract(uTime * 0.37) * vec2(1013.0, 619.0);
		float grain = hash(seed) + hash(seed + 71.3) - 1.0;
		color += grain * mix(0.03, 0.045, deep) * uUnderwater;

		gl_FragColor = vec4(max(color, 0.0), 1.0);
	}
`;

const skyVertexShader = `
	varying vec3 vDirection;

	void main() {
		vec4 worldPosition = modelMatrix * vec4(position, 1.0);
		vDirection = worldPosition.xyz - cameraPosition;
		gl_Position = projectionMatrix * viewMatrix * worldPosition;
	}
`;

const skyFragmentShader = `
	uniform vec3 uHorizon;
	uniform vec3 uZenith;
	uniform vec3 uGround;
	uniform float uStars;

	varying vec3 vDirection;

	float hash(vec3 p) {
		return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
	}

	void main() {
		vec3 direction = normalize(vDirection);
		float y = direction.y;
		vec3 color = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, y));
		color = mix(color, uGround, smoothstep(0.0, -0.25, y));

		if (uStars > 0.0 && y > 0.0) {
			vec3 p = direction * 260.0;
			float h = hash(floor(p));
			if (h > 0.985) {
				float point = smoothstep(0.3, 0.0, length(fract(p) - 0.5));
				float brightness = (h - 0.985) / 0.015;
				color += vec3(0.85, 0.9, 1.0) * point * brightness * smoothstep(0.03, 0.3, y) * uStars;
			}
		}
		gl_FragColor = vec4(color, 1.0);
	}
`;

export interface WaterWorldOptions {
	pool: THREE.Vector3;
	startHeight: number;
	descent: number;
	poolRadius?: number;
	surfaceRadius?: number;
	sky?: boolean;
	openWater?: boolean;
}

export class WaterWorld {
	private readonly time = { value: 0 };
	private readonly depth = { value: 0 };
	private readonly underwater = { value: 0 };
	private readonly burstTime = { value: -1000 };
	private readonly burstOrigin = { value: new THREE.Vector3() };
	private previousHeight = Infinity;
	private readonly moodColorEntries: {
		targets: THREE.Vector3[];
		from: THREE.Vector3[];
		colors: Record<Mood, THREE.Vector3[]>;
	}[] = [];
	private mood: Mood = 'sunrise';
	private levels: Levels = levelsOf(LOOKS.sunrise);
	private levelsFrom: Levels = levelsOf(LOOKS.sunrise);
	private moodProgress = 1;
	private readonly stars = { value: 0 };
	private readonly glowLevel = { value: 0 };
	private readonly rainLevel = { value: 0 };
	private readonly fogLevel = { value: 0 };
	private readonly pointScale = { value: 1 };
	private readonly glowFade = { value: 1 };

	private readonly sceneTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
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
	private readonly bloomQuad = new THREE.Mesh(
		new THREE.PlaneGeometry(2, 2),
		this.bloomDownMaterial
	);
	private readonly bloomScene = new THREE.Scene().add(this.bloomQuad);
	private readonly composite: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly compositeScene = new THREE.Scene();

	private readonly scene: THREE.Scene;
	private readonly pool: THREE.Vector3;
	private readonly poolRadius: number;
	private readonly showSky: boolean;
	private readonly startHeight: number;
	private readonly descent: number;
	private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
	private readonly cone: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly poolGeometry: THREE.CircleGeometry;
	private readonly surfaceGeometry = new THREE.PlaneGeometry(SURFACE_SIZE, SURFACE_SIZE).rotateX(
		Math.PI / 2
	);
	private readonly surfaceBelow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
	private readonly surfaceAbove: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly bubbles: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
	private readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly glow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
	private readonly lightIntensity: number;

	constructor(scene: THREE.Scene, options: WaterWorldOptions) {
		this.scene = scene;
		this.pool = options.pool.clone();
		this.poolRadius = options.poolRadius ?? POOL_RADIUS;
		this.showSky = options.sky ?? true;
		const surfaceRadius = options.surfaceRadius ?? this.poolRadius;
		this.poolGeometry = new THREE.CircleGeometry(surfaceRadius, 96).rotateX(Math.PI / 2);
		this.startHeight = options.startHeight;
		this.descent = options.descent;

		this.sky = this.createSky();
		this.cone = options.openWater ? this.createRays() : this.createCone();
		this.lightIntensity = this.cone.material.uniforms.uIntensity.value;
		this.surfaceBelow = this.createSurface(
			this.surfaceGeometry,
			surfaceBelowFragmentShader,
			THREE.FrontSide,
			THREE.AdditiveBlending,
			{
				uDepth: this.depth,
				uRose: this.moodColor((p) => displayColor(p.rose)),
				uCyan: this.moodColor((p) => displayColor(p.cyan)),
				uGold: this.moodColor((p) => displayColor(p.gold)),
				uMauve: this.moodColor((p) => displayColor(p.mauve)),
				uRain: this.rainLevel
			}
		);
		this.surfaceAbove = this.createSurface(
			options.openWater ? this.surfaceGeometry : this.poolGeometry,
			surfaceAboveFragmentShader,
			THREE.BackSide,
			THREE.NormalBlending,
			{
				uCobalt: this.moodColor((p) => displayColor(p.cobalt)),
				uCyan: this.moodColor((p) => displayColor(p.cyan)),
				uHaze: this.moodColor((p) => displayColor(p.haze)),
				uRose: this.moodColor((p) => displayColor(p.rose)),
				uMauve: this.moodColor((p) => displayColor(p.mauve)),
				uGold: this.moodColor((p) => displayColor(p.gold)),
				uLightDirection: { value: SKY_LIGHT_DIRECTION },
				uGlowCentre: { value: new THREE.Vector2(this.pool.x, this.pool.z) },
				uGlowRadius: { value: this.poolRadius },
				uEdgeRadius: { value: surfaceRadius },
				uSkyHorizon: this.moodColor((p) => displayColor(p.skyHorizon)),
				uSkyZenith: this.moodColor((p) => displayColor(p.skyZenith)),
				uRain: this.rainLevel,
				uFog: this.fogLevel
			}
		);
		if (options.openWater) this.surfaceAbove.material.defines = { OPEN_WATER: '' };
		this.bubbles = this.createBubbles();
		this.snow = this.createSnow(options.openWater ?? false);
		this.glow = this.createGlow();
		this.rain = this.createRain();

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
					uBlobColors: this.moodColors((p) => BLOBS.map((blob) => displayColor(p[blob.color]))),
					uCobalt: this.moodColor((p) => displayColor(p.cobalt)),
					uRose: this.moodColor((p) => displayColor(p.rose)),
					uDeepBase: this.moodColor((p) => displayColor(p.deepBase)),
					uDeepGlow: this.moodColor((p) => displayColor(p.deepGlow)),
					uAbyssBase: this.moodColor((p) => displayColor(p.abyssBase)),
					uAbyssLights: this.moodColors((p) =>
						[p.abyssCobalt, p.abyssMauve, p.abyssSlate].map(displayColor)
					)
				},
				depthTest: false,
				depthWrite: false
			})
		);
		this.composite.frustumCulled = false;
		this.bloomQuad.frustumCulled = false;
		this.compositeScene.add(this.composite);
	}

	update(camera: THREE.PerspectiveCamera, elapsed: number): void {
		this.time.value = elapsed;
		const height = camera.position.y - this.pool.y;
		this.depth.value = THREE.MathUtils.clamp(
			(this.startHeight - height) / (this.startHeight + this.descent),
			0,
			1
		);
		this.underwater.value = 1 - THREE.MathUtils.smoothstep(height, -0.05, 0.05);

		if (this.previousHeight > 0 && height <= 0 && this.previousHeight !== Infinity) {
			this.burstTime.value = elapsed;
			this.burstOrigin.value.set(camera.position.x, this.pool.y, camera.position.z);
		}
		this.previousHeight = height;

		const above = height > 0;
		this.surfaceAbove.visible = above;
		this.sky.visible = above && this.showSky;
		this.surfaceBelow.visible = !above;
		this.cone.visible = !above;
		this.bubbles.visible = !above;
		this.snow.visible = !above;
		this.glowFade.value = 1 - THREE.MathUtils.smoothstep(-height, GLOW_FADE_START, GLOW_FADE_END);
		this.glow.visible = this.glowLevel.value > 0 && this.glowFade.value > 0;
		this.rain.visible = above && this.rainLevel.value > 0;
		this.sky.position.copy(camera.position);
		this.sky.scale.setScalar(camera.far * 0.9);
	}

	get submerged(): boolean {
		return this.underwater.value > 0;
	}

	setMood(mood: Mood, immediate = false): void {
		if (mood === this.mood && !immediate) return;
		for (const { targets, from } of this.moodColorEntries) {
			targets.forEach((target, i) => from[i].copy(target));
		}
		this.levelsFrom = { ...this.levels };
		this.mood = mood;
		this.moodProgress = immediate ? 1 : 0;
		this.applyMood();
	}

	stepMood(delta: number): void {
		if (this.moodProgress >= 1) return;
		this.moodProgress = Math.min(1, this.moodProgress + delta / MOOD_SECONDS);
		this.applyMood();
	}

	private applyMood(): void {
		const t = THREE.MathUtils.smootherstep(this.moodProgress, 0, 1);
		for (const { targets, from, colors } of this.moodColorEntries) {
			const to = colors[this.mood];
			targets.forEach((target, i) => target.lerpVectors(from[i], to[i], t));
		}
		const to = levelsOf(LOOKS[this.mood]);
		const lerp = (key: keyof Levels) => THREE.MathUtils.lerp(this.levelsFrom[key], to[key], t);
		this.levels = {
			stars: lerp('stars'),
			glow: lerp('glow'),
			rain: lerp('rain'),
			fog: lerp('fog'),
			light: lerp('light')
		};
		this.stars.value = this.levels.stars;
		this.glowLevel.value = this.levels.glow;
		this.rainLevel.value = this.levels.rain;
		this.fogLevel.value = this.levels.fog;
		this.cone.material.uniforms.uIntensity.value = this.lightIntensity * this.levels.light;
	}

	private moodColor(pick: (palette: Palette) => THREE.Vector3): { value: THREE.Vector3 } {
		const { value } = this.moodColors((palette) => [pick(palette)]);
		return { value: value[0] };
	}

	private moodColors(pick: (palette: Palette) => THREE.Vector3[]): { value: THREE.Vector3[] } {
		const value = pick(LOOKS[this.mood].palette);
		const colors = Object.fromEntries(
			MOODS.map((mood) => [mood, pick(LOOKS[mood].palette)])
		) as Record<Mood, THREE.Vector3[]>;
		this.moodColorEntries.push({
			targets: value,
			from: value.map((color) => color.clone()),
			colors
		});
		return { value };
	}

	render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
		if (!this.submerged) {
			renderer.setRenderTarget(null);
			renderer.render(scene, camera);
			return;
		}
		renderer.setRenderTarget(this.sceneTarget);
		renderer.clear();
		renderer.render(scene, camera);
		this.renderBloom(renderer, camera);
		renderer.setRenderTarget(null);
		renderer.render(this.compositeScene, camera);
	}

	warmUp(
		renderer: THREE.WebGLRenderer,
		scene: THREE.Scene,
		camera: THREE.Camera
	): Promise<unknown> {
		const previousTarget = renderer.getRenderTarget();
		const previousBloomMaterial = this.bloomQuad.material;
		const compiling: Promise<unknown>[] = [];

		renderer.setRenderTarget(null);
		compiling.push(renderer.compileAsync(scene, camera));
		compiling.push(renderer.compileAsync(this.compositeScene, camera));
		renderer.setRenderTarget(this.sceneTarget);
		compiling.push(renderer.compileAsync(scene, camera));
		renderer.setRenderTarget(this.bloomDown[0]);
		for (const material of [this.bloomDownMaterial, this.bloomUpMaterial]) {
			this.bloomQuad.material = material;
			compiling.push(renderer.compileAsync(this.bloomScene, camera));
		}

		this.bloomQuad.material = previousBloomMaterial;
		renderer.setRenderTarget(previousTarget);
		return Promise.all(compiling);
	}

	resize(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
		const size = renderer.getDrawingBufferSize(new THREE.Vector2());
		const scale = Math.min(1, TARGET_PIXEL_RATIO / renderer.getPixelRatio());
		const width = Math.max(1, Math.floor(size.x * scale));
		const height = Math.max(1, Math.floor(size.y * scale));
		this.sceneTarget.setSize(width, height);
		this.bloomDown.forEach((target, i) => {
			const shrink = 2 ** (i + 2);
			target.setSize(
				Math.max(1, Math.floor(width / shrink)),
				Math.max(1, Math.floor(height / shrink))
			);
			this.bloomUp[i]?.setSize(target.width, target.height);
		});
		this.composite.material.uniforms.uResolution.value.copy(size);
		this.pointScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
	}

	dispose(): void {
		for (const mesh of [
			this.sky,
			this.cone,
			this.surfaceBelow,
			this.surfaceAbove,
			this.bubbles,
			this.snow,
			this.glow,
			this.rain
		]) {
			this.scene.remove(mesh);
			mesh.material.dispose();
		}
		this.sky.geometry.dispose();
		this.cone.geometry.dispose();
		this.surfaceGeometry.dispose();
		this.poolGeometry.dispose();
		this.bubbles.geometry.dispose();
		this.snow.geometry.dispose();
		this.glow.geometry.dispose();
		this.rain.geometry.dispose();
		this.composite.geometry.dispose();
		this.composite.material.dispose();
		this.sceneTarget.dispose();
		for (const target of [...this.bloomDown, ...this.bloomUp]) target.dispose();
		this.bloomDownMaterial.dispose();
		this.bloomUpMaterial.dispose();
		this.bloomQuad.geometry.dispose();
	}

	private renderBloom(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
		const down = this.bloomDownMaterial.uniforms;
		const up = this.bloomUpMaterial.uniforms;
		this.bloomQuad.material = this.bloomDownMaterial;
		let input: THREE.WebGLRenderTarget = this.sceneTarget;
		this.bloomDown.forEach((target, i) => {
			down.tInput.value = input.texture;
			down.uTexel.value.set(1 / input.width, 1 / input.height);
			down.uPrefilter.value = i === 0 ? 1 : 0;
			renderer.setRenderTarget(target);
			renderer.render(this.bloomScene, camera);
			input = target;
		});
		this.bloomQuad.material = this.bloomUpMaterial;
		let low = this.bloomDown[BLOOM_LEVELS - 1];
		for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
			up.tLow.value = low.texture;
			up.tHigh.value = this.bloomDown[i].texture;
			up.uTexel.value.set(1 / low.width, 1 / low.height);
			renderer.setRenderTarget(this.bloomUp[i]);
			renderer.render(this.bloomScene, camera);
			low = this.bloomUp[i];
		}
	}

	private createSky(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
		const mesh = new THREE.Mesh(
			new THREE.SphereGeometry(1, 32, 16),
			new THREE.ShaderMaterial({
				vertexShader: skyVertexShader,
				fragmentShader: skyFragmentShader,
				uniforms: {
					uHorizon: this.moodColor((p) => displayColor(p.skyHorizon)),
					uZenith: this.moodColor((p) => displayColor(p.skyZenith)),
					uGround: this.moodColor((p) => displayColor(p.skyGround)),
					uStars: this.stars
				},
				side: THREE.BackSide,
				depthTest: false,
				depthWrite: false
			})
		);
		mesh.renderOrder = -1000;
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		return mesh;
	}

	private createSnow(openWater: boolean): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
		const start = new Float32Array(SNOW_COUNT * 3);
		const size = new Float32Array(SNOW_COUNT);
		const phase = new Float32Array(SNOW_COUNT);
		for (let i = 0; i < SNOW_COUNT; i++) {
			start[i * 3] = Math.random() * SNOW_BOX.x;
			start[i * 3 + 1] = Math.random() * SNOW_BOX.y;
			start[i * 3 + 2] = Math.random() * SNOW_BOX.z;
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
				uWaterLevel: { value: this.pool.y },
				uBox: { value: SNOW_BOX },
				uConeTop: { value: this.pool },
				uCone: {
					value: new THREE.Vector2(openWater ? 1e4 : this.poolRadius, Math.tan(CONE_SPREAD))
				},
				uPointScale: this.pointScale,
				uColor: this.moodColor((p) => displayColor(p.cyan).lerp(new THREE.Vector3(1, 1, 1), 0.7))
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const points = new THREE.Points(geometry, material);
		points.frustumCulled = false;
		this.scene.add(points);
		return points;
	}

	private createGlow(): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
		const start = new Float32Array(GLOW_COUNT * 3);
		const size = new Float32Array(GLOW_COUNT);
		const phase = new Float32Array(GLOW_COUNT);
		for (let i = 0; i < GLOW_COUNT; i++) {
			start[i * 3] = this.pool.x + (Math.random() - 0.5) * GLOW_SPREAD.x;
			start[i * 3 + 1] = this.pool.y - 0.05 - Math.random() ** 1.5 * GLOW_LAYER;
			start[i * 3 + 2] = this.pool.z + 15 - Math.random() * GLOW_SPREAD.y;
			size[i] = 0.05 + Math.random() ** 3 * 0.12;
			phase[i] = Math.random() * Math.PI * 2;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(start, 3));
		geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
		geometry.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

		const material = new THREE.ShaderMaterial({
			vertexShader: glowVertexShader,
			fragmentShader: glowFragmentShader,
			uniforms: {
				uTime: this.time,
				uLevel: this.glowLevel,
				uWaterLevel: { value: this.pool.y },
				uPointScale: this.pointScale,
				uCameraFade: this.glowFade,
				uTeal: { value: new THREE.Vector3(0.15, 1.0, 0.8) },
				uBlue: { value: new THREE.Vector3(0.25, 0.55, 1.0) }
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const points = new THREE.Points(geometry, material);
		points.frustumCulled = false;
		points.renderOrder = 1;
		points.visible = false;
		this.scene.add(points);
		return points;
	}

	private createRain(): THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> {
		const start = new Float32Array(RAIN_COUNT * 2 * 3);
		const end = new Float32Array(RAIN_COUNT * 2);
		const speed = new Float32Array(RAIN_COUNT * 2);
		for (let i = 0; i < RAIN_COUNT; i++) {
			const x = Math.random() * RAIN_BOX.x;
			const y = Math.random() * RAIN_BOX.y;
			const z = Math.random() * RAIN_BOX.z;
			const fall = 7 + Math.random() * 3;
			for (let j = 0; j < 2; j++) {
				const v = i * 2 + j;
				start.set([x, y, z], v * 3);
				end[v] = j;
				speed[v] = fall;
			}
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(start, 3));
		geometry.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
		geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));

		const material = new THREE.ShaderMaterial({
			vertexShader: rainVertexShader,
			fragmentShader: rainFragmentShader,
			uniforms: {
				uTime: this.time,
				uRain: this.rainLevel,
				uWaterLevel: { value: this.pool.y },
				uBox: { value: RAIN_BOX },
				uColor: { value: new THREE.Vector3(0.8, 0.84, 0.88) }
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const lines = new THREE.LineSegments(geometry, material);
		lines.frustumCulled = false;
		lines.renderOrder = 1;
		lines.visible = false;
		this.scene.add(lines);
		return lines;
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
				start[i * 3] = (Math.random() - 0.5) * 3;
				start[i * 3 + 1] = -0.2 - Math.random() * 2.3;
				start[i * 3 + 2] = -0.6 - Math.random() * 3.5;
				size[i] = 0.008 + Math.random() ** 3 * 0.05;
				speed[i] = 0.4 + Math.random() * 0.8;
			} else {
				start[i * 3] = (Math.random() - 0.5) * 6;
				start[i * 3 + 1] = Math.random() * DRIFT_RANGE;
				start[i * 3 + 2] = -0.5 - Math.random() * 6;
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
				uWaterLevel: { value: this.pool.y },
				uDriftRange: { value: DRIFT_RANGE },
				uColor: this.moodColor((p) => displayColor(p.cyan).lerp(new THREE.Vector3(1, 1, 1), 0.6))
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		return mesh;
	}

	private createSurface<G extends THREE.BufferGeometry>(
		geometry: G,
		fragmentShader: string,
		side: THREE.Side,
		blending: THREE.Blending,
		uniforms: Record<string, THREE.IUniform>
	): THREE.Mesh<G, THREE.ShaderMaterial> {
		const material = new THREE.ShaderMaterial({
			vertexShader: surfaceVertexShader,
			fragmentShader,
			uniforms: { uTime: this.time, uIntensity: { value: SURFACE_INTENSITY }, ...uniforms },
			transparent: true,
			blending,
			depthWrite: false,
			side
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(this.pool);
		this.scene.add(mesh);
		return mesh;
	}

	private createRays(): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
		const positions: number[] = [];
		const uvs: number[] = [];
		const seeds: number[] = [];
		const indices: number[] = [];
		const lean = Math.tan(RAY_LEAN) * RAY_LENGTH;
		for (let i = 0; i < RAY_COUNT; i++) {
			const x = ((i + Math.random()) / RAY_COUNT - 0.5) * RAY_SPREAD;
			const z = -(RAY_NEAR + Math.random() * (RAY_FAR - RAY_NEAR));
			const half = (0.4 + Math.random() * 1.4) / 2;
			const base = i * 4;
			positions.push(
				x - half,
				0,
				z,
				x + half,
				0,
				z,
				x - half + lean,
				-RAY_LENGTH,
				z,
				x + half + lean,
				-RAY_LENGTH,
				z
			);
			uvs.push(0, 1, 1, 1, 0, 0, 1, 0);
			const seed = Math.random();
			seeds.push(seed, seed, seed, seed);
			indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
		geometry.setIndex(indices);

		const material = new THREE.ShaderMaterial({
			vertexShader: raysVertexShader,
			fragmentShader: raysFragmentShader,
			uniforms: {
				uTime: this.time,
				uDepth: this.depth,
				uIntensity: { value: RAY_INTENSITY },
				uWarm: this.moodColor((p) => displayColor(p.gold).lerp(displayColor(p.rose), 0.35)),
				uCool: this.moodColor((p) => displayColor(p.cyan))
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(0, this.pool.y, 0);
		mesh.frustumCulled = false;
		this.scene.add(mesh);
		return mesh;
	}

	private createCone(): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
		const bottomRadius = this.poolRadius + CONE_LENGTH * Math.tan(CONE_SPREAD);
		const geometry = new THREE.CylinderGeometry(
			this.poolRadius,
			bottomRadius,
			CONE_LENGTH,
			CONE_SEGMENTS,
			1,
			true
		);
		geometry.translate(0, -CONE_LENGTH / 2, 0);
		const material = new THREE.ShaderMaterial({
			vertexShader: coneVertexShader,
			fragmentShader: coneFragmentShader,
			uniforms: {
				uTime: this.time,
				uDepth: this.depth,
				uIntensity: { value: CONE_INTENSITY },
				uWarm: this.moodColor((p) => displayColor(p.gold).lerp(displayColor(p.rose), 0.35)),
				uCool: this.moodColor((p) => displayColor(p.cyan))
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			side: THREE.DoubleSide
		});
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(this.pool);
		this.scene.add(mesh);
		return mesh;
	}
}
