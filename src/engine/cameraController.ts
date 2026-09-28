import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { CameraState } from '../sim/save';

const MIN_DISTANCE = 6;
const MAX_DISTANCE = 190;
const MIN_PITCH = MathUtils.degToRad(22);
const MAX_PITCH = MathUtils.degToRad(88);
const KEY_PAN_SPEED = 1.1; // screen heights per second
const KEY_ROTATE_SPEED = 1.8; // radians per second
const SMOOTHING = 12;
const DEFAULT_DISTANCE = 70;
const DEFAULT_YAW = MathUtils.degToRad(35);
const DEFAULT_PITCH = MathUtils.degToRad(52);

const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/**
 * City-builder camera orbiting a point on the ground.
 * - Right drag: grab-pan (the grabbed ground point stays under the cursor)
 * - Middle drag / Alt + left drag: rotate and tilt
 * - Wheel: zoom toward the cursor
 * - WASD / arrows pan, Q/E rotate, R/F tilt
 */
export class CameraController {
  readonly target: Vector3;
  distance = DEFAULT_DISTANCE;
  yaw = DEFAULT_YAW;
  pitch = DEFAULT_PITCH;

  /** Smoothed zoom goal; `distance` eases toward it. */
  private goalDistance = this.distance;
  private readonly keys = new Set<string>();
  private readonly raycaster = new Raycaster();
  private drag: { mode: 'pan' | 'orbit'; x: number; y: number; grab?: Vector3 } | null = null;
  private zoomAnchor: { x: number; y: number } | null = null;
  /** Cached so per-frame picking never forces a layout. */
  private rect: DOMRect;

  constructor(
    private readonly camera: PerspectiveCamera,
    dom: HTMLElement,
    private readonly mapSize: number,
  ) {
    this.target = new Vector3(mapSize / 2, 0, mapSize / 2);
    this.goalDistance = this.distance;
    this.rect = dom.getBoundingClientRect();
    new ResizeObserver(() => (this.rect = dom.getBoundingClientRect())).observe(dom);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.apply();
  }

  /** True while the user is dragging the camera; tools should ignore the pointer then. */
  get busy(): boolean {
    return this.drag !== null;
  }

  getState(): CameraState {
    return { x: this.target.x, z: this.target.z, distance: this.goalDistance, yaw: this.yaw, pitch: this.pitch };
  }

  setState(s: CameraState): void {
    this.target.set(s.x, 0, s.z);
    this.distance = this.goalDistance = MathUtils.clamp(s.distance, MIN_DISTANCE, MAX_DISTANCE);
    this.yaw = s.yaw;
    this.pitch = MathUtils.clamp(s.pitch, MIN_PITCH, MAX_PITCH);
    this.apply();
  }

  /** Back to the default overview of the whole map. */
  reset(): void {
    this.setState({
      x: this.mapSize / 2,
      z: this.mapSize / 2,
      distance: DEFAULT_DISTANCE,
      yaw: DEFAULT_YAW,
      pitch: DEFAULT_PITCH,
    });
  }

  lookAt(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.clampTarget();
    this.apply();
  }

  update(dt: number): void {
    const typing = document.activeElement instanceof HTMLInputElement;
    if (!typing && this.keys.size > 0) {
      const k = this.keys;
      const pan = KEY_PAN_SPEED * this.distance * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2.5 : 1);
      let fx = 0;
      let fz = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
      if (fx || fz) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        // Forward on screen is the camera's view direction projected on the ground.
        this.target.x += (fx * cos + fz * sin) * pan;
        this.target.z += (-fx * sin + fz * cos) * pan;
      }
      if (k.has('KeyQ')) this.yaw -= KEY_ROTATE_SPEED * dt;
      if (k.has('KeyE')) this.yaw += KEY_ROTATE_SPEED * dt;
      if (k.has('KeyR')) this.pitch = MathUtils.clamp(this.pitch + dt, MIN_PITCH, MAX_PITCH);
      if (k.has('KeyF')) this.pitch = MathUtils.clamp(this.pitch - dt, MIN_PITCH, MAX_PITCH);
      if (k.has('Equal') || k.has('NumpadAdd')) this.zoomBy(Math.exp(-2 * dt));
      if (k.has('Minus') || k.has('NumpadSubtract')) this.zoomBy(Math.exp(2 * dt));
      if (k.has('Equal') || k.has('NumpadAdd') || k.has('Minus') || k.has('NumpadSubtract')) this.zoomAnchor = null;
    }
    if (Math.abs(this.distance - this.goalDistance) > 1e-3) {
      // Zoom toward the cursor: keep the ground point under it fixed while the distance eases.
      const anchor = this.zoomAnchor;
      const before = anchor ? this.groundPoint(anchor.x, anchor.y) : null;
      this.distance = MathUtils.damp(this.distance, this.goalDistance, SMOOTHING, dt);
      this.apply();
      const after = anchor && before ? this.groundPoint(anchor.x, anchor.y) : null;
      if (before && after) {
        this.target.x += before.x - after.x;
        this.target.z += before.z - after.z;
      }
    } else {
      this.distance = this.goalDistance;
      this.zoomAnchor = null;
    }
    this.clampTarget();
    this.apply();
  }

  /** World-space point on the ground (y = 0) under the given client coordinates. */
  groundPoint(clientX: number, clientY: number, out = new Vector3()): Vector3 | null {
    return this.rayFrom(clientX, clientY).ray.intersectPlane(GROUND, out);
  }

  /** The shared raycaster, aimed through the given client coordinates. */
  rayFrom(clientX: number, clientY: number): Raycaster {
    const rect = this.rect;
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster;
  }

  private zoomBy(factor: number): void {
    this.goalDistance = MathUtils.clamp(this.goalDistance * factor, MIN_DISTANCE, MAX_DISTANCE);
  }

  private apply(): void {
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * cp * this.distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  private clampTarget(): void {
    this.target.x = MathUtils.clamp(this.target.x, 0, this.mapSize);
    this.target.z = MathUtils.clamp(this.target.z, 0, this.mapSize);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) {
      const grab = this.groundPoint(e.clientX, e.clientY);
      if (grab) this.drag = { mode: 'pan', x: e.clientX, y: e.clientY, grab };
    } else if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      this.drag = { mode: 'orbit', x: e.clientX, y: e.clientY };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const drag = this.drag;
    if (!drag) return;
    if (drag.mode === 'pan' && drag.grab) {
      const now = this.groundPoint(e.clientX, e.clientY);
      if (now) {
        this.target.x += drag.grab.x - now.x;
        this.target.z += drag.grab.z - now.z;
        this.clampTarget();
        this.apply();
      }
    } else if (drag.mode === 'orbit') {
      this.yaw -= (e.clientX - drag.x) * 0.006;
      this.pitch = MathUtils.clamp(this.pitch + (e.clientY - drag.y) * 0.005, MIN_PITCH, MAX_PITCH);
      drag.x = e.clientX;
      drag.y = e.clientY;
      this.apply();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.drag) return;
    if ((this.drag.mode === 'pan' && e.button === 2) || (this.drag.mode === 'orbit' && e.button !== 2)) this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomBy(Math.exp(e.deltaY * 0.0012));
    this.zoomAnchor = { x: e.clientX, y: e.clientY };
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    this.keys.add(e.code);
  };
}
