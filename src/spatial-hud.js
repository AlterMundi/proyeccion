import {isWritable, NodeResolver, peekValue} from '@a2ui/web_core';
import {
  BoxGeometry, CanvasTexture, Color, Group, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, Plane, PlaneGeometry,
  Ray, Raycaster, RingGeometry, SRGBColorSpace, Vector2, Vector3,
} from 'three';
import {loadCatalog} from './catalog.js';
import {createProtocol} from './protocol.js';
import {createTextEditor} from './spatial-hud-text.js';
import {layoutHud, value} from './spatial-hud-layout.js';
import {createMap, createPointer, mapSize, posePointer, updateMap} from './spatial-hud-map.js';
import {createHudAccessibility} from './spatial-hud-accessibility.js';
import {createLocomotionControl, createLocomotionInput} from './spatial-hud-locomotion.js';
import {hudMeshMaterial, setHudMeshColor} from './spatial-hud-color.js';

export {bindSpatialHudPointer} from './spatial-hud-pointer.js';
export {placeHudInViewport} from './spatial-hud-placement.js';

const catalogId = 'https://altermundi.github.io/proyeccion/catalogs/spatial-hud/1.0';
const common = name => ({$ref: 'common_types.json#/$defs/' + name});
const definition = (name, properties, required) => ({
  type: 'object', properties: {component: {const: name}, visible: common('DynamicBoolean'),
    weight: {type: 'number', minimum: 0.25, maximum: 8}, ...properties},
  required: ['component', ...required],
});
const icon = {enum: ['minimize', 'resize', 'map', 'conversation', 'appearance', 'video', 'activity']};
const layout = {children: common('ChildList'), gap: {type: 'number', minimum: 0, maximum: 0.3}};
const components = {
  HudPanel: definition('HudPanel', {...layout, label: common('DynamicString'),
    width: {type: 'number', minimum: 0.5, maximum: 8}}, ['children']),
  HudRow: definition('HudRow', layout, ['children']),
  HudColumn: definition('HudColumn', layout, ['children']),
  HudText: definition('HudText', {
    label: common('DynamicString'), lines: {type: 'integer', minimum: 1, maximum: 8},
    style: {enum: ['title', 'body', 'status']}, icon,
  }, ['label']),
  HudStick: definition('HudStick', {label: common('DynamicString'), disabled: common('DynamicBoolean')}, ['label']),
  HudJump: definition('HudJump', {label: common('DynamicString'), disabled: common('DynamicBoolean'),
    vertical: {enum: [-1, 1]}}, ['label']),
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
    min: common('DynamicNumber'), max: common('DynamicNumber'),
    step: common('DynamicNumber'),
    gestureKey: common('DynamicString'), action: common('Action'),
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
    pressed: common('DynamicBoolean'), icon, quiet: {type: 'boolean'}, submitFor: {type: 'string'}, action: common('Action'),
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
  const {draft} = props;
  const min = value(props.min);
  const max = value(props.max);
  const step = value(props.step);
  const current = value(props.value);
  const gestureKey = value(props.gestureKey);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min
      || !Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(Math.ceil((max - min) / step))
      || !Number.isFinite(current) || !writableProposal(props.value, draft)) return;
  return {min, max, step, draft, gestureKey, current: Math.min(max, Math.max(min, current))};
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
  return new Mesh(new BoxGeometry(width, height, depth), hudMeshMaterial(color));
}

// Keep the box as the hit area. Its material defines the rounded optical
// surface, so touch, raycasts and accessible focus keep their authored bounds.
const opticalRoles = new Map([['primary', 1], ['navigation', 2], ['utility', 3]]);

function opticalPlate(width, height, depth, color, outline = false) {
  const mesh = plate(width, height, depth, color);
  const material = mesh.material;
  setHudMeshColor(material, color, 0.995);
  material.depthWrite = false;
  const halfSize = {value: new Vector2(width / 2, height / 2)};
  const quietRing = {value: 0};
  const role = {value: 0}, state = {value: 0}, accent = {value: new Color()};
  mesh.userData.optical = {quietRing, role, state, accent};
  material.onBeforeCompile = shader => {
    shader.uniforms.hudHalfSize = halfSize;
    shader.uniforms.hudQuietRing = quietRing;
    shader.uniforms.hudRole = role;
    shader.uniforms.hudState = state;
    shader.uniforms.hudAccent = accent;
    shader.vertexShader = `varying vec2 hudShape;
` + shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n hudShape = position.xy;');
    shader.fragmentShader = `varying vec2 hudShape;
uniform vec2 hudHalfSize;
uniform float hudQuietRing;
uniform float hudRole;
uniform float hudState;
uniform vec3 hudAccent;
` + shader.fragmentShader.replace('#include <opaque_fragment>', `
      vec2 halfSize = hudHalfSize;
      float radius = min(.065, halfSize.y * (hudRole == 2.0 ? .39 : .69));
      vec2 corner = abs(hudShape) - (halfSize - vec2(radius + .003));
      float edge = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - radius;
      float aa = max(.00025, fwidth(edge));
      float coverage = 1.0 - smoothstep(-aa, aa, edge);
      if (coverage < .01 && hudQuietRing < .5) discard;
      float sheen = smoothstep(-halfSize.y, halfSize.y, hudShape.y);
      float rim = 1.0 - smoothstep(aa*.44, aa*1.7, abs(edge+aa));
      ${outline ? `
        diffuseColor.a *= mix(coverage * rim, 1.0, hudQuietRing);
      ` : `
        vec2 uv = hudShape / (2.0 * halfSize) + .5;
        float bars = 0.0;
        if (hudRole == 1.0) {
          bars = step(.07, uv.y) * step(uv.y, .13) * step(uv.x, .36) * step(.06, uv.x);
        } else if (hudRole == 2.0) {
          bars = rim * step(.29, abs(uv.x - .5)) * step(.30, abs(uv.y - .5));
        } else if (hudRole == 3.0) {
          bars = rim * step(.91, uv.y) * step(abs(uv.x - .5), .34);
        }
        float stateWeight = hudState == 2.0 ? .23 : hudState == 1.0 ? 1.0 : .66;
        vec3 glass = outgoingLight * mix(.69, 1.18, sheen);
        outgoingLight = mix(glass, glass + vec3(.12,.14,.13), rim * .44 * stateWeight);
        outgoingLight = mix(outgoingLight, hudAccent, bars * .78 * stateWeight);
        diffuseColor.a *= coverage;
      `}
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => outline ? 'hud-optical-rim' : 'hud-optical-plate';
  return mesh;
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;

function labelGlyphs(label) {
  return graphemes ? Array.from(graphemes.segment(label), entry => entry.segment) : Array.from(label);
}

function fitLabel(context, label, width, preserveEnd, truncated = false) {
  if (!truncated && context.measureText(label).width <= width) return label;
  if (context.measureText('…').width > width) return '';
  const chars = labelGlyphs(label);
  const elide = count => {
    const tail = preserveEnd ? Math.floor(count / 2) : 0;
    return chars.slice(0, count - tail).join('') + '…' + (tail ? chars.slice(-tail).join('') : '');
  };
  let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(elide(middle)).width <= width) low = middle;
    else high = middle - 1;
  }
  return elide(low);
}

function paragraphRows(context, label, width, limit) {
  const rows = [];
  let line = '';
  const words = label.slice(0, 4000).trimEnd().match(/\r?\n|[^\s]+/gu) ?? [];
  for (const word of words) {
    if (rows.length >= limit) return {rows, truncated: true};
    if (word.endsWith('\n')) {
      rows.push(line);
      line = '';
    } else {
      const next = line ? line + ' ' + word : word;
      if (context.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line) rows.push(line);
      line = '';
      if (rows.length >= limit) return {rows, truncated: true};
      if (context.measureText(word).width <= width) line = word;
      else {
        for (const glyph of labelGlyphs(word)) {
          if (line && context.measureText(line + glyph).width > width) {
            rows.push(line);
            if (rows.length >= limit) return {rows, truncated: true};
            line = '';
          }
          line += glyph;
        }
      }
    }
  }
  if (rows.length < limit) rows.push(line);
  return {rows, truncated: label.length > 4000};
}

const maxRasterEdge = 2048;
const maxLabelPixels = 262144;
const maxParagraphPixels = 1048576;

function textRaster(document, width, scale, height, legacyHeight, density, maxPixels = maxLabelPixels) {
  const canvas = document.createElement('canvas');
  const desiredScale = density ? density.cssPixelsPerUnit * density.pixelRatio : 520;
  const rasterScale = density ? Math.min(desiredScale, maxRasterEdge / (width * scale),
    maxRasterEdge / height, Math.sqrt(maxPixels / (width * scale * height))) : desiredScale;
  canvas.width = density ? Math.max(1, Math.round(width * scale * rasterScale))
    : Math.min(maxRasterEdge, Math.max(96, Math.round(768 * width * scale / rowWidth)));
  canvas.height = density ? Math.min(Math.max(1, Math.round(height * rasterScale)),
    Math.floor(maxPixels / canvas.width)) : legacyHeight;
  const context = canvas.getContext('2d');
  const pixelScale = density ? rasterScale / density.cssPixelsPerUnit : 1;
  return {canvas, context, pixelScale, inset: density ? 6 * pixelScale : 24};
}

function textMesh(canvas, width, height, density) {
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  if (density) {
    map.generateMipmaps = false;
    map.minFilter = LinearFilter;
  }
  const mesh = new Mesh(new PlaneGeometry(width, height),
    new MeshBasicMaterial({map, transparent: true, depthWrite: false, toneMapped: false}));
  mesh.position.z = 0.035;
  return mesh;
}

const labeledGlyphs = {
  map(ctx) {
    ctx.moveTo(-1, -.7); ctx.lineTo(-.33, -1); ctx.lineTo(.33, -.7); ctx.lineTo(1, -1);
    ctx.lineTo(1, .7); ctx.lineTo(.33, 1); ctx.lineTo(-.33, .7); ctx.lineTo(-1, 1); ctx.closePath();
    ctx.moveTo(-.33, -1); ctx.lineTo(-.33, .7); ctx.moveTo(.33, -.7); ctx.lineTo(.33, 1);
  },
  conversation(ctx) {
    ctx.moveTo(-1, -.8); ctx.lineTo(1, -.8); ctx.lineTo(1, .57); ctx.lineTo(.08, .57);
    ctx.lineTo(-.6, 1); ctx.lineTo(-.51, .57); ctx.lineTo(-1, .57); ctx.closePath();
  },
  appearance(ctx) {
    for (const [x, y] of [[-.8, -.35], [0, .42], [.8, -.55]]) {
      ctx.moveTo(x, -1); ctx.lineTo(x, 1); ctx.moveTo(x - .24, y); ctx.lineTo(x + .24, y);
    }
  },
  video(ctx) {
    ctx.rect(-1, -.8, 2, 1.38);
    ctx.moveTo(-.55, 1); ctx.lineTo(.55, 1); ctx.moveTo(0, .58); ctx.lineTo(0, 1);
  },
  activity(ctx) {
    ctx.moveTo(-1, .15); ctx.lineTo(-.62, .15); ctx.lineTo(-.32, -.69); ctx.lineTo(.13, .78);
    ctx.lineTo(.48, -.2); ctx.lineTo(.67, .15); ctx.lineTo(1, .15);
  },
};

function lettering(document, label, color, width = rowWidth, scale = 1, density, preserveEnd = false, iconName) {
  const height = 0.154;
  const {canvas, context, pixelScale, inset} = textRaster(document, width, scale, height, 80, density);
  context.fillStyle = color;
  context.textBaseline = 'middle';
  const glyph = labeledGlyphs[iconName];
  const glyphOffset = glyph ? 18 * pixelScale : 0;
  if (iconName) {
    const edge = Math.min(Math.min(canvas.width, canvas.height) * 0.24, density ? 5.5 * pixelScale : 7);
    context.save();
    context.translate(glyph ? inset + edge : canvas.width / 2, canvas.height / 2);
    context.strokeStyle = color;
    context.lineWidth = edge / 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    if (glyph) {
      context.scale(edge, edge);
      context.lineWidth = 0.25;
      glyph(context);
    } else if (iconName === 'minimize') {
      context.moveTo(-edge, 0);
      context.lineTo(edge, 0);
    } else {
      context.moveTo(-edge, edge);
      context.lineTo(edge, -edge);
      context.moveTo(0, -edge);
      context.lineTo(edge, -edge);
      context.lineTo(edge, 0);
      context.moveTo(-edge, 0);
      context.lineTo(-edge, edge);
      context.lineTo(0, edge);
    }
    context.stroke();
    context.restore();
  }
  if ((!iconName || glyph) && density) {
    const fontSize = Math.min(canvas.height * 0.8, density.fontSize * pixelScale);
    const width = Math.max(0, canvas.width - 2 * inset - glyphOffset);
    context.font = `600 ${fontSize}px system-ui`;
    context.textAlign = 'center';
    context.fillText(fitLabel(context, label.length <= 256 ? label : label.slice(0, 128) + '…' + label.slice(-127), width, preserveEnd), (canvas.width + glyphOffset) / 2, canvas.height / 2);
  } else if (!iconName || glyph) {
    context.font = '600 42px system-ui';
    context.fillText(label.slice(0, 160), 24 + glyphOffset, 40, canvas.width - 48 - glyphOffset);
  }
  return textMesh(canvas, width, height, density);
}

function textHeight(lines) {
  return lines > 1 ? lines * 0.084 + 0.065 : rowHeight;
}

function paragraphLettering(document, label, color, lines, style, scale, density) {
  const height = textHeight(lines) - 0.026;
  const maxPixels = Math.min(maxParagraphPixels, maxLabelPixels * lines);
  const {canvas, context, pixelScale, inset} = textRaster(document, rowWidth, scale, height,
    Math.round(height * 520), density, maxPixels);
  context.fillStyle = color;
  const title = style === 'title';
  const fontSize = density ? Math.min(canvas.height * 0.8 / lines, density.fontSize * pixelScale * (title ? 1 : 0.9)) : title ? 42 : 34;
  context.font = `${title ? 700 : 400} ${fontSize}px system-ui`;
  context.textBaseline = 'middle';
  const width = canvas.width - 2 * inset;
  if (width <= 0) return textMesh(canvas, rowWidth, height, density);
  const {rows, truncated} = paragraphRows(context, label, width, lines);
  rows.forEach((text, index) => {
    const fit = fitLabel(context, text, width, false, truncated && index === rows.length - 1);
    context.fillText(fit, inset, (index + 0.5) * canvas.height / lines);
  });
  return textMesh(canvas, rowWidth, height, density);
}

function fieldLettering(document, {label, text, caret, color, focusColor, placeholder, scale, density}) {
  const height = textInputHeight - 0.026;
  const {canvas, context, pixelScale, inset} = textRaster(document, rowWidth, scale, height, 164, density);
  const fontSize = density ? Math.min(canvas.height * 0.23, density.fontSize * pixelScale) : 33;
  context.fillStyle = focusColor;
  context.font = `600 ${fontSize}px system-ui`;
  const lineWidth = canvas.width - 2 * inset;
  if (lineWidth <= 0) return textMesh(canvas, rowWidth, height, density);
  context.fillText(label.slice(0, 160), inset, canvas.height * 43 / 164, lineWidth);
  context.fillStyle = color;
  context.font = `400 ${density ? fontSize : 32}px system-ui`;
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
    context.fillText(part.replace(marker, '▏'), inset, canvas.height * (94 + index * 43) / 164, lineWidth);
  });
  return textMesh(canvas, rowWidth, height, density);
}

/** Mount a native Three.js catalog. The host owns the camera, frame loop and input policy. */
export function createSpatialHud({parent, document, accessibilityRoot, placeSurface = () => {},
  controlStyle, controlRole, ...transport}) {
  const optical = controlStyle === 'optical';
  const controlPlate = optical ? opticalPlate : plate;
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
    row.vertical = props.vertical === -1 || props.vertical === 1 ? props.vertical : 0;
    const size = row.radius * 2 + 0.04;
    const scale = Math.min(1, width / size);
    if (kind === 'jump') {
      row.action = row.disabled ? undefined : () => locomotion.pulse(surfaceId, row);
      if (!row.disabled) surface.controls.push(row);
      const density = surface.textDensity;
      const textScale = density ? scale : 1;
      if (row.label !== row.semanticLabel || row.text !== palette.text || row.textDensity !== density || row.textScale !== textScale) {
        if (row.lettering) release(row.lettering);
        // The jump disk scales on both axes. Rasterize in its actual screen units.
        const jumpDensity = density && {...density, cssPixelsPerUnit: density.cssPixelsPerUnit * scale};
        row.lettering = lettering(document, row.semanticLabel, palette.text, row.radius * 1.8, 1, jumpDensity);
        row.lettering.position.z = 0.04;
        row.group.add(row.lettering);
        row.label = row.semanticLabel;
        row.text = palette.text;
        row.textDensity = density;
        row.textScale = textScale;
      }
    }
    if (accessibility) surface.semanticRows.push(row);
    const fill = row.disabled ? palette.disabled : palette.button;
    if (row.fill !== fill) {
      setHudMeshColor(row.target.material, fill);
      row.fill = fill;
    }
    if (row.focusColor !== palette.focus) {
      setHudMeshColor(row.indicator.material, palette.focus);
      if (row.ring) setHudMeshColor(row.ring.material, palette.focus);
      row.focusColor = palette.focus;
    }
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
    const iconName = button || textLabel ? props.icon : undefined;
    const thickness = textControl ? textInputHeight : textHeight(lines);
    const pressed = value(props.pressed);
    const fill = disabled ? palette.disabled : pressed === true ? palette.pressed : palette.button;
    activeRows.add(node.id);
    if (!row) {
      const item = new Group();
      item.name = node.componentId;
      row = {group: item, instanceId: node.instanceId};
      if (button || rangeControl || choiceControl || textControl) {
        row.target = controlPlate(rowWidth, thickness - 0.026, 0.048, fill);
        row.ring = controlPlate(rowWidth + 0.02, thickness - 0.01, 0.011, palette.focus, true);
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
        setHudMeshColor(row.preview.material, palette.text, 0.65);
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
    if (textControl) paintField(row, title, scale, surface.textDensity);
    else if (row.label !== label || row.text !== textColor || row.scale !== scale
        || row.lines !== lines || row.style !== style || row.icon !== iconName || row.textDensity !== surface.textDensity) {
      if (row.lettering) release(row.lettering);
      const labelWidth = rangeControl ? 0.81 : bearing ? 1.29 : rowWidth;
      row.lettering = !iconName && textLabel && (lines > 1 || style)
        ? paragraphLettering(document, label, textColor, lines, style, scale, surface.textDensity)
        : lettering(document, label, textColor, labelWidth, scale, surface.textDensity, choiceControl, iconName);
      row.lettering.position.x = (labelWidth - rowWidth) / (bearing ? -2 : 2);
      row.group.add(row.lettering);
      row.label = label;
      row.text = textColor;
      row.scale = scale;
      row.textDensity = surface.textDensity;
      row.lines = lines;
      row.style = style;
      row.icon = iconName;
      if (row.rail) setHudMeshColor(row.rail.material, palette.text);
      if (row.preview) setHudMeshColor(row.preview.material, palette.text, 0.65);
    }
    if (bearing) {
      const heading = value(props.heading);
      row.pointer.visible = Number.isFinite(heading);
      if (row.pointer.visible) posePointer(row.pointer, heading);
      if (row.focusColor !== palette.focus) setHudMeshColor(row.pointer.material, palette.focus);
      row.focusColor = palette.focus;
    }
    row.group.position.set(x, top - thickness / 2, 0);
    let height = thickness;
    if (row.target) {
      const quiet = button && props.quiet === true && Boolean(iconName);
      if (row.fill !== fill || row.quiet !== quiet) {
        setHudMeshColor(row.target.material, fill, quiet ? 0.06 : optical ? 0.995 : 1);
        row.target.material.depthWrite = !quiet && !optical;
      }
      if (Boolean(row.quiet) !== quiet) {
        if (optical) row.ring.userData.optical.quietRing.value = quiet ? 1 : 0;
        row.ring.geometry.dispose();
        row.ring.geometry = quiet ? new RingGeometry(0.039, 0.046, 24)
          : new BoxGeometry(rowWidth + 0.02, thickness - 0.01, 0.011);
      }
      row.ring.scale.x = quiet ? 1 / scale : 1;
      row.fill = fill;
      row.quiet = quiet;
      row.action = disabled ? undefined : props.action;
      if (row.focusColor !== palette.focus) {
        setHudMeshColor(row.ring.material, palette.focus, optical ? 0.995 : 1);
        if (row.knob) setHudMeshColor(row.knob.material, palette.focus);
      }
      row.focusColor = palette.focus;
      if (optical) {
        const role = opticalRoles.get(controlRole?.(surfaceId, node.componentId, node.type)) ?? 0;
        row.target.userData.optical.role.value = role;
        row.ring.userData.optical.role.value = role;
        row.target.userData.optical.state.value = disabled ? 2 : pressed ? 1 : 0;
        row.target.userData.optical.accent.value.copy(row.ring.material.color);
      }
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

  function paintField(row, label, scale, density) {
    const active = editing?.row === row;
    const text = row.localText ?? row.field?.confirmed ?? '';
    const caret = active ? row.caret : undefined;
    const placeholder = row.field?.placeholder ?? '';
    const paint = {label, text, caret, placeholder, scale, density, color: palette.text, focusColor: palette.focus};
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
        && menu.scale === row.group.scale.x && menu.textDensity === row.textDensity) {
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
    menu.textDensity = row.textDensity;
    const scale = row.group.scale.x;
    const key = JSON.stringify([entries, palette.text, scale, row.textDensity]);
    if (menu.key === key) return entries.length;
    for (const cell of menu.cells) release(cell.group);
    menu.key = key;
    menu.cells = entries.map((entry, index) => {
      const item = new Group();
      item.position.y = -(index + 1) * rowHeight;
      item.name = entry.optionId === undefined ? 'hud-choice-page' : 'hud-choice-option';
      const target = plate(rowWidth, 0.154, 0.048, entry.fill);
      item.add(target, lettering(document, entry.label, palette.text, rowWidth, scale, row.textDensity, true));
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

  function moveFocus(surfaceIds, reverse) {
    const controls = [...new Set(surfaceIds)].flatMap(surfaceId =>
      controlsFor(surfaceId).map(({instanceId}) => ({surfaceId, instanceId})));
    if (!controls.length) return false;
    const index = controls.findIndex(control =>
      control.surfaceId === focus?.surfaceId && control.instanceId === focus.instanceId);
    const start = reverse ? controls.length : -1;
    const step = reverse ? -1 : 1;
    const next = (controls.length + (index === -1 ? start : index) + step) % controls.length;
    closeMenu();
    stopText();
    focus = controls[next];
    paintFocus();
    return true;
  }

  function handleKey(event, {surfaceId, surfaceIds = surfaceId === undefined ? [] : [surfaceId]} = {}) {
    if (textEditor.owns(event.target) || accessibility?.owns(event.target) || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (!surfaceIds.length || !activationKeys.has(event.key)) return false;
    update();
    if (rangeDrag && surfaceIds.includes(rangeDrag.surfaceId)) {
      if (event.key === 'Escape') return cancelRangeDrag();
      if (event.key !== 'Tab') return true;
      cancelRangeDrag();
    }
    if (event.key === 'Tab') return moveFocus(surfaceIds, event.shiftKey);
    const activeSurface = focus?.surfaceId;
    if (activeSurface === undefined || !surfaceIds.includes(activeSurface)) return false;
    if (menu?.surfaceId === activeSurface) {
      if (event.key === 'Escape') closeMenu();
      else if (rangeKeys.has(event.key)) moveChoice(event.key);
      else if (!event.repeat) chooseOption(menu.row, menu.highlight);
      return true;
    }
    const row = controlsFor(activeSurface).find(item => item.instanceId === focus.instanceId);
    if (!row) return false;
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
      beginText(activeSurface, row);
    } else if (row.choice && !event.repeat) {
      openMenu(activeSurface, row);
    } else if (!row.range && !row.choice && !row.field && !event.repeat) {
      activateButton(activeSurface, row);
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
    const {row, start, action} = rangeDrag;
    if (!row.range || typeof row.action !== 'function' || !canInteract(rangeDrag.surfaceId)
        || row.action !== action
        || row.range.current !== start.current || row.range.min !== start.min
        || row.range.max !== start.max || row.range.step !== start.step
        || row.range.gestureKey !== start.gestureKey || row.range.draft.path !== start.draft.path) {
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
    rangeDrag = {surfaceId: target.surfaceId, row: target.row, start: target.row.range, action: target.row.action};
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
    if (!target) return hit.object.uuid;
    const {row} = target;
    if (row.disabled || (!row.movement && typeof row.action !== 'function')) return hit.object.uuid + ':disabled';
    if (row.movement) return hit.object.uuid;
    if (target.press?.action !== row.action || target.press?.label !== row.label) {
      const version = (target.press?.version ?? 0) + 1;
      target.press = {action: row.action, label: row.label, version};
    }
    return hit.object.uuid + ':' + target.press.version;
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
    setTextDensity(surfaceId, density) {
      const surface = surfaces.get(surfaceId);
      if (!surface) return false;
      if (density === undefined) {
        surface.textDensity = undefined;
        return true;
      }
      const {cssPixelsPerUnit, pixelRatio = 1, fontSize = 14} = density;
      if (![cssPixelsPerUnit, pixelRatio, fontSize].every(n => Number.isFinite(n) && n > 0)
          || cssPixelsPerUnit > 1024 || pixelRatio > 4 || fontSize > 64) {
        throw new RangeError('Text density is outside the supported raster bounds');
      }
      const previous = surface.textDensity;
      if (previous?.cssPixelsPerUnit !== cssPixelsPerUnit || previous.pixelRatio !== pixelRatio
          || previous.fontSize !== fontSize) {
        surface.textDensity = {cssPixelsPerUnit, pixelRatio, fontSize};
      }
      return true;
    },
    getSurfaceBounds(surfaceId) {
      const background = surfaces.get(surfaceId)?.background;
      if (!background || !isVisible(background)) return undefined;
      const {width, height} = background.geometry.parameters;
      const {y} = background.position;
      return {left: -width / 2, right: width / 2, top: y + height / 2, bottom: y - height / 2};
    },
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
