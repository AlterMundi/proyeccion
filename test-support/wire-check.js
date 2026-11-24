import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const schema = name => JSON.parse(readFileSync(new URL(
  '../test/fixtures/a2ui-v1/' + name + '.json', import.meta.url,
)));
const base = 'https://a2ui.org/specification/v1_0/';
const ajv = new Ajv2020({strict: false});
addFormats(ajv);
const common = schema('common_types');
ajv.addSchema(common);
ajv.addSchema({...common, $id: base + 'catalogs/basic/common_types.json'});
ajv.addSchema(schema('catalog'), base + 'catalog.json');
ajv.addSchema(schema('catalog_definition'));

const validateMessage = ajv.compile(schema('renderer_to_agent'));
const validateSnapshot = ajv.compile(schema('renderer_data_model'));
const validateCapabilities = ajv.compile(schema('renderer_capabilities'));

function assertValid(validate, payload) {
  assert.equal(validate(payload), true, ajv.errorsText(validate.errors));
}

export function assertWireMessage(message, metadata = {}) {
  assertValid(validateMessage, message);
  if (metadata.a2uiRendererDataModel !== undefined) {
    assertValid(validateSnapshot, metadata.a2uiRendererDataModel);
  }
}

export function assertWireCapabilities(capabilities) {
  assertValid(validateCapabilities, capabilities);
}
