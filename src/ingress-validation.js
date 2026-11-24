import {
  A2uiRecursionError, A2uiValidationError, MAX_FUNC_CALL_DEPTH, MAX_GLOBAL_DEPTH,
  MessageProcessor, RELAXED_PATH_PATTERN, extractEnvelopeErrorContext,
} from '@a2ui/web_core';

const segment = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
const bindingKeys = new Set(['@path']);
const callKeys = new Set(['@call', 'args', 'catalogId']);
const indexArguments = new Set(['offset']);

function invalidField(path, message) {
  throw new A2uiValidationError(message, undefined, undefined, {path});
}

function validateKeys(value, path, allowed) {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    invalidField(path + '/' + segment(key), `Unexpected field '${key}'`);
  }
}

function validatePath(value, path, absolute = false) {
  if (typeof value !== 'string' ||
      (RELAXED_PATH_PATTERN.test(value) && (!absolute || value === '' || value.startsWith('/')))) {
    return;
  }
  const requirement = absolute ? " (path must be a valid RFC 6901 JSON Pointer, empty or starting with '/')" : '';
  invalidField(path, `Invalid path syntax: '${value}'${requirement}`);
}

function validateValue(value, path, depth, functionDepth, opaque, literal) {
  if (depth > MAX_GLOBAL_DEPTH) {
    throw new A2uiRecursionError(`Global recursion limit exceeded: Depth > ${MAX_GLOBAL_DEPTH}`);
  }
  if (value === null || typeof value !== 'object') return;
  const array = Array.isArray(value);
  const functionWrapper = !literal && !array && Object.hasOwn(value, 'functionCall')
    && typeof value.functionCall?.['@call'] === 'string';
  const functionCall = !literal && !array && Object.hasOwn(value, '@call') && Object.hasOwn(value, 'args');
  const args = functionWrapper ? 'functionCall' : functionCall ? 'args' : undefined;
  if (args && functionDepth >= MAX_FUNC_CALL_DEPTH) {
    throw new A2uiRecursionError(`Recursion limit exceeded: functionCall depth > ${MAX_FUNC_CALL_DEPTH}`);
  }
  if (!literal && !array) {
    if (Object.hasOwn(value, '@path')) {
      validateKeys(value, path, bindingKeys);
      if (typeof value['@path'] !== 'string') invalidField(path + '/@path', 'A binding path must be a string.');
      validatePath(value['@path'], path + '/@path');
    }
    if (Object.hasOwn(value, '@call')) {
      validateKeys(value, path, callKeys);
      if (typeof value['@call'] !== 'string') invalidField(path + '/@call', 'A function name must be a string.');
      if (Object.hasOwn(value, 'catalogId') && typeof value.catalogId !== 'string') {
        invalidField(path + '/catalogId', 'A function catalog ID must be a string.');
      }
      if (Object.hasOwn(value, 'args')) {
        if (!value.args || typeof value.args !== 'object' || Array.isArray(value.args)) {
          invalidField(path + '/args', "Function 'args' must be an object.");
        }
        if (value['@call'] === '@index') validateKeys(value.args, path + '/args', indexArguments);
      }
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const pointer = path + '/' + segment(key);
    validateValue(child, pointer, depth + 1, key === args ? functionDepth + 1 : functionDepth, opaque,
      literal || opaque.has(pointer) || /^\/components\/\d+\/@?metadata$/.test(pointer));
  }
}

const opaqueFields = {
  createSurface: new Set(['/dataModel', '/metadata']),
  updateDataModel: new Set(['/value']),
  agentFunctionResponse: new Set(['/value', '/error']),
};
const noOpaqueFields = new Set();

function validateTemplatePaths(value, path, nested) {
  if (Array.isArray(value)) {
    if (nested) {
      for (const [index, item] of value.entries()) validateTemplatePaths(item, path + '/' + index, nested);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (typeof value.componentId === 'string' && Object.hasOwn(value, 'path')) {
    validatePath(value.path, path + '/path');
    return;
  }
  for (const key of nested ?? []) validateTemplatePaths(value[key], path + '/' + segment(key));
}

// Web Core 0.16.1 runs a context-free path scan before decoding envelopes.
// Keep its operation extraction, validation and dispatch. Replace the scan
// with a 1.0 guard that can distinguish dynamic syntax from literal JSON.
export class RendererMessageProcessor extends MessageProcessor {
  prepareSingleItem(item, onItemContext) {
    const context = extractEnvelopeErrorContext(item, this.defaultVersion);
    onItemContext?.(context);
    const {actionType} = context;
    const payload = item[actionType];
    if (actionType === 'updateDataModel') validatePath(payload?.path, '/path', true);
    validateValue(payload, '', 1, 0, opaqueFields[actionType] ?? noOpaqueFields, false);
    return this.extractSingleMessageOperations(item);
  }

  processCreateSurfaceOp(operation) {
    const {dataModel, components, surfaceId} = operation;
    if (dataModel === undefined) return super.processCreateSurfaceOp(operation);

    // The initial model is a JSON snapshot. Web Core applies it one key at a
    // time with update semantics, which removes top-level null values.
    super.processCreateSurfaceOp({...operation, dataModel: undefined, components: undefined});
    const surface = this.getSurface(surfaceId);
    try {
      surface.dataModel.set('/', dataModel);
      if (components?.length) this.processUpdateComponentsOp({type: 'updateComponents', surfaceId, components});
    } catch (error) {
      this.model.deleteSurface(surfaceId);
      throw error;
    }
  }

  validateComponentProperties(component, surface) {
    super.validateComponentProperties(component, surface);
    const catalog = this.resolveComponentCatalog(component, surface);
    // Bare metadata is a legacy envelope mixin unless the catalog declares
    // it as a component property. Check dynamic syntax in that property.
    if (Object.hasOwn(component, 'metadata') && this.componentLayout(component, surface, catalog).customKeys.has('metadata')) {
      validateValue(component.metadata, '/metadata', 4, 0, noOpaqueFields, false);
    }
    const type = component.component ?? surface.componentsModel.get(component.id)?.type;
    const fields = catalog.componentRefMap[type];
    if (!fields) return;
    for (const key of new Set([...fields.singleRefs, ...fields.listRefs])) {
      validateTemplatePaths(component[key], '/' + segment(key), fields.nestedRefs?.[key]);
    }
  }

  validateSurfaceComponentGraph(operation, surface) {
    const graph = super.validateSurfaceComponentGraph(operation, surface);
    // The slow path builds the bound after its traversal. Its exact height
    // also catches chains whose child IDs were visited before their parent.
    if (graph?.maxHeight > MAX_GLOBAL_DEPTH) {
      throw new A2uiRecursionError(`Global recursion limit exceeded: logical depth > ${MAX_GLOBAL_DEPTH}`,
        undefined, undefined, {surfaceId: surface.id});
    }
    return graph;
  }
}
