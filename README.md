# Proyección

Proyección is an experimental A2UI 1.0 adapter for browser-based Three.js
scenes. It anchors accessible A2UI controls in world space with Three.js
CSS3DRenderer and uses the official A2UI Web Core, Basic Catalog and Lit
renderer for protocol processing and widgets.

The example shows how a UI action and a direct application action can operate
on the same subject, with separate actor attribution and shared domain
validation. Confirmed state flows back into the projection.

## Try the example

Use Node 20.19 or newer.

```sh
npm ci
npm run dev
```

Open the loopback URL printed by Vite. Change **View name**, select **Apply
name**, then use **Change viewpoint** to see the same panel from a different
camera position. The sample runs locally with synthetic data and needs no API
key.

### Open two live views

Run `npm run dev:shared` and open `/examples/shared.html` at the loopback
origin printed by Vite. Choose **Open another view**. Change the name in
one tab and choose **Apply name**. Both tabs should show the confirmed name.

The application exposes the same subject to a separate client. With the
default port, read the subject and then use its current revision in a direct
rename. Replace `1` below with the revision returned by the read.

```sh
curl -fsS http://127.0.0.1:5173/api/workbench/subject
curl -fsS http://127.0.0.1:5173/api/workbench/subject \
  -H 'Content-Type: application/json' \
  -d '{"subjectRef":"study:weaver","expectedRevision":1,"title":"Shared study"}'
```

Both tabs receive the confirmation over SSE. The HTTP read identifies the
fixture actor and revision. Restarting the local server resets the study.
[Shared-session test](docs/conformance.md#runnable-shared-session)

## Use the package

Download the package tarball and its SHA-256 file from the
[GitHub prerelease](https://github.com/AlterMundi/proyeccion/releases/tag/v0.1.0-alpha.2)
and install it in a browser project.

```sh
sha256sum -c SHA256SUMS
npm install ./proyeccion-0.1.0-alpha.2.tgz three@0.182.0
```

```js
import {basicCatalog, createProyeccion} from 'proyeccion';

const projection = createProyeccion({
  parent: scene,
  viewport: document.querySelector('#viewport'),
  send: (message, metadata) => agentTransport.send(message, metadata),
});

projection.receive({
  version: '1.0',
  createSurface: {
    surfaceId: 'welcome',
    catalogId: basicCatalog.id,
    components: [{id: 'root', component: 'Text', text: 'Hello from A2UI'}],
  },
});
projection.render(camera);
```

- The host provides a positioned viewport, scene and camera. Render again
  when the camera, viewport or scene changes. Use `group` for world
  transforms, `placeSurface` for panel placement and `.proyeccion-surface`
  for dimensions and visual styling.
- Native DOM events handle pointer, keyboard and touch input. A host can
  explicitly invoke `activateRay(ray, camera, inputEvent)` for mediated scene
  input and use the same control path. Pass the original event during its
  synchronous handler when the target requires user activation. Route each
  gesture once.
- Provide one renderer instance per trusted agent and ordered transport. Pass
  parsed envelopes to `receive`, or stream decoded JSON Lines through
  `receiveJsonl` and call `finishJsonl` at the end. Wire `send` and
  `onTransportError` to the host. Return a rejected promise or throw if
  outbound delivery fails. Agent function calls time out after 30 seconds
  by default. Set `agentFunctionTimeoutMs` to use a different deadline.
  Reactive reads can share pending calls and reuse up to 256 answers per
  surface. Set `maxAgentCallCacheEntries` to change that limit, or set it to
  `0` when each evaluation needs a fresh agent call. UI actions always
  make fresh calls.
  `capabilities()` reports configured catalog IDs. Additional catalogs must
  be trusted and registered locally. Use the exported `loadCatalog(document)`
  to load an A2UI 1.0 JSON definition. Loading supplies schemas. Custom
  widgets still need local browser implementations.
- The host can call `addCatalog(catalog)` to register a trusted local catalog
  while the projection is running. New surfaces can use that catalog.
  Existing surfaces retain their original catalog scope.
- To announce selected local schemas to an accepting agent, call
  `capabilities({agentCapabilities, inlineCatalogIds: [trustedCatalogId]})`.
  Use the capabilities of the current recipient. An announcement includes
  definitions only when that recipient's `1.0.acceptsInlineCatalogs` is `true`.
- Use `dispose()` when the session detaches. The host retains ownership of
  its camera, canvas and transport. The host also owns identity, action and
  media policy. UI envelopes carry no permission to change domain state.

## Bind to an A2A client

Use `createA2aBinding(projection, {agentCard})` with an existing host client.
Pass the agent's incoming Message or Artifact `parts` to `receiveParts(parts)`.
In the projection's `send(envelope, rendererMetadata)` callback, call
`encodeMessage(hostMessage, {envelope, rendererMetadata})` and send the
result with the host client. For a turn without A2UI, use `{offerA2ui: false}`.
The host supplies the message identity, context and network delivery.

The default wire mapping targets A2A 1.0. Select `a2aVersion: '0.3'` for the
legacy A2A part shape while keeping A2UI at 1.0. For HTTP or JSON-RPC, use
`headers()` or `headers({activate: true})` for explicit extension activation.
See [A2A binding evidence](docs/conformance.md#a2a-binding-evidence).

## Bind an AG-UI activity

Call `createAgUiActivityBinding({messageId, mount})` for an A2UI activity.
The host's `mount` callback creates a fresh projection at that activity's
scene placement. Feed its middleware snapshots to `receiveEvent(event)`
and call `dispose()` when the activity closes. To forward an emitted
Action, pass `withAgUiAction(runInput, envelope)` to the host's AG-UI
client. See [AG-UI binding evidence](docs/conformance.md#ag-ui-binding-evidence).

## Bind a live HTTP and WebSocket session

Use `createHttpLiveBinding` when your application streams A2UI 1.0
envelope arrays as WebSocket text frames and accepts UI actions over HTTP.

```js
const binding = createHttpLiveBinding({
  streamUrl,
  actionUrl,
  mount(send) {
    const view = createProyeccion({parent, viewport, send});
    view.render(camera);
    return view;
  },
  onActionReceipt({status}) {
    if (status === 409) showConflict();
  },
});
binding.connect();
```

Each connection starts with a `createSurface` snapshot. The WebSocket
supplies authoritative updates, including changes initiated elsewhere in
the application. HTTP responses acknowledge actions. The host can call
`connect()` again to mount a fresh snapshot without replaying actions, and
`dispose()` when the session ends. The application owns authentication,
validation and revision checks. [Binding evidence](docs/conformance.md#http-and-websocket-binding-evidence)

## Bind an HTTP request-response session

The package built from `main` provides `createHttpTurnBinding(view, {url})`
for servers that return A2UI
updates in the HTTP response. Forward the view's `send(envelope, metadata)`
callback to the binding. Call `poll()` to request initial or current
messages and `dispose()` when the host detaches. The binding posts
`{messages, metadata}` and reads the response's `messages` array. Capability
offers and originating-surface snapshots use the A2UI 1.0 metadata schemas.
[Endpoint contract and browser evidence](docs/conformance.md#http-request-response-evidence)

## Bind a bidirectional WebSocket

Use `createWebSocketBinding(view, {socket, inlineCatalogIds})` from the
package built from `main`. The host creates and authenticates the socket.
Forward the view's `send(envelope, metadata)` to the binding. It exchanges
`{messages, metadata}` text frames and advertises capabilities when the
socket opens. Call `dispose()` to close the binding and socket. A new socket
uses a new renderer session and a fresh server snapshot.
[Endpoint contract and browser evidence](docs/conformance.md#bidirectional-websocket-evidence)

## Bind Server-Sent Events and JSON-RPC

Use `createSseJsonRpcBinding(view, {streamUrl, rpcUrl})` with the matching
host endpoints. Forward the view's `send(envelope, metadata)` to the
binding's `send`. Call `advertise()` to offer the renderer's catalogs, and
`connect()` to read named `a2ui` events with one JSON envelope per event.
Call `dispose()` when detaching the session. The server owns the session,
revision checks and replay of missed events after `Last-Event-ID`.
[Endpoint contract and browser evidence](docs/conformance.md#sse-and-json-rpc-binding-evidence)

## Render an A2UI resource from an MCP server

Call `createMcpTransportBinding(view, {client, perCallCapabilities: true})`
with the application's connected MCP client. The host selects a layout URI
for `readLayout(uri)` and names any application tool passed to `callTool`.
Forward the view's `send(envelope, metadata)` to the binding's `send` to use
the server's `a2ui_action` and `a2ui_error` tools. A2UI resources in successful
tool results update the view. Plain text and structured domain results stay
available to the caller. The host owns authentication, tool selection and
the layout lifecycle. With per-call capabilities enabled, pass the current
receiving agent's `agentCapabilities` and the host's selected
`inlineCatalogIds` to offer definitions to an agent that accepts them.
[Transport evidence](docs/conformance.md#mcp-transport-evidence)

For a stateful MCP peer that retains custom initialization capabilities,
call `client.registerCapabilities({a2ui: {rendererCapabilities: view.capabilities()}})`
before connecting. Run the Python MCP and Chromium example
from this checkout after `npm ci` with
`uv run --no-project --no-cache --with mcp==1.27.1 npm run check:mcp-stateful`.
[Stateful example](docs/conformance.md#stateful-mcp-negotiation)

## Run an MCP tool from a surface action

Install `installMcpAppCatalog(view, {authorizeApp, resolveTool})` from
`proyeccion/mcp`. The host's `resolveTool({name, arguments, surfaceId})`
returns a connected client for an approved operation. A Button can invoke
the catalog's `callMcpTool` using an A2UI function action. Set
`targetDataPath` to bind the returned data and use embedded A2UI resources
for server-owned updates. Supply `authorizeResource({name, arguments,
surfaceId, uri})` to enable linked resources. Returning `true` lets the
catalog read that URI from the same MCP client. A linked HTML App can be
bound from the resulting `html` field and mounted under `authorizeApp`.
Hosts that route tools through the agent can
continue using `createMcpAppCatalog({authorizeApp})`.
[Direct tool evidence](docs/conformance.md#direct-mcp-tool-evidence)

## Render a Vega chart

Install the optional chart dependencies and register the catalog before
creating the surface.

```sh
npm install vega@6.4.0 vega-lite@6.4.1 vega-interpreter@2.3.2
```

```js
import {vegaChartCatalog} from 'proyeccion/vegachart';

projection.addCatalog(vegaChartCatalog);
projection.receive({version: '1.0', createSurface: {
  surfaceId: 'spectrum',
  catalogId: vegaChartCatalog.id,
  components: [{id: 'root', component: 'VegaChart', height: 180, spec: {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: {values: [{hz: 40.4, amplitude: 2}, {hz: 80.8, amplitude: 4}]},
    mark: 'line',
    encoding: {x: {field: 'hz', type: 'quantitative'}, y: {field: 'amplitude', type: 'quantitative'}},
  }}],
}});
```

The optional renderer accepts inline data. A host can update the spec or
bind it to a data model path. See [VegaChart evidence](docs/conformance.md#vegachart-catalog-evidence).

## Render an MCP App

Install the optional peer `@a2ui/catalog-mcp@0.1.1` and serve its `sandbox/`
assets under `/a2ui-sandbox/` or configure the proxy location with
`configureMcpSandbox({baseUrl})` from `proyeccion/mcp`.

Register `createMcpAppCatalog({authorizeApp})` using `projection.addCatalog`
before creating the surface. The host callback approves the resolved HTML,
its CSP and permissions, the surface and component IDs, and its requested
tool, function and data bindings. It must return `true` for the resource to
load. Approve only policies the host intends to grant for that resource.
Listed app tool requests arrive through the normal A2UI Action channel.
With `installMcpAppCatalog(view, {authorizeApp, resolveTool})`, a listed
request uses the host's connected MCP client and returns its result to the
app. For an app request, `resolveTool` also receives the originating
`componentId`. Closing the app cancels pending calls on that bridge.
Both catalog installers accept `messageActionName: 'ui/message'` for hosts
using the message action name in the pinned MCP component spec. The default
matches the published SDK, `a2ui.mcpAppMessage`. In pinned mode these two
names are reserved and cannot appear in the app's `allowedTools`.
See [MCP App evidence](docs/conformance.md#mcp-app-catalog-evidence).

### Render Proyección inside an MCP App

Bundle the renderer and the MCP Apps SDK into the app's self-contained
`ui://` HTML resource. Connect `App.ontoolresult` to
`binding.receiveToolResult` and pass a client with
`callTool: params => app.callServerTool(params)` to
`createMcpTransportBinding`. Approve the callback tool on the host.

When the outer host also uses Proyección, give
`installMcpAppCatalog` a `renderToolResultInHost({name, arguments, surfaceId})`
callback that returns `false` for the app's entry tool. Bind the outer
McpApp's `data.paths.toolResult` to the tool payload's `toolResult` so the
embedded A2UI result reaches the inner view. Other tools can keep the
default host rendering.
[Browser example](docs/conformance.md#a2ui-inside-an-mcp-app)

## Verify

With a system Chromium installed, run `npm test`. Alternatively, install
Playwright's Chromium with `npx playwright-core install chromium`.
Set `PROYECCION_CHROMIUM` to choose a specific executable.

```sh
npm test
npm run build
npm run check:package
```

The browser test covers an independent round trip with the published A2UI
TypeScript Agent SDK. See [conformance and remaining coverage](docs/conformance.md)
and the [pinned A2UI 1.0 specification](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md).

## Scope and related work

This is an alpha release for the browser viewport profile. Browser controls
retain DOM accessibility and follow the scene camera. The mandatory milestone
for this profile is closed. The conformance matrix records tested optional
profiles and their limits. WebGL depth occlusion and immersive XR are outside
the current viewport adapter. The shared workbench uses synthetic state.
Weaver in Holodeck on Legion has separate acceptance.

The A2UI community lists [an earlier Three.js/WebGL renderer](https://github.com/josh-english-2k18/a2ui-3d-renderer). Proyección uses the versioned 1.0 SDK and positions browser-native controls with CSS3D.

Released under the [MIT License](LICENSE). The bundled [Material Icons font](src/assets/material-icons/README.md) is distributed under its upstream Apache License.
