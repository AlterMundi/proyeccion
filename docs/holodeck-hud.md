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
The current catalog renders a vertical `HudPanel` with `HudText`,
`HudButton`, `HudRange`, `HudChoice` and `HudTextInput` children. Text,
disabled state and pressed state can resolve from the data model. Buttons
dispatch the standard A2UI `Action` defined by the host.

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
Screen-reader navigation, drag, navigation layouts and transient overlays
remain part of this HUD iteration.

For a range such as the worktable section, `HudRange` takes finite numeric
`min`, `max` and positive `step` values. Bind `value` to the confirmed
application state and `draft` to a separate writable `@path` for the proposed
value. A click on the track, an arrow key or Home/End writes the proposal and
dispatches the supplied A2UI action once. Bind the action context to the
proposal and the host's current revision. The visible indicator and label
move when the host updates `value`.

For a selection such as project, scene or part, `HudChoice` binds `options`
to an ordered array of up to 1,024 items with unique string `id` and string
`label`. `disabled: true` makes an item unavailable. Bind `value` to the
confirmed ID and `draft` to its separate writable proposal path. The menu
places up to five options plus page controls in the scene, under the
selector. It accepts a ray pick, or Enter/Space to open, arrows and Home/End
to browse, Enter/Space to choose, and Escape to close. Menu page and
highlight stay local. A selection emits the supplied action with the
proposed ID. The confirmed label follows the host's data update.

For a conversation or search field, `HudTextInput` takes a `label`,
confirmed `value` and separate writable `draft` path. It can specify
`placeholder`, `multiline`, `maxLength` (1–4,000, default 2,000) and
`disabled`. The visible input, text and caret are meshes. The renderer
opens a visually clipped native editor on explicit activation for operating
system text input, paste and IME. When `ownsTextInput(event.target)` is true,
let the editor receive its events and keep world movement out of that route.

Enter submits single-line fields. Ctrl+Enter or Cmd+Enter submits a multiline
field. A visible `HudButton` with `submitFor` set to the text input's instance
ID also submits, including with a pointer or touch. Give it the same action
and proposal binding. Escape drops the pending edit; Tab preserves the draft
and moves to the next control. Draft text stays out of the A2UI data model until
submission, and it's dropped when the host removes the surface. For sensitive
fields, leave `sendDataModel` off and bind the submitted value in the action
context alongside the applicable revision.

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
