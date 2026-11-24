import {BoxGeometry, CircleGeometry, Group, Mesh} from 'three';
import {value} from './spatial-hud-layout.js';
import {hudMeshMaterial, setHudMeshColor} from './spatial-hud-color.js';

export const mapSize = 0.86;
const plotSize = mapSize - 0.09;
const defaultBounds = {minX: -6, maxX: 6, minZ: -6, maxZ: 6};
const markSegments = new Map([['stair', 3], ['outside', 4], ['portal', 6]]);

function tile(width, height, color) {
  return new Mesh(new BoxGeometry(width, height, 0.012), hudMeshMaterial(color));
}

export function createPointer(radius, color) {
  return new Mesh(new CircleGeometry(radius, 3), hudMeshMaterial(color));
}

export function posePointer(pointer, heading) {
  // Three's triangle points right when unrotated. North is up on the map.
  pointer.rotation.z = Math.PI / 2 - heading;
}

export function createMap(palette) {
  const group = new Group();
  group.name = 'hud-map';
  const plot = tile(plotSize, plotSize, palette.disabled);
  plot.name = 'hud-map-plot';
  plot.position.z = 0.012;
  const vertical = tile(0.009, plotSize, palette.background);
  const horizontal = tile(plotSize, 0.009, palette.background);
  for (const line of [vertical, horizontal]) line.position.z = 0.019;
  const viewer = createPointer(0.056, palette.text);
  viewer.name = 'hud-map-viewer';
  viewer.visible = false;
  group.add(plot, vertical, horizontal, viewer);
  return {group, plot, axis: [vertical, horizontal], viewer, marks: new Map()};
}

function normalized(value, lower, upper, span) {
  return Math.max(-0.47, Math.min(0.47, (value - lower - (upper - lower) / 2) / span));
}

function position(marker, {x, z}, bounds, depth) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  marker.position.set(normalized(x, bounds.minX, bounds.maxX, span) * plotSize,
    -normalized(z, bounds.minZ, bounds.maxZ, span) * plotSize, depth);
}

function point(entry) {
  return Number.isFinite(entry?.x) && Number.isFinite(entry?.z);
}

function validBounds(bounds) {
  return Number.isFinite(bounds?.minX) && Number.isFinite(bounds?.maxX)
    && Number.isFinite(bounds?.minZ) && Number.isFinite(bounds?.maxZ)
    && Number.isFinite(bounds.maxX - bounds.minX) && bounds.maxX > bounds.minX
    && Number.isFinite(bounds.maxZ - bounds.minZ) && bounds.maxZ > bounds.minZ;
}

export function updateMap(map, props, palette, release) {
  if (map.props === props && map.palette === palette) return;
  map.props = props;
  if (map.palette !== palette) {
    setHudMeshColor(map.plot.material, palette.disabled);
    for (const line of map.axis) setHudMeshColor(line.material, palette.background);
    setHudMeshColor(map.viewer.material, palette.text);
    map.palette = palette;
  }
  const candidates = value(props.marks);
  const inputBounds = value(props.bounds);
  const bounds = validBounds(inputBounds) ? inputBounds : defaultBounds;
  const selected = value(props.selected);
  const active = new Set();
  if (Array.isArray(candidates)) {
    for (const entry of candidates.slice(0, 128)) {
      if (!point(entry) || typeof entry.id !== 'string' || active.has(entry.id)) continue;
      const segments = markSegments.get(entry.kind) ?? 20;
      const color = selected === entry.id ? palette.focus : palette.pressed;
      active.add(entry.id);
      let marker = map.marks.get(entry.id);
      if (marker && marker.geometry.parameters.segments !== segments) {
        release(marker);
        marker = undefined;
      }
      if (!marker) {
        marker = new Mesh(new CircleGeometry(0.039, segments), hudMeshMaterial(color));
        marker.name = 'hud-map-mark:' + entry.id;
        if (segments === 3) marker.rotation.z = Math.PI / 2;
        map.group.add(marker);
        map.marks.set(entry.id, marker);
      }
      setHudMeshColor(marker.material, color);
      marker.scale.setScalar(selected === entry.id ? 1.35 : 1);
      position(marker, entry, bounds, 0.03);
    }
  }
  for (const [id, marker] of map.marks) {
    if (active.has(id)) continue;
    release(marker);
    map.marks.delete(id);
  }
  const viewer = value(props.viewer);
  map.viewer.visible = point(viewer);
  if (map.viewer.visible) {
    position(map.viewer, viewer, bounds, 0.041);
    posePointer(map.viewer, Number.isFinite(viewer.heading) ? viewer.heading : 0);
  }
}
