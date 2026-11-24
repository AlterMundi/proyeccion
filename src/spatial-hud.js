import {NodeResolver, peekValue, ResolvedBinding} from '@a2ui/web_core';
import {
  BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace,
} from 'three';
import {loadCatalog} from './catalog.js';
import {createProtocol} from './protocol.js';

const catalogId = 'https://altermundi.github.io/proyeccion/catalogs/spatial-hud/1.0';
const common = name => ({$ref: 'common_types.json#/$defs/' + name});
const definition = (name, properties, required) => ({
  type: 'object', properties: {component: {const: name}, ...properties},
  required: ['component', ...required],
});
const components = {
  HudPanel: definition('HudPanel', {children: common('ChildList')}, ['children']),
  HudText: definition('HudText', {label: common('DynamicString')}, ['label']),
  HudButton: definition('HudButton', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    pressed: common('DynamicBoolean'), action: common('Action'),
  }, ['label', 'action']),
};
export const spatialHudCatalog = loadCatalog({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: catalogId, catalogId, protocolVersion: '1.0',
  title: 'Proyeccion spatial HUD', components,
  $defs: {
    anyComponent: {oneOf: Object.keys(components).map(name => ({$ref: '#/components/' + name})),
      discriminator: {propertyName: 'component'}},
    anyFunction: {not: {}},
  },
});

const defaultPalette = {
  background: '#111c26', button: '#294256', pressed: '#366c64', disabled: '#283540', text: '#f0f6f7',
};
const rowHeight = 0.18;
const panelWidth = 1.6;
const rowWidth = 1.48;

function value(binding) {
  return binding instanceof ResolvedBinding ? binding.value : binding;
}

function release(group) {
  group.traverse(object => {
    object.geometry?.dispose();
    object.material?.map?.dispose();
    object.material?.dispose();
  });
  group.removeFromParent();
}

function plate(width, height, depth, color) {
  return new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial({color, toneMapped: false}));
}

function lettering(document, label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.font = '600 42px system-ui';
  context.textBaseline = 'middle';
  context.fillText(label.slice(0, 160), 24, 40, 720);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(rowWidth, 0.154),
    new MeshBasicMaterial({map, transparent: true, depthWrite: false, toneMapped: false}));
  mesh.position.z = 0.035;
  return mesh;
}

/** Mount a native Three.js catalog. The host owns the camera, frame loop and input policy. */
export function createSpatialHud({parent, document, placeSurface = () => {}, ...transport}) {
  const group = new Group();
  group.name = 'Proyeccion spatial HUD';
  const surfaces = new Map();
  const raycaster = new Raycaster();
  let palette = {...defaultPalette};

  function removeSurface(id) {
    const surface = surfaces.get(id);
    if (!surface) return;
    surface.resolver.dispose();
    release(surface.group);
    surfaces.delete(id);
  }

  const protocol = createProtocol({
    ...transport, catalogs: [spatialHudCatalog],
    onSurfaceCreated(model) {
      const panel = new Group();
      panel.name = model.id;
      placeSurface(panel, model.id);
      group.add(panel);
      surfaces.set(model.id, {group: panel, resolver: new NodeResolver(model), rows: new Map()});
    },
    onSurfaceDeleted: removeSurface,
  });
  parent.add(group);

  function update() {
    for (const surface of surfaces.values()) {
      const root = peekValue(surface.resolver.rootNode);
      const children = root?.type === 'HudPanel' ? peekValue(root.props).children ?? [] : [];
      const activeRows = new Set();
      let index = 0;
      for (const node of children) {
        if (node.type !== 'HudText' && node.type !== 'HudButton') continue;
        const props = peekValue(node.props);
        const label = String(value(props.label) ?? '');
        const button = node.type === 'HudButton';
        const disabled = value(props.disabled) === true;
        const fill = disabled ? palette.disabled : value(props.pressed) === true ? palette.pressed : palette.button;
        activeRows.add(node.id);
        let row = surface.rows.get(node.id);
        if (!row || row.label !== label || row.fill !== fill || row.text !== palette.text) {
          if (row) release(row.group);
          const item = new Group();
          item.name = node.componentId;
          const target = button ? plate(rowWidth, 0.154, 0.048, fill) : undefined;
          if (target) item.add(target);
          item.add(lettering(document, label, palette.text));
          surface.group.add(item);
          row = {group: item, target, label, fill, text: palette.text};
          surface.rows.set(node.id, row);
        }
        row.group.position.set(0, -(index++ + 0.5) * rowHeight, 0);
        if (row.target) row.target.userData.action = disabled ? undefined : props.action;
      }
      for (const [id, row] of surface.rows) {
        if (!activeRows.has(id)) {
          release(row.group);
          surface.rows.delete(id);
        }
      }
      if (surface.height !== index || surface.backgroundColor !== palette.background) {
        if (surface.background) release(surface.background);
        surface.background = index ? plate(panelWidth, index * rowHeight + 0.06, 0.04, palette.background) : undefined;
        if (surface.background) {
          surface.background.position.set(0, -index * rowHeight / 2, -0.044);
          surface.group.add(surface.background);
        }
        surface.height = index;
        surface.backgroundColor = palette.background;
      }
    }
  }

  function activateRay(ray, {maxDistance = Infinity} = {}) {
    for (let ancestor = group; ancestor; ancestor = ancestor.parent) {
      if (!ancestor.visible) return false;
    }
    update();
    group.updateWorldMatrix(true, true);
    raycaster.ray.copy(ray);
    raycaster.far = maxDistance;
    const targets = [];
    for (const surface of surfaces.values()) {
      if (!surface.group.visible) continue;
      if (surface.background) targets.push(surface.background);
      for (const {target} of surface.rows.values()) if (target) targets.push(target);
    }
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) return false;
    const action = hit.object.userData.action;
    if (typeof action === 'function') void action();
    // The panel owns the hit even when its nearest control is disabled.
    return true;
  }

  return {
    ...protocol, group, update, activateRay,
    setPalette(colors) { palette = {...defaultPalette, ...colors}; },
    dispose() {
      for (const id of surfaces.keys()) removeSurface(id);
      protocol.dispose();
      group.removeFromParent();
    },
  };
}
