# One application across web and a Three.js table

Start with the application's existing domain model. A piece, project or study
keeps its resource ID and committed revision across views. The app checks actor
permissions, validates typed commands and owns persistence. A home, room or
worktable identifies where someone is working. Each participant's camera,
keyboard focus and unsubmitted input belong to their view.

## Run the shared workbench

Use Node 20.19 or newer. From the repository checkout:

```sh
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
[shared state and two catalog surfaces](../examples/workbench-model.js),
[HTTP and SSE binding](../examples/shared-vite.js) and
[Three.js host](../examples/table-workbench.js).

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
4. **Verify with two participants.** Open the same piece on the web and in
   the associated table as separate authenticated actors. Apply a stroke
   from each side and confirm the same resource, revision and resulting
   geometry in both views. Change one camera and confirm that the other
   camera and focus stay local. A forbidden actor or stale revision must
   leave the piece unchanged. The two catalog examples qualify the binding
   pattern. Live room placement and app-specific gestures require their own
   receiving test.

The [published alpha package](https://github.com/AlterMundi/proyeccion/releases/tag/v0.1.0-alpha.14)
contains the browser and spatial renderers. If a Holodeck integration needs a
newer renderer feature, use the exact commit selected by its host. Verify
that dependency before delivery.
