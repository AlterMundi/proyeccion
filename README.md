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

## Use the package

Download the package tarball and its SHA-256 file from the
[GitHub prerelease](https://github.com/AlterMundi/proyeccion/releases/tag/v0.1.0-alpha.1)
and install it in a browser project.

```sh
sha256sum -c SHA256SUMS
npm install ./proyeccion-0.1.0-alpha.1.tgz three@0.182.0
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
  `capabilities()` reports configured catalog IDs. Additional catalogs must
  be trusted and registered locally. Use the exported `loadCatalog(document)`
  to load an A2UI 1.0 JSON definition. Loading supplies schemas. Custom
  widgets still need local browser implementations.
- Use `dispose()` when the session detaches. The host retains ownership of
  its camera, canvas and transport. The host also owns identity, action and
  media policy. UI envelopes carry no permission to change domain state.

## Verify

With a system Chromium installed, run `npm test`. Alternatively, install
Playwright's Chromium with `npx playwright-core install chromium`.
Set `PROYECCION_CHROMIUM` to choose a specific executable.

```sh
npm test
npm run build
npm pack --dry-run
```

The browser test covers an independent round trip with the published A2UI
TypeScript Agent SDK. See [conformance and remaining coverage](docs/conformance.md)
and the [pinned A2UI 1.0 specification](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md).

## Scope and related work

This is an alpha release. Browser controls retain DOM accessibility and
follow the scene camera. WebGL depth occlusion, immersive XR and full A2UI
conformance are pending. The domain model example uses synthetic state.

The A2UI community lists [an earlier Three.js/WebGL renderer](https://github.com/josh-english-2k18/a2ui-3d-renderer). Proyección uses the versioned 1.0 SDK and positions browser-native controls with CSS3D.

Released under the [MIT License](LICENSE). The bundled [Material Icons font](src/assets/material-icons/README.md) is distributed under its upstream Apache License.
