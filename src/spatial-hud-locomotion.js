import {CircleGeometry, Group, Matrix4, Mesh, Plane, Ray, Vector3} from 'three';
import {hudMeshMaterial} from './spatial-hud-color.js';

function disk(radius, color) {
  return new Mesh(new CircleGeometry(radius, 36), hudMeshMaterial(color));
}

export function createLocomotionControl(kind, palette) {
  const radius = kind === 'stick' ? 0.30 : 0.23;
  const group = new Group();
  const target = disk(radius, palette.button);
  target.position.z = 0.022;
  const indicator = disk(kind === 'stick' ? 0.092 : radius - 0.024, palette.focus);
  indicator.position.z = 0.033;
  indicator.name = 'hud-locomotion-indicator';
  indicator.visible = kind === 'stick';
  group.add(target, indicator);
  const ring = kind === 'jump' ? disk(radius + 0.014, palette.focus) : undefined;
  if (ring) {
    ring.position.z = 0.015;
    ring.visible = false;
    group.add(ring);
  }
  return {group, target, indicator, radius, ring, movement: kind};
}

export function createLocomotionInput(isAllowed) {
  let stick;
  let jump;
  let pulse;
  const plane = new Plane(new Vector3(0, 0, 1), -0.022);
  const inverse = new Matrix4();
  const localRay = new Ray();
  const hit = new Vector3();

  function release(capture) {
    if (capture === stick) {
      stick.row.indicator.position.set(0, 0, 0.033);
      stick = undefined;
    } else if (capture === jump) {
      jump.row.indicator.visible = false;
      jump = undefined;
    }
  }

  function resetUnavailable() {
    if (stick && !isAllowed(stick)) release(stick);
    if (jump && !isAllowed(jump)) release(jump);
    if (pulse && !isAllowed(pulse)) pulse = undefined;
  }

  function position(capture, ray) {
    const {row} = capture;
    row.group.updateWorldMatrix(true, false);
    inverse.copy(row.group.matrixWorld).invert();
    if (!localRay.copy(ray).applyMatrix4(inverse).intersectPlane(plane, hit)) return;
    const distance = Math.hypot(hit.x, hit.y);
    const radius = row.radius;
    const scale = Math.min(1, radius / (distance || radius));
    const travel = radius - 0.096;
    row.indicator.position.set(hit.x * scale * travel / radius, hit.y * scale * travel / radius, 0.033);
    capture.direction = distance > radius * 0.04 ? Math.atan2(hit.x, -hit.y) : null;
    capture.isSprinting = distance > radius * 0.6;
  }

  return {
    start(surfaceId, row, pointerId, ray) {
      const capture = {surfaceId, row, pointerId, direction: null, isSprinting: false};
      if (!isAllowed(capture)) return false;
      if (row.movement === 'stick' && !stick) {
        stick = capture;
        position(stick, ray);
        return true;
      }
      if (row.movement === 'jump' && !jump) {
        jump = capture;
        row.indicator.visible = true;
        return true;
      }
      return false;
    },
    move(pointerId, ray) {
      if (stick && stick.pointerId === pointerId) position(stick, ray);
    },
    end(pointerId) {
      if (stick && stick.pointerId === pointerId) release(stick);
      if (jump && jump.pointerId === pointerId) release(jump);
    },
    pulse(surfaceId, row) { pulse = {surfaceId, row}; },
    resetUnavailable,
    getOutput() {
      resetUnavailable();
      const jumping = Boolean(jump || pulse);
      pulse = undefined;
      const direction = stick?.direction ?? null;
      if (direction === null && !jumping) return null;
      return {direction, isSprinting: stick?.isSprinting ?? false, jump: jumping};
    },
  };
}
