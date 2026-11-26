# One application across web and a Three.js table

Start with the application's existing domain model. A piece, project or study
keeps its resource ID and committed revision across views. The app checks actor
permissions, validates typed commands and owns persistence. A home, room or
worktable identifies where someone is working. Each participant's camera,
keyboard focus and unsubmitted input belong to their view.

## Run the shared workbench

Use Node 20.19 or newer. The npm archive contains the renderers and this
guide. The runnable workbench lives in the matching source release. To open
the workbench for alpha.23:

```sh
git clone --branch v0.1.0-alpha.23 --depth 1 https://github.com/AlterMundi/proyeccion.git
cd proyeccion
npm ci
npm run dev:shared
```

1. Open `/examples/shared.html` at the loopback address printed by Vite. Open
   **Three.js controls** from that page.
2. Set a name and select **Apply name** in the browser view. The Three.js
   panel shows the confirmed name.
3. In the Three.js panel, select **View name**, type a different name and press
   Enter. The browser view shows that confirmation. Both use the same revision.
4. Read the current resource through `GET /api/workbench/subject`. Use that
   `subjectRef` and revision as `expectedRevision` in a direct `POST` with a
   different `title`. Both projections receive the new revision. Resending
   the old revision returns HTTP 409 and leaves the name as committed.

The sample is a loopback fixture with synthetic identities and in-memory
state. It displays the spatial controls used by a table profile. It does not
register an application in a running Holodeck. The example files show the
[shared state and two catalog surfaces](https://github.com/AlterMundi/proyeccion/blob/v0.1.0-alpha.23/examples/workbench-model.js),
[HTTP and SSE binding](https://github.com/AlterMundi/proyeccion/blob/v0.1.0-alpha.23/examples/shared-vite.js) and
[Three.js host](https://github.com/AlterMundi/proyeccion/blob/v0.1.0-alpha.23/examples/table-workbench.js).

## Design for situated daimon use

For new development and migrations, the Tribe defaults to A2UI for
application interfaces and to Holodeck as the primary surface for presenting
and interacting with deliverables. Build the in-world projection into the
delivery path. Use the web or another projection when it serves the same work.
Make an exception to these defaults only when a concrete reason is explicitly
agreed for that work.

The native application is the authority for humans and daimons. A daimon
working alongside a human must be able to discover, inspect and manipulate
the same resource at least as directly and fully as a human can through the
interface, within that daimon's permissions. Expose the complete set of
app-level operations available to the human through typed commands and useful
reads. Include app-native batch or precise operations when the domain supports
them. The daimon uses its own authenticated identity, with no UI or simulated
input required. A2UI renders human controls and delegates their actions to
those same domain operations.

- **Resolve what the human refers to at the application's own granularity.**
  When a participant points to or shares a selection, pass the active
  application's semantic target along with the stable resource ID and observed
  revision. Include the room, table or active view when relevant. A selection
  might be a mesh vertex, face, brush control, curve node or an active selector
  and its value. Preserve that detail across projections and expose it to
  direct reads. For a point on a mesh, resolve the hit to piece-local
  coordinates against that revision. Keep unshared camera, drafts, raw input
  and device state local. Ask for a more precise reference if the target is
  ambiguous, and re-read it if the accepted revision changed.
- **Operate on the resolved resource.** The app supplies structured resource
  reads, available commands and their arguments so a daimon can work without
  reading UI labels. Commands include the target and expected revision for an
  edit. The app verifies identity and permissions, checks the revision and
  applies the domain operation. A shared point or room reference carries
  context. Permissions come from the app's grants. For example, when the human
  selects a curve node and asks to make it Bézier, resolve that node in the
  current path and use the app's typed curve-edit command. The same node and
  its resulting handles remain inspectable at that level of detail.
- **Read back the real effect.** Return the resource, confirmed revision and
  app-level result, with a useful description of what changed or a typed
  reason why it did not apply. The daimon can read the resulting geometry or
  other domain state directly. Both projections render the same confirmed
  revision from the authoritative application, so the human can inspect the
  result in either view. Keep the visitor's local camera and focus independent.

## Adapt an existing application

1. **Keep the working application.** Define a read for the selected resource
   and current revision. Route each projection's actions through the same
   app command handler. Use the caller's authenticated identity and reject
   stale or forbidden writes in the app. Broadcast the confirmed result to
   both projections. Keep each view's pending text, pointer capture and
   camera separate.
2. **Describe the controls for each host.** Keep the existing web editor
   connected to the app's commands. For a web surface built with A2UI, use
   the Basic Catalog with `createProyeccion`. Use `spatialHudCatalog` with
   `createSpatialHud` for a native Three.js HUD. Match the catalog declared in
   each surface to its renderer. The workbench uses the same `applyTitle`
   action in both catalogs, including the revision in its action context.
   A native app client can call the same domain operation directly without
   emulating a click.
3. **Bind the table through Holodeck.** The host chooses a room and table
   placement, identifies the selected piece, and maps interaction with the
   scene to app actions. For clay modelling, keep the sculpting engine and
   mesh representation in the app. Put controls such as brush size in the
   A2UI surface. Translate a continuous stroke on the mesh into a typed
   operation using piece-local coordinates. The table or room does not get
   its own state writer. See the [spatial HUD host contract](holodeck-hud.md).
4. **Verify a human–daimon exchange.** Open a real piece on the web and at
   its associated table. With separate authenticated identities, have the
   human point to a spot or select a vertex or an app control. The daimon
   resolves that exact target and revision from the shared situation, then
   applies the corresponding typed edit. For a surface point, inspect the
   mesh and apply a brush stroke. Read back the resulting
   revision and geometry without a UI. The human should see that same result
   in the selected projection and be able to make the next edit there.
   Confirm that both projections and the direct read reach the same resource
   and revision, that moving one camera leaves the other view and focus
   alone, and that a stale revision or forbidden actor leaves the piece
   unchanged. The workbench demonstrates the shared-domain pattern. Qualify
   the app's own selection, geometry, tool actions and live room placement
   in Holodeck.

## Publish a workshop in a house

Use a stable application and an exact adapter release. A table in a house
binds that application to a selected workspace and supplies the room, table
and active selection as context. A different house can install the same
application and use its own workspace. To collaborate on one piece, point the
authorized tables and the web view to the same workspace and resource. An
installation never copies the app's writer or grants access to its workspaces.

Keep these permissions independent:

- The house author can publish the room, its passages, table placements and
  guest access through Holodeck's house authority.
- The application checks workspace membership and edit rights for every
  participant, including daimons behind the native API.
- Application maintainers can contribute and release the adapter and domain
  service through their owning repositories. They need separate permission to
  change a house placement or read and edit a workspace.

For the first clay workshop, use one reachable room, one real table and one
test piece. Have the intended house author publish the room and confirm the
same adapter can be selected by another admitted author for a separate
workspace. Then run the human–daimon exchange above on one shared workspace.
Confirm that the other installation stays independent. A deliberate reference
from that installation to the shared workspace should reveal the new revision
only to participants admitted by that workspace.

These are integration requirements. The published workbench is a demonstration
of the projection and command boundary. House authoring and the reusable native
app placement depend on the selected Holodeck receiver. Check the real route and
its writer with the house author and verify the same App admission and workspace
grants using a second identity. [Holodeck's native creator guide](https://github.com/AlterMundi/holodeck/blob/main/docs/native-creation-quickstart.md#draft-or-extend-an-owned-house)
describes the existing owner route.

The [published alpha package](https://github.com/AlterMundi/proyeccion/releases/tag/v0.1.0-alpha.23)
contains the browser and spatial renderers. If a Holodeck integration needs a
newer renderer feature, use the exact commit selected by its host. Verify
that dependency before delivery.
