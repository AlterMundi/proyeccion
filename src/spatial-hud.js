import {isWritable, NodeResolver, peekValue, ResolvedBinding} from '@a2ui/web_core';
import {
  BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, SRGBColorSpace,
} from 'three';
import {loadCatalog} from './catalog.js';
import {createProtocol} from './protocol.js';

const catalogId = 'https://altermundi.github.io/proyeccion/catalogs/spatial-hud/1.0';
const numeric = {type: 'number'};
const common = name => ({$ref: 'common_types.json#/$defs/' + name});
const definition = (name, properties, required) => ({
  type: 'object', properties: {component: {const: name}, ...properties},
  required: ['component', ...required],
});
const components = {
  HudPanel: definition('HudPanel', {children: common('ChildList')}, ['children']),
  HudText: definition('HudText', {label: common('DynamicString')}, ['label']),
  HudRange: definition('HudRange', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    value: common('DynamicNumber'), draft: common('DynamicNumber'),
    min: numeric, max: numeric, step: {type: 'number', exclusiveMinimum: 0}, action: common('Action'),
  }, ['label', 'value', 'draft', 'min', 'max', 'step', 'action']),
  HudChoice: definition('HudChoice', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    options: common('DynamicValue'), value: common('DynamicString'), draft: common('DynamicString'),
    action: common('Action'),
  }, ['label', 'options', 'value', 'draft', 'action']),
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
  background: '#111c26', button: '#294256', pressed: '#366c64', disabled: '#283540',
  text: '#f0f6f7', focus: '#f2ce85',
};
const rowHeight = 0.18;
const panelWidth = 1.6;
const rowWidth = 1.48;
const rangeWidth = 0.56;
const rangeCenter = 0.378;
const choicePageSize = 5;
const rangeKeys = new Set(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End']);
const activationKeys = new Set(['Tab', 'Enter', ' ', 'Escape', ...rangeKeys]);

function writableProposal(confirmed, draft) {
  return isWritable(draft) && (!isWritable(confirmed) || confirmed.path !== draft.path);
}

function choiceFrom(props) {
  const options = value(props.options);
  if (!Array.isArray(options) || options.length > 1024 || !writableProposal(props.value, props.draft)) return;
  const ids = new Set();
  for (const option of options) {
    if (typeof option?.id !== 'string' || typeof option.label !== 'string' || ids.has(option.id)) return;
    ids.add(option.id);
  }
  if (!options.some(option => !option.disabled)) return;
  const current = value(props.value);
  return {options, draft: props.draft, current, selection: options.find(option => option.id === current)?.label};
}

function rangeFrom(props) {
  const {min, max, step, draft} = props;
  const current = value(props.value);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min
      || !Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(Math.ceil((max - min) / step))
      || !Number.isFinite(current) || !writableProposal(props.value, draft)) return;
  return {min, max, step, draft, current: Math.min(max, Math.max(min, current))};
}

function commitRange(row, requested) {
  const {min, max, step, current, draft} = row.range;
  const quantized = min + Math.round((requested - min) / step) * step;
  const next = requested <= min ? min : requested >= max ? max
    : Math.min(max, Math.max(min, Number(quantized.toPrecision(14))));
  if (next === current) return;
  draft.set(next);
  void row.action();
}

function value(binding) {
  return binding instanceof ResolvedBinding ? binding.value : binding;
}

function isVisible(object) {
  for (let ancestor = object; ancestor; ancestor = ancestor.parent) {
    if (!ancestor.visible) return false;
  }
  return true;
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

function lettering(document, label, color, width = rowWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(768 * width / rowWidth);
  canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.font = '600 42px system-ui';
  context.textBaseline = 'middle';
  context.fillText(label.slice(0, 160), 24, 40, canvas.width - 48);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(width, 0.154),
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
  const targetsByMesh = new WeakMap();
  let focus;
  let paintedRing;
  let menu;
  let palette = {...defaultPalette};

  function removeSurface(id) {
    const surface = surfaces.get(id);
    if (!surface) return;
    if (focus?.surfaceId === id) clearFocus();
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
      surfaces.set(model.id, {group: panel, resolver: new NodeResolver(model), rows: new Map(), controls: []});
    },
    onSurfaceDeleted: removeSurface,
  });
  parent.add(group);

  function update() {
    for (const [surfaceId, surface] of surfaces) {
      const root = peekValue(surface.resolver.rootNode);
      const children = root?.type === 'HudPanel' ? peekValue(root.props).children ?? [] : [];
      const activeRows = new Set();
      surface.controls.length = 0;
      let index = 0;
      for (const node of children) {
        const choiceControl = node.type === 'HudChoice';
        const rangeControl = node.type === 'HudRange';
        const button = node.type === 'HudButton';
        if (node.type !== 'HudText' && !button && !rangeControl && !choiceControl) continue;
        const props = peekValue(node.props);
        const range = rangeControl ? rangeFrom(props) : undefined;
        let row = surface.rows.get(node.id);
        const choice = choiceControl ? (row?.props === props ? row.choice : choiceFrom(props)) : undefined;
        const selection = choice?.selection;
        const title = String(value(props.label) ?? '');
        const label = range ? title + ' · ' + range.current
          : choiceControl ? (selection ? title + ' · ' + selection : title) + '  ▾' : title;
        const disabled = value(props.disabled) === true || (rangeControl && !range) || (choiceControl && !choice);
        const fill = disabled ? palette.disabled : value(props.pressed) === true ? palette.pressed : palette.button;
        activeRows.add(node.id);
        if (!row) {
          const item = new Group();
          item.name = node.componentId;
          row = {group: item, instanceId: node.instanceId};
          if (button || rangeControl || choiceControl) {
            row.target = plate(rowWidth, 0.154, 0.048, fill);
            row.ring = plate(rowWidth + 0.02, 0.17, 0.011, palette.focus);
            row.ring.position.z = 0.011;
            row.ring.visible = false;
            item.add(row.target, row.ring);
            targetsByMesh.set(row.target, {surfaceId, row});
          }
          if (rangeControl) {
            row.rail = plate(rangeWidth, 0.012, 0.007, palette.text);
            row.rail.position.set(rangeCenter, 0, 0.031);
            row.knob = plate(0.035, 0.073, 0.014, palette.focus);
            item.add(row.rail, row.knob);
          }
          surface.group.add(item);
          surface.rows.set(node.id, row);
        }
        row.props = props;
        row.choice = choice;
        if (row.label !== label || row.text !== palette.text) {
          if (row.lettering) release(row.lettering);
          const labelWidth = rangeControl ? 0.81 : rowWidth;
          row.lettering = lettering(document, label, palette.text, labelWidth);
          row.lettering.position.x = (labelWidth - rowWidth) / 2;
          row.group.add(row.lettering);
          row.label = label;
          row.text = palette.text;
          row.rail?.material.color.set(palette.text);
        }
        row.group.position.set(0, -(index++ + 0.5) * rowHeight, 0);
        if (row.target) {
          if (row.fill !== fill) row.target.material.color.set(fill);
          row.fill = fill;
          row.action = disabled ? undefined : props.action;
          if (row.focusColor !== palette.focus) {
            row.ring.material.color.set(palette.focus);
            row.knob?.material.color.set(palette.focus);
          }
          row.focusColor = palette.focus;
          if (rangeControl) {
            row.range = range;
            row.rail.visible = row.knob.visible = Boolean(range);
            if (range) {
              const fraction = (range.current - range.min) / (range.max - range.min);
              row.knob.position.set(rangeCenter + (fraction - 0.5) * rangeWidth, 0, 0.037);
            }
          }
          if (typeof row.action === 'function') {
            surface.controls.push(row);
            if (menu?.row === row) {
              if (choice && isVisible(surface.group)) index += updateMenu();
              else closeMenu();
            }
          } else if (menu?.row === row) closeMenu();
        }
      }
      for (const [id, row] of surface.rows) {
        if (!activeRows.has(id)) {
          if (menu?.row === row) closeMenu();
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
    paintFocus();
  }

  function closeMenu() {
    if (!menu) return;
    release(menu.group);
    menu = undefined;
  }

  function openMenu(surfaceId, row) {
    if (menu?.row === row) {
      closeMenu();
      update();
      return;
    }
    closeMenu();
    const layer = new Group();
    layer.name = 'hud-choice-options';
    row.group.add(layer);
    const {current, options} = row.choice;
    const selected = options.find(option => option.id === current && !option.disabled);
    menu = {surfaceId, row, group: layer, highlight: selected?.id, cells: []};
    update();
  }

  function updateMenu() {
    const {row, group: layer} = menu;
    if (menu.choice === row.choice && menu.palette === palette && menu.lastHighlight === menu.highlight) {
      return menu.cells.length;
    }
    const {options, current} = row.choice;
    if (!options.some(option => option.id === menu.highlight && !option.disabled)) {
      menu.highlight = options.find(option => !option.disabled).id;
    }
    const highlight = options.findIndex(option => option.id === menu.highlight);
    const start = Math.floor(highlight / choicePageSize) * choicePageSize;
    const entries = options.slice(start, start + choicePageSize).map(option => ({
      label: (option.id === current ? '✓  ' : '') + option.label,
      fill: option.disabled ? palette.disabled : option.id === menu.highlight ? palette.pressed : palette.button,
      optionId: option.id, disabled: Boolean(option.disabled),
    }));
    if (options.slice(0, start).some(option => !option.disabled)) {
      entries.unshift({label: '↑', fill: palette.background, page: -1});
    }
    if (options.slice(start + choicePageSize).some(option => !option.disabled)) {
      entries.push({label: '↓', fill: palette.background, page: 1});
    }
    menu.choice = row.choice;
    menu.palette = palette;
    menu.lastHighlight = menu.highlight;
    const key = JSON.stringify([entries, palette.text]);
    if (menu.key === key) return entries.length;
    for (const cell of menu.cells) release(cell.group);
    menu.key = key;
    menu.cells = entries.map((entry, index) => {
      const item = new Group();
      item.position.y = -(index + 1) * rowHeight;
      item.name = entry.optionId === undefined ? 'hud-choice-page' : 'hud-choice-option';
      const target = plate(rowWidth, 0.154, 0.048, entry.fill);
      item.add(target, lettering(document, entry.label, palette.text));
      layer.add(item);
      targetsByMesh.set(target, {surfaceId: menu.surfaceId, row, entry});
      return {group: item, target};
    });
    return entries.length;
  }

  function chooseOption(row, id) {
    const {options, draft, current} = row.choice;
    if (!options.some(option => option.id === id && !option.disabled)) return;
    closeMenu();
    if (id !== current) {
      draft.set(id);
      void row.action();
    }
    update();
  }

  function moveChoice(key) {
    const options = menu.row.choice.options.filter(option => !option.disabled);
    const index = options.findIndex(option => option.id === menu.highlight);
    const delta = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
    const next = key === 'Home' ? 0 : key === 'End' ? options.length - 1
      : (index + delta + options.length) % options.length;
    menu.highlight = options[next].id;
    update();
  }

  function pageChoice(direction) {
    const options = menu.row.choice.options;
    const index = options.findIndex(option => option.id === menu.highlight);
    const start = Math.floor(index / choicePageSize) * choicePageSize;
    const candidates = direction > 0 ? options.slice(start + choicePageSize)
      : options.slice(0, start).reverse();
    const next = candidates.find(option => !option.disabled);
    if (next) {
      menu.highlight = next.id;
      update();
    }
  }

  function controlsFor(surfaceId) {
    const surface = surfaces.get(surfaceId);
    return surface && isVisible(surface.group) ? surface.controls : [];
  }

  function paintFocus() {
    const row = focus && controlsFor(focus.surfaceId).find(control => control.instanceId === focus.instanceId);
    if (paintedRing && paintedRing !== row?.ring) paintedRing.visible = false;
    paintedRing = row?.ring;
    if (paintedRing) paintedRing.visible = true;
    else focus = undefined;
  }

  function focusControl(surfaceId, instanceId) {
    update();
    const controls = controlsFor(surfaceId);
    const row = instanceId === undefined ? controls[0] : controls.find(item => item.instanceId === instanceId);
    if (!row) return false;
    if (menu?.row !== row) closeMenu();
    focus = {surfaceId, instanceId: row.instanceId};
    paintFocus();
    return true;
  }

  function clearFocus() {
    closeMenu();
    focus = undefined;
    paintFocus();
  }

  function handleKey(event, {surfaceId} = {}) {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!activationKeys.has(event.key)) return false;
    update();
    const controls = controlsFor(surfaceId);
    const index = focus?.surfaceId === surfaceId
      ? controls.findIndex(row => row.instanceId === focus.instanceId)
      : -1;
    if (menu?.surfaceId === surfaceId && event.key !== 'Tab') {
      if (event.key === 'Escape') closeMenu();
      else if (rangeKeys.has(event.key)) moveChoice(event.key);
      else if (!event.repeat) chooseOption(menu.row, menu.highlight);
      return true;
    }
    if (event.key === 'Tab' && controls.length) {
      closeMenu();
      const start = event.shiftKey ? controls.length : -1;
      const step = event.shiftKey ? -1 : 1;
      const next = (controls.length + (index === -1 ? start : index) + step) % controls.length;
      focus = {surfaceId, instanceId: controls[next].instanceId};
      paintFocus();
      return true;
    }
    if (index === -1) return false;
    const row = controls[index];
    if (event.key === 'Escape') {
      clearFocus();
    } else if (rangeKeys.has(event.key)) {
      if (!row.range) return false;
      if (!event.repeat) {
        const {min, max, step, current} = row.range;
        const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : step;
        commitRange(row, event.key === 'Home' ? min : event.key === 'End' ? max : current + delta);
      }
    } else if (row.choice && !event.repeat) {
      openMenu(surfaceId, row);
    } else if (!row.range && !row.choice && !event.repeat) {
      void row.action();
    }
    return true;
  }

  function activateRay(ray, {maxDistance = Infinity} = {}) {
    if (!isVisible(group)) return false;
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
    if (menu && isVisible(menu.group)) targets.push(...menu.cells.map(cell => cell.target));
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (!hit) {
      closeMenu();
      return false;
    }
    const target = targetsByMesh.get(hit.object);
    if (target?.entry) {
      if (target.entry.page) pageChoice(target.entry.page);
      else if (!target.entry.disabled) chooseOption(target.row, target.entry.optionId);
      return true;
    }
    if (menu?.row !== target?.row) closeMenu();
    if (typeof target?.row.action === 'function') {
      focus = {surfaceId: target.surfaceId, instanceId: target.row.instanceId};
      paintFocus();
      if (target.row.choice) {
        openMenu(target.surfaceId, target.row);
      } else if (target.row.range) {
        const x = target.row.group.worldToLocal(hit.point).x;
        const fraction = (x - rangeCenter) / rangeWidth + 0.5;
        if (fraction >= -0.04 && fraction <= 1.04) {
          const {min, max} = target.row.range;
          commitRange(target.row, min + fraction * (max - min));
        }
      } else {
        void target.row.action();
      }
    }
    // The panel owns the hit even when its nearest control is disabled.
    return true;
  }

  return {
    ...protocol, group, update, activateRay, handleKey, focusControl, clearFocus,
    currentFocus() { update(); return focus && {...focus}; },
    setPalette(colors) { palette = {...defaultPalette, ...colors}; },
    dispose() {
      for (const id of surfaces.keys()) removeSurface(id);
      protocol.dispose();
      group.removeFromParent();
    },
  };
}
