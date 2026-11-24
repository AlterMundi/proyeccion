export const mcpA2uiMimeType = 'application/a2ui+json';

export function visibleMcpContent(result) {
  return (result.content ?? []).filter(part => !part.annotations?.audience || part.annotations.audience.includes('user'));
}

function resourceUris(value) {
  const uris = Array.isArray(value) ? value : [value];
  return uris.filter(uri => typeof uri === 'string' && uri.length > 0);
}

async function toolResourceUris(client, name, signal) {
  if (typeof client.listTools !== 'function') return [];
  const cursors = new Set();
  let cursor;
  do {
    const page = await client.listTools(cursor === undefined ? {} : {cursor}, {signal});
    const tool = page.tools.find(tool => tool.name === name);
    if (tool) return resourceUris(tool._meta?.ui?.resourceUri);
    cursor = page.nextCursor;
    if (cursors.has(cursor)) throw new TypeError('The MCP tool catalog repeated its cursor');
    cursors.add(cursor);
  } while (cursor !== undefined);
  return [];
}

export async function readToolResources(client, result, request, authorizeResource, {signal, isCurrent}) {
  if (!authorizeResource || typeof client.readResource !== 'function') return [];
  const named = resourceUris(result._meta?.ui?.resourceUri);
  const declared = named.length ? named : await toolResourceUris(client, request.name, signal);
  const links = visibleMcpContent(result).filter(part => part.type === 'resource_link').map(part => part.uri);
  const resources = [];
  for (const uri of new Set([...declared, ...links])) {
    if (!isCurrent()) break;
    if (await authorizeResource({...request, uri}) !== true || !isCurrent()) continue;
    const reply = await client.readResource({uri}, {signal});
    for (const resource of reply.contents) {
      if (resource.uri === uri) resources.push({resource, ui: resource._meta?.ui ?? reply._meta?.ui});
    }
  }
  return resources;
}

export function mcpAppPayload({resource, ui}) {
  const [type, ...parameters] = resource.mimeType?.toLowerCase().split(';').map(part => part.trim()) ?? [];
  if (type === mcpA2uiMimeType || !(type === 'text/html' && parameters.includes('profile=mcp-app')
    || resource.uri.startsWith('ui://'))) return;
  let html = resource.text;
  if (html === undefined && typeof resource.blob === 'string') {
    html = new TextDecoder().decode(Uint8Array.from(atob(resource.blob), character => character.charCodeAt(0)));
  }
  if (typeof html === 'string') return {
    resourceUri: resource.uri, html,
    ...(ui?.csp === undefined ? {} : {csp: ui.csp}),
    ...(ui?.permissions === undefined ? {} : {permissions: ui.permissions}),
  };
}
