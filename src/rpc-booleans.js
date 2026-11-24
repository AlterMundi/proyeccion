import {DynamicBooleanSchema} from '@a2ui/web_core/v1_0';

const booleanRef = /^REF:[^|#]*#\/\$defs\/DynamicBoolean(?:\||$)/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isExpression = value => isObject(value) && (Object.hasOwn(value, '@path') || Object.hasOwn(value, '@call'));

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (isObject(value) && typeof value.valid === 'boolean') return value.valid;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return typeof value === 'number' && value !== 0 && !Number.isNaN(value);
}

function validateWrittenBoolean(value) {
  if (typeof value === 'boolean' || (isExpression(value) && DynamicBooleanSchema.safeParse(value).success)) return value;
  throw new TypeError('A DynamicBoolean argument must be written as a boolean, data binding or function call.');
}

function visitBooleanArguments(schema, value, visit, written = false) {
  if (!schema) return value;
  if (booleanRef.test(schema.description ?? '')) return visit(value);
  if (written && isExpression(value)) return value;
  const definition = schema._def;
  const inner = definition.innerType ?? definition.schema;
  if (inner) return visitBooleanArguments(inner, value, visit, written);
  if (definition.typeName === 'ZodArray' && Array.isArray(value)) {
    return value.map(item => visitBooleanArguments(definition.type, item, visit, written));
  }
  if (definition.typeName === 'ZodObject' && isObject(value)) {
    const shape = schema.shape;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      visitBooleanArguments(Object.hasOwn(shape, key) ? shape[key] : definition.catchall, item, visit, written),
    ]));
  }
  return value;
}

/** Fill the inbound RPC coercion gap in Web Core while retaining its schema checks. */
export function installRpcBooleanArguments(handler) {
  const handle = handler.handleCallRendererFunction;
  const checkPermission = handler.checkExecutionPermissions;
  const parse = handler.parseArguments;
  handler.parseArguments = function (catalog, fn, resolved, name) {
    return parse.call(this, catalog, fn, visitBooleanArguments(fn.schema, resolved, booleanValue), name);
  };
  handler.handleCallRendererFunction = (message, ...context) => {
    const written = message?.callRendererFunction?.callFunction?.args;
    // This Web Core hook runs after catalog selection and before evaluating arguments.
    const invocation = Object.create(handler, {
      checkExecutionPermissions: {value(fn, name, activated) {
        const denied = checkPermission.call(this, fn, name, activated);
        if (denied) return denied;
        try {
          visitBooleanArguments(fn.schema, written, validateWrittenBoolean, true);
          return null;
        } catch (error) {
          return `Invalid function arguments for '${name}': ${error.message}`;
        }
      }},
    });
    return handle.call(invocation, message, ...context);
  };
}
