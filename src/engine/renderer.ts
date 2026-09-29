import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { WATER_DEPTH } from '../config';
import { World } from '../sim/world';
import { GeometryBuilder } from './geometryBuilder';
import { createCityMaterial, exposureUniform } from './materials';
import { OutputFxaaPass } from './outputFxaaPass';
import { C, shade } from './palette';

const SKY = new Color(0xbfd9ec);
const SUN_DIRECTION = new Vector3(-0.55, 1, 0.35).normalize();
const SKIRT_DEPTH = 2.5;
const EXPOSURE = 1.15;
const SHADOW_MAP_SIZE = 2048;
/** Shadow frustum half-sizes step through these levels so small zooms don't force a shadow re-render. */
const SHADOW_EXTENT_MIN = 14;
const SHADOW_EXTENT_MAX = 110;
const SHADOW_EXTENT_STEP = 1.25;

/** Resolution scaling: drop the pixel ratio when frames stay slower than this (ms) over a sample window. */
const SLOW_FRAME_MS = 26;
const FRAME_SAMPLE_WINDOW = 90;

/**
 * Integrated and mobile GPUs pay heavily for MSAA: on an Iris Xe at 1080p it took a frame from
 * about 5 ms to 10 ms. On those we render without it and smooth edges with a cheap FXAA pass
 * (about 6 ms in total) instead.
 */
function isLowPowerGpu(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /intel|iris|uhd|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic/i.test(name);
  } catch {
    return true;
  }
}

/** Owns the WebGL renderer, scene, camera and lighting. Game objects are added to `scene` by their managers. */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly sun: DirectionalLight;
  private base: Mesh | null = null;
  private shadowKey = '';
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio, 2);
  /** Adaptive resolution never goes below this; with FXAA a slightly lower resolution still looks clean. */
  private readonly minPixelRatio: number;
  private pixelRatio = this.maxPixelRatio;
  private frameTimeSum = 0;
  private frameSamples = 0;
  /** Set when rendering through FXAA instead of MSAA. */
  private readonly composer: EffectComposer | null = null;
  readonly antialiasing: 'msaa' | 'fxaa';
  /** Shared by every chunk mesh and the map base. */
  readonly cityMaterial: MeshLambertMaterial;
  /** Shared by instanced moving things (vehicles, pedestrians). Same look, separate program for instancing. */
  readonly agentMaterial: MeshLambertMaterial;

  constructor(readonly canvas: HTMLCanvasElement) {
    const lowPower = isLowPowerGpu();
    this.antialiasing = lowPower ? 'fxaa' : 'msaa';
    this.minPixelRatio = lowPower ? 0.75 : 1;
    this.gl = new WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(this.pixelRatio);
    // Several passes may run per frame with FXAA; stats are reset once per frame in render().
    this.gl.info.autoReset = false;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    // The city is static between edits, so the shadow map is only re-rendered on request.
    this.gl.shadowMap.autoUpdate = false;
    // With FXAA the city material tone-maps itself (see createCityMaterial), so the renderer must not.
    this.gl.toneMapping = lowPower ? NoToneMapping : ACESFilmicToneMapping;
    this.gl.toneMappingExposure = EXPOSURE;
    exposureUniform.uCityExposure.value = EXPOSURE;
    this.cityMaterial = createCityMaterial({ manualToneMapping: lowPower });
    this.agentMaterial = createCityMaterial({ manualToneMapping: lowPower });

    this.scene.background = SKY;
    this.scene.fog = new Fog(SKY, 100, 400);

    this.camera = new PerspectiveCamera(40, 1, 0.5, 1500);

    const hemi = new HemisphereLight(0xdfefff, 0x6b7a52, 0.95);
    this.scene.add(hemi);

    this.sun = new DirectionalLight(0xfff1d6, 2.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 400;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    if (lowPower) {
      // Tone-mapped colour fits an 8-bit buffer; sRGB storage keeps precision in the darks.
      const target = new WebGLRenderTarget(1, 1, { type: UnsignedByteType, colorSpace: SRGBColorSpace });
      this.composer = new EffectComposer(this.gl, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new OutputFxaaPass());
    }

    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
  }

  /** Re-renders the shadow map on the next frame; call after the city geometry changed. */
  requestShadowUpdate(): void {
    this.gl.shadowMap.needsUpdate = true;
  }

  /**
   * Keeps the shadow frustum centred on what the camera is looking at and sized to the zoom level,
   * so close-ups get crisp shadows while zoomed-out views still have them.
   *
   * Size and centre are quantised (the centre to whole multiples of shadow texels), so the shadow
   * map is only re-rendered when the view moved noticeably, and shadows don't shimmer while panning.
   */
  updateView(target: Vector3, distance: number): void {
    let extent = SHADOW_EXTENT_MIN;
    while (extent < distance * 0.95 && extent < SHADOW_EXTENT_MAX) extent *= SHADOW_EXTENT_STEP;
    const step = extent / 8;
    const cx = Math.round(target.x / step) * step;
    const cz = Math.round(target.z / step) * step;
    const key = `${extent.toFixed(3)}:${cx.toFixed(3)}:${cz.toFixed(3)}`;
    if (key !== this.shadowKey) {
      this.shadowKey = key;
      const cam = this.sun.shadow.camera;
      cam.left = -extent;
      cam.right = extent;
      cam.top = extent;
      cam.bottom = -extent;
      cam.updateProjectionMatrix();
      this.sun.target.position.set(cx, 0, cz);
      this.sun.position.copy(this.sun.target.position).addScaledVector(SUN_DIRECTION, 150);
      this.requestShadowUpdate();
    }

    const fog = this.scene.fog as Fog;
    fog.near = distance * 1.6;
    fog.far = distance * 4.5 + 120;
  }

  /** The "diorama" base: earth walls around the map edges, lowered where water meets the edge. */
  buildMapBase(world: World): void {
    if (this.base) {
      this.base.geometry.dispose();
      this.scene.remove(this.base);
    }
    const b = new GeometryBuilder();
    const n = world.size;
    const top = shade(C.dirt, 1.05);
    const bottom = shade(C.cliff, 0.55);
    for (let t = 0; t < n; t++) {
      // Each edge tile gets a wall segment, built in the frame facing out of the map.
      const edges: Array<[x: number, z: number, rot: number]> = [
        [t, n - 1, 0],
        [n - 1, t, 1],
        [t, 0, 2],
        [0, t, 3],
      ];
      for (const [x, z, rot] of edges) {
        const y0 = world.isWater(x, z) ? -WATER_DEPTH : 0;
        b.setFrame(x + 0.5, z + 0.5, rot);
        b.quad(-0.5, -SKIRT_DEPTH, 0.5, 0.5, -SKIRT_DEPTH, 0.5, 0.5, y0, 0.5, -0.5, y0, 0.5, bottom, 0, top);
      }
    }
    this.base = new Mesh(b.toGeometry(), this.cityMaterial);
    this.base.receiveShadow = true;
    this.scene.add(this.base);
    this.requestShadowUpdate();
  }

  /**
   * Feeds the time between two consecutive rendered frames. When frames stay slow over a whole
   * window, the render resolution drops a step (never below 1 CSS pixel per pixel), trading a little
   * sharpness for a smooth frame rate on weaker GPUs.
   */
  recordFrame(ms: number): void {
    if (ms > 250) return; // tab switches and hitches are not representative
    this.frameTimeSum += ms;
    this.frameSamples++;
    if (this.frameSamples < FRAME_SAMPLE_WINDOW) return;
    const avg = this.frameTimeSum / this.frameSamples;
    this.frameTimeSum = 0;
    this.frameSamples = 0;
    if (avg > SLOW_FRAME_MS && this.pixelRatio > this.minPixelRatio) {
      this.pixelRatio = Math.max(this.minPixelRatio, this.pixelRatio - 0.25);
      this.gl.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  get stats(): { calls: number; triangles: number; pixelRatio: number; maxPixelRatio: number; antialiasing: string } {
    const { calls, triangles } = this.gl.info.render;
    return {
      calls,
      triangles,
      pixelRatio: this.pixelRatio,
      maxPixelRatio: this.maxPixelRatio,
      antialiasing: this.antialiasing,
    };
  }

  render(): void {
    this.gl.info.reset();
    if (this.composer) this.composer.render();
    else this.gl.render(this.scene, this.camera);
  }
}
