import {A2uiCatalogError, A2uiError, Catalog, isValidUax31Identifier} from '@a2ui/web_core';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

const catalogKeys = new Set(['$schema', '$id', 'protocolVersion', 'title',
  'description', 'catalogId', 'instructions', 'metadata', 'components', 'functions', '$defs']);
const checkable = 'common_types.json#/$defs/Checkable';

function assertComponentDefinition(name, definition) {
  if (name === 'Surface') {
    throw new A2uiCatalogError('Surface is reserved and cannot be declared by a catalog.');
  }
  if (definition === undefined) return;
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new A2uiCatalogError(`Invalid component definition '${name}'.`);
  }
  const {allOf} = definition;
  if ('oneOf' in definition || 'anyOf' in definition || (allOf !== undefined && !importsCheckable(allOf))) {
    throw new A2uiCatalogError(`Invalid component '${name}': only a Checkable trait import may compose the component root.`);
  }
}

function importsCheckable(members) {
  if (!Array.isArray(members)) return false;
  let traits = 0;
  let bodies = 0;
  for (const member of members) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) return false;
    if (member.$ref === checkable && Object.keys(member).length === 1) {
      traits++;
    } else if (member.type === 'object' && member.properties && !('$ref' in member) &&
        !('allOf' in member) && !('anyOf' in member) && !('oneOf' in member)) {
      bodies++;
    } else return false;
  }
  return traits === 1 && bodies <= 1;
}

export function assertRendererCatalog(catalog) {
  if (catalog.protocolVersion !== '1.0') {
    throw new A2uiCatalogError('Proyeccion accepts only A2UI 1.0 catalogs');
  }
  for (const [name, component] of catalog.components) {
    if (!isValidUax31Identifier(name)) {
      throw new A2uiCatalogError(`Component name '${name}' must be a UAX #31 identifier.`);
    }
    assertComponentDefinition(name, component.jsonSchema);
  }
  for (const [name, fn] of catalog.functions) {
    // The published Basic Catalog carries the SDK's system function even
    // though catalog documents cannot declare reserved function names.
    if (name === '@index' && fn === basicCatalog.functions.get('@index')) continue;
    if (!isValidUax31Identifier(name)) {
      throw new A2uiCatalogError(`Function name '${name}' must be a UAX #31 identifier.`);
    }
    if (fn.requiresUserActivation && (fn.allowedCallers ?? 'rendererOnly') !== 'rendererOnly') {
      throw new A2uiCatalogError(`Function '${name}' requires user activation and must be rendererOnly.`);
    }
  }
}

/** Load a locally supplied A2UI 1.0 catalog document. No schemas are fetched. */
export function loadCatalog(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new A2uiCatalogError('Expected an A2UI catalog document.');
  }
  for (const key of Object.keys(document)) {
    if (!catalogKeys.has(key)) throw new A2uiCatalogError(`Unknown catalog property '${key}'.`);
  }
  try {
    const catalog = Catalog.fromJson(document);
    assertRendererCatalog(catalog);
    // Validate every declaration, even when anyComponent hides some from use.
    for (const [name, definition] of Object.entries(document.components ?? {})) {
      assertComponentDefinition(name, definition);
    }
    return catalog;
  } catch (error) {
    if (error instanceof A2uiError) throw error;
    throw new A2uiCatalogError(error instanceof Error ? error.message : String(error));
  }
}
