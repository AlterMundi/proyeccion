const mimeType = 'application/a2ui+json';

/** Exchange A2UI layouts and events through a host-owned MCP client. */
export function createMcpTransportBinding(renderer, {
  client, perCallCapabilities = false, onTransportError = () => {},
} = {}) {
  function receiveResource(resource) {
    if (resource?.mimeType !== mimeType) return;
    let envelopes;
    try {
      if (typeof resource.text !== 'string') throw new TypeError('Expected a text A2UI resource');
      envelopes = JSON.parse(resource.text);
      if (!Array.isArray(envelopes)) throw new TypeError('An A2UI resource must contain an array of envelopes');
    } catch (error) {
      onTransportError(error);
      return;
    }
    for (const envelope of envelopes) renderer.receive(envelope);
  }

  function receiveToolResult(result) {
    if (result.isError) return;
    for (const part of result.content ?? []) {
      const audience = part.annotations?.audience;
      if (part.type === 'resource' && (!audience || audience.includes('user'))) {
        receiveResource(part.resource);
      }
    }
  }

  function capabilityMetadata() {
    return {rendererCapabilities: renderer.capabilities()};
  }

  async function callTool(name, args, rendererMetadata = {}) {
    const metadata = {};
    if (perCallCapabilities) metadata.a2ui = capabilityMetadata();
    if (rendererMetadata.a2uiRendererDataModel !== undefined) {
      metadata.a2uiRendererDataModel = rendererMetadata.a2uiRendererDataModel;
    }
    const result = await client.callTool({name, arguments: args, _meta: metadata});
    receiveToolResult(result);
    return result;
  }

  return {
    receiveToolResult,
    callTool,
    async readLayout(uri) {
      const result = await client.readResource({uri});
      for (const resource of result.contents) {
        if (resource.uri === uri) receiveResource(resource);
      }
      return result;
    },
    async send(envelope, rendererMetadata) {
      const route = envelope?.version === '1.0'
        && (envelope.action ? ['a2ui_action', envelope.action] : envelope.error ? ['a2ui_error', envelope.error] : null);
      if (!route) throw new TypeError('The MCP tool profile carries A2UI 1.0 Action and Error envelopes');
      const result = await callTool(...route, rendererMetadata);
      if (result.isError) throw new Error('The MCP server rejected ' + route[0]);
    },
  };
}
