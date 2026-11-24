import {isWritable, NodeResolver, peekValue} from '@a2ui/web_core';
import {
  BoxGeometry, CanvasTexture, Group, Matrix4, Mesh, MeshBasicMaterial, Plane, PlaneGeometry,
  Ray, Raycaster, SRGBColorSpace, Vector3,
} from 'three';
import {loadCatalog} from './catalog.js';
import {createProtocol} from './protocol.js';
import {createTextEditor} from './spatial-hud-text.js';
import {layoutHud, value} from './spatial-hud-layout.js';
import {createMap, createPointer, mapSize, posePointer, updateMap} from './spatial-hud-map.js';
import {createHudAccessibility} from './spatial-hud-accessibility.js';
import {createLocomotionControl, createLocomotionInput} from './spatial-hud-locomotion.js';

export {bindSpatialHudPointer} from './spatial-hud-pointer.js';

const catalogId = 'https://altermundi.github.io/proyeccion/catalogs/spatial-hud/1.0';
const numeric = {type: 'number'};
const common = name => ({$ref: 'common_types.json#/$defs/' + name});
const definition = (name, properties, required) => ({
  type: 'object', properties: {component: {const: name}, visible: common('DynamicBoolean'),
    weight: {type: 'number', minimum: 0.25, maximum: 8}, ...properties},
  required: ['component', ...required],
});
const layout = {children: common('ChildList'), gap: {type: 'number', minimum: 0, maximum: 0.3}};
const components = {
  HudPanel: definition('HudPanel', {...layout, label: common('DynamicString'),
    width: {type: 'number', minimum: 0.5, maximum: 8}}, ['children']),
  HudRow: definition('HudRow', layout, ['children']),
  HudColumn: definition('HudColumn', layout, ['children']),
  HudText: definition('HudText', {
    label: common('DynamicString'), lines: {type: 'integer', minimum: 1, maximum: 8},
    style: {enum: ['title', 'body', 'status']},
  }, ['label']),
  HudStick: definition('HudStick', {label: common('DynamicString'), disabled: common('DynamicBoolean')}, ['label']),
  HudJump: definition('HudJump', {label: common('DynamicString'), disabled: common('DynamicBoolean')}, ['label']),
  HudMap: definition('HudMap', {
    marks: common('DynamicValue'), bounds: common('DynamicValue'), label: common('DynamicString'),
    viewer: common('DynamicValue'), selected: common('DynamicString'),
  }, ['marks']),
  HudBearing: definition('HudBearing', {
    label: common('DynamicString'), heading: common('DynamicNumber'), distance: common('DynamicString'),
  }, ['label', 'heading']),
  HudRange: definition('HudRange', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    value: common('DynamicNumber'), draft: common('DynamicNumber'),
    min: numeric, max: numeric, step: {type: 'number', exclusiveMinimum: 0}, action: common('Action'),
  }, ['label', 'value', 'draft', 'min', 'max', 'step', 'action']),
  HudTextInput: definition('HudTextInput', {
    label: common('DynamicString'), value: common('DynamicString'), draft: common('DynamicString'),
    placeholder: common('DynamicString'), disabled: common('DynamicBoolean'),
    multiline: {type: 'boolean'}, maxLength: {type: 'integer', minimum: 1, maximum: 4000},
    action: common('Action'),
  }, ['label', 'value', 'draft', 'action']),
  HudChoice: definition('HudChoice', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    options: common('DynamicValue'), value: common('DynamicString'), draft: common('DynamicString'),
    action: common('Action'),
  }, ['label', 'options', 'value', 'draft', 'action']),
  HudButton: definition('HudButton', {
    label: common('DynamicString'), disabled: common('DynamicBoolean'),
    pressed: common('DynamicBoolean'), submitFor: {type: 'string'}, action: common('Action'),
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
const textInputHeight = 0.34;
const panelPadding = 0.12;
const rowWidth = 1.48;
const rangeWidth = 0.56;
const rangeCenter = 0.378;
const choicePageSize = 5;
const modalBackground = Symbol('HUD modal background');
const rangeKeys = new Set(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End']);
const activationKeys = new Set(['Tab', 'Enter', ' ', 'Escape', ...rangeKeys]);

function writableProposal(confirmed, draft) {
  return isWritable(draft) && (!isWritable(confirmed) || confirmed.path !== draft.path);
}

function textFrom(props) {
  if (!writableProposal(props.value, props.draft)) return;
  const confirmed = value(props.value);
  const maxLength = props.maxLength ?? 2000;
  if (typeof confirmed !== 'string' || !Number.isInteger(maxLength) || maxLength < 1 || maxLength > 4000) return;
  return {confirmed, maxLength, draft: props.draft, multiline: props.multiline === true,
    placeholder: String(value(props.placeholder) ?? '')};
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

function quantizeRange({min, max, step}, requested) {
  const quantized = min + Math.round((requested - min) / step) * step;
  return requested <= min ? min : requested >= max ? max
    : Math.min(max, Math.max(min, Number(quantized.toPrecision(14))));
}

function commitRange(row, requested) {
  const next = quantizeRange(row.range, requested);
  if (next === row.range.current) return;
  row.range.draft.set(next);
  void row.action();
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

function lettering(document, label, color, width = rowWidth, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, Math.max(96, Math.round(768 * width * scale / rowWidth)));
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

function textHeight(lines) {
  return lines > 1 ? lines * 0.084 + 0.065 : rowHeight;
}

function paragraphLettering(document, label, color, lines, style, scale) {
  const canvas = document.createElement('canvas');
  const height = textHeight(lines) - 0.026;
  canvas.width = Math.min(2048, Math.max(96, Math.round(768 * scale)));
  canvas.height = Math.round(height * 520);
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.font = style === 'title' ? '700 42px system-ui' : '400 34px system-ui';
  context.textBaseline = 'middle';
  const width = canvas.width - 48;
  const rows = [];
  let line = '';
  let overflow = label.length > 4000;
  for (const word of label.slice(0, 4000).match(/\r?\n|[^\s]+/gu) ?? []) {
    if (rows.length >= lines) {
      overflow = true;
      break;
    }
    if (word === '\n' || word === '\r\n') {
      rows.push(line);
      line = '';
      continue;
    }
    const next = line ? line + ' ' + word : word;
    if (line && context.measureText(next).width > width) {
      rows.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (rows.length < lines) rows.push(line);
  else if (line) overflow = true;
  rows.forEach((text, index) => {
    let fit = text;
    if ((overflow && index === rows.length - 1) || context.measureText(text).width > width) {
      const glyphs = Array.from(text);
      let min = 0;
      let max = glyphs.length;
      while (min < max) {
        const mid = Math.ceil((min + max) / 2);
        if (context.measureText(glyphs.slice(0, mid).join('') + '…').width <= width) min = mid;
        else max = mid - 1;
      }
      fit = glyphs.slice(0, min).join('') + '…';
    }
    context.fillText(fit, 24, (index + 0.5) * canvas.height / lines, width);
  });
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(rowWidth, height),
    new MeshBasicMaterial({map, transparent: true, depthWrite: false, toneMapped: false}));
  mesh.position.z = 0.035;
  return mesh;
}

function fieldLettering(document, {label, text, caret, color, focusColor, placeholder, scale}) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, Math.max(96, Math.round(768 * scale)));
  canvas.height = 164;
  const context = canvas.getContext('2d');
  context.fillStyle = focusColor;
  context.font = '600 33px system-ui';
  const lineWidth = canvas.width - 48;
  context.fillText(label.slice(0, 160), 24, 43, lineWidth);
  context.fillStyle = color;
  context.font = '400 32px system-ui';
  const marker = '\u0000';
  const visible = caret === undefined ? (text || placeholder)
    : text.slice(0, caret) + marker + text.slice(caret);
  const lines = [];
  let line = '';
  for (const char of visible) {
    const next = line + char;
    if (char === '\n' || context.measureText(next.replace(marker, '▏')).width > lineWidth) {
      lines.push(line);
      line = char === '\n' ? '' : char;
    } else {
      line = next;
    }
  }
  lines.push(line);
  const cursorLine = lines.findIndex(line => line.includes(marker));
  const start = Math.max(0, cursorLine - 1);
  lines.slice(start, start + 2).forEach((part, index) => {
    context.fillText(part.replace(marker, '▏'), 24, 94 + index * 43, lineWidth);
  });
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(new PlaneGeometry(rowWidth, textInputHeight - 0.026),
    new MeshBasicMaterial({map, transparent: true, depthWrite: false, toneMapped: false}));
  mesh.position.z = 0.035;
  return mesh;
}

/** Mount a native Three.js catalog. The host owns the camera, frame loop and input policy. */
export function createSpatialHud({parent, document, accessibilityRoot, placeSurface = () => {}, ...transport}) {
  if (accessibilityRoot && accessibilityRoot.ownerDocument !== document) {
    throw new TypeError('The HUD accessibility root must belong to its owning document');
  }
  const group = new Group();
  group.name = 'Proyeccion spatial HUD';
  const surfaces = new Map();
  const raycaster = new Raycaster();
  const rangePlane = new Plane(new Vector3(0, 0, 1), -0.024);
  const inverse = new Matrix4();
  const localRay = new Ray();
  const localHit = new Vector3();
  const targetsByMesh = new WeakMap();
  const textEditor = createTextEditor(document);
  const locomotion = createLocomotionInput(({surfaceId, row}) =>
    canInteract(surfaceId) && row.group.parent && !row.disabled);
  const accessibility = accessibilityRoot && createHudAccessibility(accessibilityRoot, {
    focusControl, activate: activateAccessible,
  });
  let focus;
  let paintedRing;
  let menu;
  let editing;
  let rangeDrag;
  let interactiveSurfaces;
  let blockOutside = false;
  let palette = {...defaultPalette};

  function removeSurface(id) {
    const surface = surfaces.get(id);
    if (!surface) return;
    if (focus?.surfaceId === id) clearFocus();
    if (rangeDrag?.surfaceId === id) cancelRangeDrag();
    surface.resolver.dispose();
    release(surface.group);
    surfaces.delete(id);
    locomotion.resetUnavailable();
  }

  const protocol = createProtocol({
    ...transport, catalogs: [spatialHudCatalog],
    onSurfaceCreated(model) {
      const panel = new Group();
      panel.name = model.id;
      placeSurface(panel, model.id);
      group.add(panel);
      surfaces.set(model.id, {group: panel, resolver: new NodeResolver(model), rows: new Map(),
        controls: [], semanticRows: []});
    },
    onSurfaceDeleted: removeSurface,
  });
  parent.add(group);

  function updateLocomotion(surfaceId, surface, activeRows, node, x, top, width) {
    const props = peekValue(node.props);
    activeRows.add(node.id);
    let row = surface.rows.get(node.id);
    const kind = node.type === 'HudStick' ? 'stick' : 'jump';
    if (!row) {
      row = createLocomotionControl(kind, palette);
      row.group.name = node.componentId;
      row.instanceId = node.instanceId;
      row.type = node.type;
      surface.group.add(row.group);
      surface.rows.set(node.id, row);
      targetsByMesh.set(row.target, {surfaceId, row});
    }
    row.disabled = value(props.disabled) === true;
    row.semanticLabel = String(value(props.label) ?? '');
    if (kind === 'jump') {
      row.action = row.disabled ? undefined : () => locomotion.pulse(surfaceId, row);
      if (!row.disabled) surface.controls.push(row);
      if (row.label !== row.semanticLabel || row.text !== palette.text) {
        if (row.lettering) release(row.lettering);
        row.lettering = lettering(document, row.semanticLabel, palette.text, row.radius * 1.8);
        row.lettering.position.z = 0.04;
        row.group.add(row.lettering);
        row.label = row.semanticLabel;
        row.text = palette.text;
      }
    }
    if (accessibility) surface.semanticRows.push(row);
    row.target.material.color.set(row.disabled ? palette.disabled : palette.button);
    row.indicator.material.color.set(palette.focus);
    row.ring?.material.color.set(palette.focus);
    const size = row.radius * 2 + 0.04;
    const scale = Math.min(1, width / size);
    row.group.scale.setScalar(scale);
    row.group.position.set(x, top - size * scale / 2, 0);
    return size * scale;
  }

  function updateLeaf(surfaceId, surface, activeRows, node, x, top, width) {
    if (node.type === 'HudStick' || node.type === 'HudJump') {
      return updateLocomotion(surfaceId, surface, activeRows, node, x, top, width);
    }
    if (node.type === 'HudMap') {
      activeRows.add(node.id);
      let map = surface.rows.get(node.id);
      if (!map) {
        map = createMap(palette);
        map.group.name = node.componentId;
        surface.group.add(map.group);
        surface.rows.set(node.id, map);
      }
      const scale = Math.min(1, width / mapSize);
      const height = mapSize * scale;
      map.group.position.set(x, top - height / 2, 0);
      map.group.scale.setScalar(scale);
      const props = peekValue(node.props);
      updateMap(map, props, palette, release);
      if (accessibility) {
        map.type = node.type;
        map.semanticLabel = value(props.label);
        surface.semanticRows.push(map);
      }
      return height;
    }
    const textControl = node.type === 'HudTextInput';
    const choiceControl = node.type === 'HudChoice';
    const rangeControl = node.type === 'HudRange';
    const button = node.type === 'HudButton';
    const bearing = node.type === 'HudBearing';
    const textLabel = node.type === 'HudText';
    if (!bearing && !textLabel && !button && !rangeControl && !choiceControl && !textControl) return 0;
    const props = peekValue(node.props);
    const range = rangeControl ? rangeFrom(props) : undefined;
    let row = surface.rows.get(node.id);
    const choice = choiceControl ? (row?.props === props ? row.choice : choiceFrom(props)) : undefined;
    const text = textControl ? (row?.props === props ? row.field : textFrom(props)) : undefined;
    const selection = choice?.selection;
    const title = String(value(props.label) ?? '');
    const distance = bearing && value(props.distance);
    const label = distance ? title + ' · ' + distance : range ? title + ' · ' + range.current
      : choiceControl ? (selection ? title + ' · ' + selection : title) + '  ▾' : title;
    const disabled = value(props.disabled) === true || (rangeControl && !range)
      || (choiceControl && !choice) || (textControl && !text);
    const lines = textLabel ? props.lines ?? 1 : 1;
    const style = textLabel ? props.style : undefined;
    const thickness = textControl ? textInputHeight : textHeight(lines);
    const pressed = value(props.pressed);
    const fill = disabled ? palette.disabled : pressed === true ? palette.pressed : palette.button;
    activeRows.add(node.id);
    if (!row) {
      const item = new Group();
      item.name = node.componentId;
      row = {group: item, instanceId: node.instanceId};
      if (button || rangeControl || choiceControl || textControl) {
        row.target = plate(rowWidth, thickness - 0.026, 0.048, fill);
        row.ring = plate(rowWidth + 0.02, thickness - 0.01, 0.011, palette.focus);
        row.ring.position.z = 0.011;
        row.ring.visible = false;
        item.add(row.target, row.ring);
        targetsByMesh.set(row.target, {surfaceId, row});
      }
      if (bearing) {
        row.pointer = createPointer(0.045, palette.focus);
        row.pointer.name = 'hud-bearing-pointer';
        row.pointer.position.set(-0.64, 0, 0.035);
        item.add(row.pointer);
      }
      if (rangeControl) {
        row.rail = plate(rangeWidth, 0.012, 0.007, palette.text);
        row.rail.position.set(rangeCenter, 0, 0.031);
        row.knob = plate(0.035, 0.073, 0.014, palette.focus);
        row.preview = plate(0.031, 0.095, 0.014, palette.text);
        row.preview.name = 'hud-range-preview';
        row.preview.material.transparent = true;
        row.preview.material.opacity = 0.65;
        row.preview.material.depthWrite = false;
        row.preview.visible = false;
        item.add(row.rail, row.knob, row.preview);
      }
      surface.group.add(item);
      surface.rows.set(node.id, row);
    }
    row.props = props;
    row.choice = choice;
    row.field = text;
    row.submitFor = button ? props.submitFor : undefined;
    if (editing?.row === row && (disabled || !canInteract(surfaceId))) stopText();
    const scale = width / rowWidth;
    row.group.scale.x = scale;
    const textColor = style === 'status' ? palette.focus : palette.text;
    if (textControl) paintField(row, title, scale);
    else if (row.label !== label || row.text !== textColor || row.scale !== scale
        || row.lines !== lines || row.style !== style) {
      if (row.lettering) release(row.lettering);
      const labelWidth = rangeControl ? 0.81 : bearing ? 1.29 : rowWidth;
      row.lettering = textLabel && (lines > 1 || style)
        ? paragraphLettering(document, label, textColor, lines, style, scale)
        : lettering(document, label, textColor, labelWidth, scale);
      row.lettering.position.x = (labelWidth - rowWidth) / (bearing ? -2 : 2);
      row.group.add(row.lettering);
      row.label = label;
      row.text = textColor;
      row.scale = scale;
      row.lines = lines;
      row.style = style;
      row.rail?.material.color.set(palette.text);
      row.preview?.material.color.set(palette.text);
    }
    if (bearing) {
      const heading = value(props.heading);
      row.pointer.visible = Number.isFinite(heading);
      if (row.pointer.visible) posePointer(row.pointer, heading);
      if (row.focusColor !== palette.focus) row.pointer.material.color.set(palette.focus);
      row.focusColor = palette.focus;
    }
    row.group.position.set(x, top - thickness / 2, 0);
    let height = thickness;
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
          if (choice && canInteract(surfaceId)) height += updateMenu() * rowHeight;
          else closeMenu();
        }
      } else if (menu?.row === row) closeMenu();
    }
    if (accessibility) {
      row.type = node.type;
      row.semanticLabel = bearing ? label : title;
      row.pressed = pressed;
      surface.semanticRows.push(row);
    }
    return height;
  }

  function update() {
    const accessibleSurfaces = [];
    for (const [surfaceId, surface] of surfaces) {
      const root = peekValue(surface.resolver.rootNode);
      const activeRows = new Set();
      surface.controls.length = 0;
      surface.semanticRows.length = 0;
      const {width, height} = layoutHud(root, (node, x, top, width) =>
        updateLeaf(surfaceId, surface, activeRows, node, x, top, width));
      for (const [id, row] of surface.rows) {
        if (!activeRows.has(id)) {
          if (menu?.row === row) closeMenu();
          if (editing?.row === row) stopText();
          if (rangeDrag?.row === row) cancelRangeDrag();
          release(row.group);
          surface.rows.delete(id);
        }
      }
      if (surface.height !== height || surface.width !== width || surface.backgroundColor !== palette.background) {
        if (surface.background) release(surface.background);
        surface.background = height ? plate(width + panelPadding, height + 0.06, 0.04, palette.background) : undefined;
        if (surface.background) {
          surface.background.position.set(0, -height / 2, -0.044);
          surface.group.add(surface.background);
        }
        surface.height = height;
        surface.width = width;
        surface.backgroundColor = palette.background;
      }
      if (accessibility && surface.semanticRows.length && canInteract(surfaceId)) {
        accessibleSurfaces.push({
          id: surfaceId, label: value(peekValue(root.props).label) || surfaceId,
          rows: surface.semanticRows,
        });
      }
    }
    paintFocus();
    validateRangeDrag();
    locomotion.resetUnavailable();
    accessibility?.render(accessibleSurfaces);
  }

  function paintField(row, label, scale) {
    const active = editing?.row === row;
    const text = row.localText ?? row.field?.confirmed ?? '';
    const caret = active ? row.caret : undefined;
    const placeholder = row.field?.placeholder ?? '';
    const paint = {label, text, caret, placeholder, scale, color: palette.text, focusColor: palette.focus};
    const key = JSON.stringify(paint);
    if (row.fieldPaint === key) return;
    if (row.lettering) release(row.lettering);
    row.lettering = fieldLettering(document, paint);
    row.group.add(row.lettering);
    row.fieldPaint = key;
    row.label = label;
  }

  function stopText() {
    textEditor.stop();
    editing = undefined;
  }

  function beginText(surfaceId, row) {
    if (editing?.row === row) return;
    closeMenu();
    stopText();
    const {confirmed, multiline, maxLength} = row.field;
    const text = (row.localText ?? confirmed).slice(0, maxLength);
    row.caret = Math.min(row.caret ?? text.length, text.length);
    editing = {surfaceId, row};
    if (!textEditor.begin({
      label: row.label, text, caret: row.caret, maxLength, multiline,
      onEdit(next, caret) {
        row.localText = next === row.field?.confirmed ? undefined : next;
        row.caret = caret;
      },
      onFinish(outcome, event) {
        editing = undefined;
        if (outcome === 'tab') {
          moveFocus(surfaceId, event.shiftKey);
        } else if (outcome === 'cancel') {
          row.localText = undefined;
          row.caret = undefined;
        } else if (outcome === 'submit') {
          update();
          if (controlsFor(surfaceId).includes(row)) submitText(row, row.action);
        }
        update();
      },
    })) editing = undefined;
    update();
  }

  function submitText(row, action) {
    if (row.localText === undefined) return;
    const proposed = row.localText.slice(0, row.field.maxLength);
    if (proposed !== row.field.confirmed) {
      row.field.draft.set(proposed);
      void action();
    }
    row.localText = undefined;
    row.caret = undefined;
  }

  function activateButton(surfaceId, row) {
    if (row.submitFor === undefined) {
      void row.action();
      return;
    }
    const field = controlsFor(surfaceId).find(control => control.instanceId === row.submitFor && control.field);
    if (field) submitText(field, row.action);
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
    if (menu.choice === row.choice && menu.palette === palette && menu.lastHighlight === menu.highlight
        && menu.scale === row.group.scale.x) {
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
    menu.scale = row.group.scale.x;
    const scale = row.group.scale.x;
    const key = JSON.stringify([entries, palette.text, scale]);
    if (menu.key === key) return entries.length;
    for (const cell of menu.cells) release(cell.group);
    menu.key = key;
    menu.cells = entries.map((entry, index) => {
      const item = new Group();
      item.position.y = -(index + 1) * rowHeight;
      item.name = entry.optionId === undefined ? 'hud-choice-page' : 'hud-choice-option';
      const target = plate(rowWidth, 0.154, 0.048, entry.fill);
      item.add(target, lettering(document, entry.label, palette.text, rowWidth, scale));
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

  function canInteract(surfaceId) {
    const surface = surfaces.get(surfaceId);
    return surface && (!interactiveSurfaces || interactiveSurfaces.has(surfaceId)) && isVisible(surface.group);
  }

  function controlsFor(surfaceId) {
    return canInteract(surfaceId) ? surfaces.get(surfaceId).controls : [];
  }

  function setInteractionScope({surfaceIds, blockOutside: consumeMisses = false} = {}) {
    interactiveSurfaces = surfaceIds === undefined ? undefined : new Set(surfaceIds);
    blockOutside = consumeMisses;
    if (menu && !canInteract(menu.surfaceId)) closeMenu();
    if (editing && !canInteract(editing.surfaceId)) stopText();
    if (rangeDrag && !canInteract(rangeDrag.surfaceId)) cancelRangeDrag();
    update();
  }

  function paintFocus() {
    const row = focus && controlsFor(focus.surfaceId).find(control => control.instanceId === focus.instanceId);
    if (paintedRing && paintedRing !== row?.ring) paintedRing.visible = false;
    paintedRing = row?.ring;
    if (paintedRing) paintedRing.visible = true;
    if (!row) focus = undefined;
  }

  function activateAccessible(surfaceId, row, proposal) {
    update();
    if (!controlsFor(surfaceId).includes(row) || rangeDrag) return;
    focus = {surfaceId, instanceId: row.instanceId};
    if (row.field) beginText(surfaceId, row);
    else if (row.choice) chooseOption(row, proposal);
    else if (row.range && Number.isFinite(proposal)) commitRange(row, proposal);
    else if (row.type === 'HudButton' || row.type === 'HudJump') activateButton(surfaceId, row);
    update();
  }

  function focusControl(surfaceId, instanceId) {
    update();
    const controls = controlsFor(surfaceId);
    const row = instanceId === undefined ? controls[0] : controls.find(item => item.instanceId === instanceId);
    if (!row) return false;
    if (menu?.row !== row) closeMenu();
    if (editing?.row !== row) stopText();
    if (rangeDrag?.row !== row) cancelRangeDrag();
    focus = {surfaceId, instanceId: row.instanceId};
    paintFocus();
    return true;
  }

  function clearFocus() {
    closeMenu();
    stopText();
    cancelRangeDrag();
    focus = undefined;
    paintFocus();
  }

  function moveFocus(surfaceId, reverse) {
    const controls = controlsFor(surfaceId);
    if (!controls.length) return;
    const index = focus?.surfaceId === surfaceId
      ? controls.findIndex(row => row.instanceId === focus.instanceId) : -1;
    const start = reverse ? controls.length : -1;
    const step = reverse ? -1 : 1;
    const next = (controls.length + (index === -1 ? start : index) + step) % controls.length;
    focus = {surfaceId, instanceId: controls[next].instanceId};
    paintFocus();
  }

  function handleKey(event, {surfaceId} = {}) {
    if (textEditor.owns(event.target) || accessibility?.owns(event.target) || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!activationKeys.has(event.key)) return false;
    if (rangeDrag?.surfaceId === surfaceId) {
      if (event.key === 'Escape') return cancelRangeDrag();
      if (event.key !== 'Tab') return true;
      cancelRangeDrag();
    }
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
      stopText();
      moveFocus(surfaceId, event.shiftKey);
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
    } else if (row.field && !event.repeat) {
      beginText(surfaceId, row);
    } else if (row.choice && !event.repeat) {
      openMenu(surfaceId, row);
    } else if (!row.range && !row.choice && !row.field && !event.repeat) {
      activateButton(surfaceId, row);
    }
    return true;
  }

  function pick(ray, maxDistance) {
    if (!isVisible(group)) return;
    update();
    group.updateWorldMatrix(true, true);
    raycaster.ray.copy(ray);
    raycaster.far = maxDistance;
    const targets = [];
    for (const [surfaceId, surface] of surfaces) {
      if (!canInteract(surfaceId)) continue;
      if (surface.background) targets.push(surface.background);
      for (const {target} of surface.rows.values()) if (target) targets.push(target);
    }
    if (menu && canInteract(menu.surfaceId)) targets.push(...menu.cells.map(cell => cell.target));
    return raycaster.intersectObjects(targets, false)[0];
  }

  function rangeFraction(localX) {
    return (localX - rangeCenter) / rangeWidth + 0.5;
  }

  function rangeValue({min, max}, fraction) {
    return min + Math.max(0, Math.min(1, fraction)) * (max - min);
  }

  function cancelRangeDrag() {
    if (!rangeDrag) return false;
    rangeDrag.row.preview.visible = false;
    rangeDrag = undefined;
    return true;
  }

  function validateRangeDrag() {
    if (!rangeDrag) return false;
    const {row, start} = rangeDrag;
    if (!row.range || typeof row.action !== 'function' || !canInteract(rangeDrag.surfaceId)
        || row.range.current !== start.current || row.range.min !== start.min
        || row.range.max !== start.max || row.range.step !== start.step
        || row.range.draft.path !== start.draft.path) {
      cancelRangeDrag();
      return false;
    }
    return true;
  }

  function previewRange(fraction) {
    const {row} = rangeDrag;
    const {min, max} = row.range;
    const proposed = quantizeRange(row.range, rangeValue(row.range, fraction));
    rangeDrag.requested = proposed;
    const alongTrack = (proposed - min) / (max - min);
    row.preview.position.set(rangeCenter + (alongTrack - 0.5) * rangeWidth, 0, 0.049);
    row.preview.visible = true;
  }

  function beginRangeDrag(ray, {maxDistance = Infinity} = {}) {
    if (rangeDrag) return false;
    const hit = pick(ray, maxDistance);
    const target = hit && targetsByMesh.get(hit.object);
    if (!target?.row.range || typeof target.row.action !== 'function') return false;
    const fraction = rangeFraction(target.row.group.worldToLocal(hit.point).x);
    if (fraction < -0.04 || fraction > 1.04) return false;
    closeMenu();
    stopText();
    focus = {surfaceId: target.surfaceId, instanceId: target.row.instanceId};
    paintFocus();
    rangeDrag = {surfaceId: target.surfaceId, row: target.row, start: target.row.range};
    previewRange(fraction);
    return true;
  }

  function moveRangeDrag(ray) {
    if (!rangeDrag) return false;
    update();
    if (!rangeDrag) return false;
    const {row} = rangeDrag;
    row.group.updateWorldMatrix(true, false);
    inverse.copy(row.group.matrixWorld).invert();
    localRay.copy(ray).applyMatrix4(inverse);
    if (localRay.intersectPlane(rangePlane, localHit)) previewRange(rangeFraction(localHit.x));
    return true;
  }

  function endRangeDrag(ray) {
    if (ray) moveRangeDrag(ray);
    else update();
    if (!rangeDrag) return false;
    const {row, requested} = rangeDrag;
    cancelRangeDrag();
    commitRange(row, requested);
    return true;
  }

  function beginLocomotionPointer(ray, pointerId, {maxDistance = Infinity} = {}) {
    const hit = pick(ray, maxDistance);
    const target = hit && targetsByMesh.get(hit.object);
    return Boolean(target?.row.movement && locomotion.start(target.surfaceId, target.row, pointerId, ray));
  }

  function pointerTarget(ray, {maxDistance = Infinity} = {}) {
    const hit = pick(ray, maxDistance);
    if (!hit) return blockOutside ? modalBackground : undefined;
    const target = targetsByMesh.get(hit.object);
    return target && !target.entry && (target.row.disabled
      || (!target.row.movement && typeof target.row.action !== 'function'))
      ? hit.object.uuid + ':disabled' : hit.object.uuid;
  }

  function activateRay(ray, {maxDistance = Infinity} = {}) {
    if (rangeDrag) return true;
    const hit = pick(ray, maxDistance);
    if (!hit) {
      closeMenu();
      stopText();
      return blockOutside;
    }
    const target = targetsByMesh.get(hit.object);
    if (target?.entry) {
      if (target.entry.page) pageChoice(target.entry.page);
      else if (!target.entry.disabled) chooseOption(target.row, target.entry.optionId);
      return true;
    }
    if (menu?.row !== target?.row) closeMenu();
    if (editing?.row !== target?.row) stopText();
    if (typeof target?.row.action === 'function') {
      focus = {surfaceId: target.surfaceId, instanceId: target.row.instanceId};
      paintFocus();
      if (target.row.field) {
        beginText(target.surfaceId, target.row);
      } else if (target.row.choice) {
        openMenu(target.surfaceId, target.row);
      } else if (target.row.range) {
        const x = target.row.group.worldToLocal(hit.point).x;
        const fraction = rangeFraction(x);
        if (fraction >= -0.04 && fraction <= 1.04) {
          commitRange(target.row, rangeValue(target.row.range, fraction));
        }
      } else {
        activateButton(target.surfaceId, target.row);
      }
    }
    // The panel owns the hit even when its nearest control is disabled.
    return true;
  }

  return {
    ...protocol, group, update, pointerTarget, activateRay, handleKey, focusControl, clearFocus, setInteractionScope,
    beginRangeDrag, moveRangeDrag, endRangeDrag, cancelRangeDrag,
    beginLocomotionPointer,
    moveLocomotionPointer: locomotion.move,
    endLocomotionPointer: locomotion.end,
    locomotionInput: {getOutput: locomotion.getOutput},
    currentFocus() { update(); return focus && {...focus}; },
    ownsTextInput: textEditor.owns,
    ownsAccessibleInput(target) { return accessibility?.owns(target) ?? false; },
    focusAccessibleControl(surfaceId, instanceId) {
      update();
      return accessibility?.focus(surfaceId, instanceId) ?? false;
    },
    setPalette(colors) { palette = {...defaultPalette, ...colors}; },
    dispose() {
      blockOutside = false;
      accessibility?.dispose();
      cancelRangeDrag();
      stopText();
      for (const id of surfaces.keys()) removeSurface(id);
      protocol.dispose();
      group.removeFromParent();
    },
  };
}
