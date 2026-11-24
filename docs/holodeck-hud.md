# Spatial game HUD host contract

Holodeck owns the A2UI producer, current territory and room, input policy,
application state, participant identity, permissions and deployment. Proyección
owns the Three.js catalog and rendering, protocol processing and interaction
events. The same A2UI 1.0 envelope rules apply in both directions. The host
chooses web presentation explicitly for surfaces that should look like a
web page, using the existing CSS3D renderer for that choice.

## Mount and route

Import `createSpatialHud` and `spatialHudCatalog` from `proyeccion/spatial-hud`.
Mount one renderer per visitor session and deliver ordered host messages to
`receive` or `receiveBatch`. Use `spatialHudCatalog.id` in its `createSurface`.
The ID identifies a locally registered catalog. No catalog fetch is required.
The current catalog renders a vertical `HudPanel` with `HudText` and
`HudButton` children. Text, disabled state and pressed state can resolve from
the data model. Buttons dispatch the standard A2UI `Action` defined by the host.

Supply a Three.js parent, the owning document for font rasterization, a
`placeSurface(group, surfaceId)` callback and an outbound `send(envelope)`.
The host places the groups in its scene or camera rig, then calls `update()`
before rendering. Panels and button plates are WebGL meshes. Text is drawn on
transparent textures over the meshes. Supply the room's palette with
`setPalette({background, button, pressed, disabled, text, focus})` after the room
look is accepted. Placement, scale and movement are owned by the host.

Send the normalized host ray to `activateRay(ray, {maxDistance})` on one
activation gesture. Set the optional distance limit from the nearer world
occluder when applicable.
A consumed ray belongs to the nearest HUD panel even if it falls on an
inactive control. Only deliver the gesture to the world when no HUD consumed
it and the host's input policy permits it. The host owns keyboard/touch
policy, focus restoration, world occlusion testing and locomotion. The
current renderer proves pointer activation and disabled hit ownership.

Use `handleKey(event, {surfaceId})` only when the host routes keyboard input
to that HUD surface. Tab cycles enabled controls in display order, Shift+Tab
cycles backwards, Enter and Space activate, and Escape clears renderer focus.
The function returns whether it consumed the key. Its caller owns the browser
default and movement fallback. Give a host-level app exit, active text editor
or device shortcut precedence according to the host policy. Save
`currentFocus()` on an app-mode transition and restore the still-available
control with `focusControl(surfaceId, instanceId)` on return. Calling
`focusControl(surfaceId)` focuses that surface's first enabled control.
The visible focus outline and focus ID belong to the visiting client.
Screen-reader semantics, editing, choices, range controls, navigation layouts
and transient overlays remain part of this HUD iteration.

Route actions to the same application operations used by other authorized
clients. Validate the authenticated visitor and relevant room or worktable,
the action name and typed arguments, and the current application revision
for shared mutations. The host sends confirmed results through
`updateDataModel` and `updateComponents`. Draft input, hover, local selection
and camera state remain visitor-local. Give shared and per-visitor surfaces
stable IDs within the session and dispose them on scope exit.

## Holodeck HUD inventory

This inventory comes from Holodeck source at
`484cbd7565881dd766963fc2aa88ebb5ef4004fa`, including its recently added video
controls. Confirm its categories against the receiving branch before migration.
All game controls remain in scope. Embedded content has its own presentation
decision, separate from the game's surrounding controls.

| Current surface | Functions to carry forward |
| --- | --- |
| Entry, transitions and recovery | Loading and readiness, retry, lightweight entry, passage progress and uncertain send recovery. Preserve useful status and return paths. |
| Persistent world HUD | Room title, visitor/presence status, sound, appearance and room style, video quality, fullscreen, input help and touch movement. Preserve shortcuts and local settings. |
| Travel and affordances | Doors, exit/discovery map, selected exit arrow and distance, clearing a mark, object selection, pointing, editing and visiting indicated content. |
| World creation and play | Connect islands where available, plant/create and edit lights, cancel and undo, public garden progress, templates, editing and confirmation, indoor garden design and follow controls. |
| Conversation and history | Active room/topic and worktable reference, conversation entry/exit and situated input/feedback, pending sends, activity list, pagination, detail and the point/discuss routes. Preserve available controls during app mode where the host permits. |
| Content and instruments | Enter/close/park content and return to movement, exhibition index and search, shelf/archive pagination and restore, bench/service status and instrument entry. Existing linked viewers and embedded applications keep their own presentation choices. |
| Matter worktable | Explicit open/close, project and edition, scene and part, horizontal section, part visibility and rotation, local inspection, share/follow/clear, selected-model conversation and shared/local status. |

## Receiving acceptance

1. In the new territory, inspect the Three.js world HUD and its active room
   look. Walk, use a relevant control and observe a confirmed host update.
2. Approach the Matter worktable and verify it enters app mode only after
   explicit activation. Exercise project/scene/part inspection and one
   authorized shared change. See the confirmed state in a second client
   and read it through the host's independent application route. Observe
   a direct application change in both projected views.
3. Give the second visitor a separate local selection. Verify it persists
   independently through the shared edit, including when the visitor does
   not follow the table. Exit app mode and verify appropriate focus, movement
   and view at the same place. Check keyboard and touch ownership.
4. Record the exact receiving source/package, entry link, application
   receipts and receiving browser evidence. Reconcile each inventory row
   against the selected release and include the permissions used.

## Later work

Wiggle and camera input follow the HUD milestone. The input integration point
is the host's existing input policy and session-scoped typed action route. The
host may choose to map enabled local sensor input to an explicit interaction
with the same application resource. Keep device acquisition, consent,
revocation and raw media within the application's device authority. Catalog
messages can carry projected control availability and status. Camera frames,
device grants and motion inference are outside the renderer contract.

The wider A2UI renderer roadmap and the physical Weaver/Harmonic Lab
acceptance on Legion retain their own verification steps.
