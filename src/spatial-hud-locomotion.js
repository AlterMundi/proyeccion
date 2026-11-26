import {CircleGeometry, Group, Matrix4, Mesh, Plane, Ray, RingGeometry, Vector3} from 'three';
import {hudMeshMaterial} from './spatial-hud-color.js';

function disk(radius, color) {
  return new Mesh(new CircleGeometry(radius, 36), hudMeshMaterial(color));
}

export function createLocomotionControl(kind, palette, optical = false) {
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
  const rim = optical ? new Mesh(new RingGeometry(radius - 0.013, radius, 48), hudMeshMaterial(palette.focus)) : undefined;
  if (rim) {
    rim.position.z = 0.037;
    group.add(rim);
  }
  return {group, target, indicator, radius, ring, rim, movement: kind};
}

export function createLocomotionInput(isAllowed) {
  let stick;
  const held = new Map();
  const pulses = new Map();
  const plane = new Plane(new Vector3(0, 0, 1), -0.022);
  const inverse = new Matrix4();
  const localRay = new Ray();
  const hit = new Vector3();

  function release(capture) {
    if (capture === stick) {
      stick.row.indicator.position.set(0, 0, 0.033);
      stick = undefined;
    } else {
      capture.row.indicator.visible = false;
      held.delete(capture.vertical);
    }
  }

  function resetUnavailable() {
    if (stick && !isAllowed(stick)) release(stick);
    for (const capture of held.values())
      if (!isAllowed(capture) || (capture.row.vertical ?? 0) !== capture.vertical) release(capture);
    for (const [vertical, pulse] of pulses)
      if (!isAllowed(pulse) || (pulse.row.vertical ?? 0) !== vertical) pulses.delete(vertical);
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
      const capture = {surfaceId, row, pointerId, direction: null, isSprinting: false, vertical: row.vertical ?? 0};
      if (!isAllowed(capture)) return false;
      if (row.movement === 'stick' && !stick) {
        stick = capture;
        position(stick, ray);
        return true;
      }
      if (row.movement === 'jump' && !held.has(capture.vertical)) {
        held.set(capture.vertical, capture);
        row.indicator.visible = true;
        return true;
      }
      return false;
    },
    move(pointerId, ray) {
      if (stick && stick.pointerId === pointerId) position(stick, ray);
    },
    end(pointerId, {commit = false} = {}) {
      if (stick && stick.pointerId === pointerId) release(stick);
      for (const capture of held.values()) {
        if (capture.pointerId !== pointerId) continue;
        if (commit && capture.vertical === 0 && !capture.sampled)
          pulses.set(0, capture);
        release(capture);
      }
    },
    pulse(surfaceId, row) { pulses.set(row.vertical ?? 0, {surfaceId, row}); },
    resetUnavailable,
    getOutput() {
      resetUnavailable();
      const groundJump = held.get(0);
      if (groundJump) groundJump.sampled = true;
      const jumping = Boolean(groundJump) || pulses.has(0);
      const up = held.has(1) || pulses.has(1), down = held.has(-1) || pulses.has(-1);
      pulses.clear();
      const direction = stick?.direction ?? null;
      if (direction === null && !jumping && !up && !down) return null;
      return {direction, isSprinting: stick?.isSprinting ?? false, jump: jumping,
        ...(up || down ? {vertical: Number(up) - Number(down)} : {})};
    },
  };
}
