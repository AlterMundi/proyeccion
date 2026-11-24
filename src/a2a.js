export const A2UI_A2A_EXTENSION = 'https://a2ui.org/a2a-extension/a2ui/v1.0';
const mimeType = 'application/a2ui+json';

function agentCapabilities(card) {
  const extensions = card?.capabilities?.extensions;
  const extension = Array.isArray(extensions) && extensions.find(entry => entry?.uri === A2UI_A2A_EXTENSION);
  return extension ? {'1.0': {acceptsInlineCatalogs: extension.params?.acceptsInlineCatalogs === true}} : undefined;
}

function hostMetadata(source) {
  const metadata = {...source};
  delete metadata.a2uiRendererCapabilities;
  delete metadata.a2uiRendererDataModel;
  return metadata;
}

/** Bind A2UI message parts to an A2A client owned by the host. */
export function createA2aBinding(renderer, {
  a2aVersion = '1.0', agentCard, inlineCatalogIds = [], onTransportError = () => {},
} = {}) {
  if (a2aVersion !== '1.0' && a2aVersion !== '0.3') throw new RangeError('Expected A2A 1.0 or 0.3');
  const legacy = a2aVersion === '0.3';
  const peer = agentCapabilities(agentCard);
  const selected = [...inlineCatalogIds];

  function receiveParts(parts) {
    for (const part of parts) {
      if (part?.metadata?.mimeType !== mimeType) continue;
      const data = part.content?.$case === 'data' ? part.content.value : part.data;
      if (!Array.isArray(data)) {
        onTransportError(new TypeError('An A2UI DataPart must contain an array of envelopes'));
        continue;
      }
      // Async renderer RPCs complete independently of later ingress.
      for (const envelope of data) renderer.receive(envelope);
    }
  }

  return {
    headers({activate = false} = {}) {
      const headers = {'A2A-Version': a2aVersion};
      if (activate) headers[legacy ? 'X-A2A-Extensions' : 'A2A-Extensions'] = A2UI_A2A_EXTENSION;
      return headers;
    },
    grpcRequestMetadata({activate = false} = {}) {
      return activate ? {'X-A2A-Extensions': A2UI_A2A_EXTENSION} : {};
    },
    encodeMessage(message, {offerA2ui = true, envelope, rendererMetadata = {}} = {}) {
      const {metadata: source = {}, parts = [], ...fields} = message;
      const metadata = hostMetadata(source);
      if (offerA2ui) {
        metadata.a2uiRendererCapabilities = renderer.capabilities({
          agentCapabilities: peer, inlineCatalogIds: selected,
        });
      }
      if (offerA2ui || envelope) {
        const model = rendererMetadata.a2uiRendererDataModel
          ?? (!envelope ? renderer.synchronizedDataModel?.() : undefined);
        if (model !== undefined) metadata.a2uiRendererDataModel = model;
      }
      const output = parts.filter(part => part.metadata?.mimeType !== mimeType)
        .map(part => part.metadata ? {...part, metadata: hostMetadata(part.metadata)} : part);
      if (envelope) output.push({
        ...(legacy ? {kind: 'data'} : {mediaType: mimeType}),
        data: [envelope],
        metadata: {mimeType},
      });
      return {...fields, parts: output, metadata};
    },
    receiveParts,
    receiveStreamResponse(event) {
      const payload = event?.payload;
      const response = payload ? {[payload.$case]: payload.value} : event;
      // A Task contains accumulated history and artifacts. Only dispatch the
      // parts of the newly delivered message, status message or artifact delta.
      const parts = response?.message?.parts ?? response?.statusUpdate?.status?.message?.parts
        ?? response?.artifactUpdate?.artifact?.parts;
      if (parts) receiveParts(parts);
    },
  };
}
