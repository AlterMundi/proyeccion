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
A `HudPanel` contains `HudRow`, `HudColumn`, `HudText`, `HudButton`,
`HudRange`, `HudChoice`, `HudTextInput`, `HudMap`, `HudBearing`, `HudStick`
and `HudJump`. Text, disabled state and pressed
state can resolve from the data model. Buttons dispatch the standard A2UI
`Action` defined by the host. A panel or column stacks its children. A row
allocates horizontal space across its children in the declared order. Any
direct row child can specify a positive `weight` (0.25–8, default 1).
Containers take an optional `gap` (0–0.3 local scene units); root panels also
take `width` (0.5–8, default 1.48). Bind `visible` to contextual availability
on any component or container. Hidden branches leave layout and focus order.
Mount independent surfaces around maps, instrument meshes or overlays using
the host placement callback.

Supply a Three.js parent, the owning document for font rasterization, a
`placeSurface(group, surfaceId)` callback and an outbound `send(envelope)`.
The host places the groups in its scene or camera rig, then calls `update()`
before rendering. Panels and button plates are WebGL meshes. Text is drawn on
transparent textures over the meshes. Supply the room's palette with
`setPalette({background, button, pressed, disabled, text, focus})` after the room
look is accepted. Placement, scale and movement are owned by the host.

The mesh palette preserves opacity in CSS four- and eight-digit hex
tokens. Holodeck can map its confirmed room look's `--panel`,
`--control-fill`, `--control-hover`, `--ink` and `--gold` to
`background`, `button`, `pressed`, `text` and `focus`.
Call `setPalette()` when leaving a styled room to restore the HUD defaults.
Palette changes keep the mounted controls and their local focus.

For a camera-relative HUD, the current entry point exports
`placeHudInViewport(group, camera, {width, height, x, y, pixelsPerUnit, depth})`.
Pass the canvas viewport in CSS pixels and the top-center position of the
panel from its top left. Update with the active camera and viewport before
rendering. The helper writes the group's local matrix and preserves pixel
scale through perspective and orthographic views, including a transformed
scene parent. The viewport adapter also works with an ordinary world
transform supplied through `placeSurface`. The host chooses which surfaces
are camera-relative and how they share depth and input with the world.

Send the normalized host ray to `activateRay(ray, {maxDistance})` on one
activation gesture. Set the optional distance limit from the nearer world
occluder when applicable.
A consumed ray belongs to the nearest HUD panel even if it falls on an
inactive control. Only deliver the gesture to the world when no HUD consumed
it and the host's input policy permits it. The host owns keyboard/touch
policy, focus restoration, world occlusion testing and locomotion. The
current renderer proves pointer activation and disabled hit ownership.

For a Pointer Events canvas, `bindSpatialHudPointer({element, hud,
rayForPointer})` provides an optional host adapter. Return a normalized
`{ray, maxDistance}` from `rayForPointer(event)`, or no ray when the game
owns that input. The adapter captures an owned press and consumes its
pointer and follow-up click, activates a tap only on its original target,
and routes range drags through the preview and commit methods. A missing
HUD hit falls through to the host. The host chooses the touch policy,
movement rules, time to bind and scope. Unbind before disposing or replacing
the HUD. Capture-phase listeners on a host ancestor should defer owned HUD
input; game code on the same canvas can consume the remaining events.

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
Use `setInteractionScope({surfaceIds, blockOutside})` when the
application opens an overlay. Pass the modal surface and whichever shared
controls should remain enabled. The renderer will still draw visible
underlying surfaces, but ignores their ray hits and keyboard targets.
Set `blockOutside: true` when a miss must stay in the HUD. Keep outer
world keyboard, movement and pointer ownership in the host policy. Close
the overlay and call `setInteractionScope()` to restore unrestricted HUD
interaction, then restore the saved focus. An open menu, editor or range
drag loses input when its surface leaves the current scope.

Pass `accessibilityRoot` from the same document to expose the native
accessibility tree for the current scene HUD. Use a human-readable
`HudPanel.label` for each group and an optional `HudMap.label` for the
host's text equivalent of the map and selected exit. The clipped controls
expose button, pressed, status, slider and choice semantics, plus the
native editor on text-field activation. They dispatch the same actions and
respect modal scope and confirmed values. Use `ownsAccessibleInput(target)`
to let native keyboard input reach those controls without turning it into
world movement. Restore semantic focus after closing a surface with
`focusAccessibleControl(surfaceId, instanceId)`. The scene meshes are the
visible presentation.

For a title, description or activity summary, `HudText` can reserve
`lines` (1–8) and select `style` as `title`, `body` or `status`. Text wraps
within the spatial layout and indicates overflow.

For a range such as the worktable section, `HudRange` takes finite numeric
`min`, `max` and positive `step` values. Bind `value` to the confirmed
application state and `draft` to a separate writable `@path` for the proposed
value. A click on the track, an arrow key or Home/End writes the proposal and
dispatches the supplied A2UI action once. Bind the action context to the
proposal and the host's current revision. The visible indicator and label
move when the host updates `value`.
For a drag, call `beginRangeDrag(ray, {maxDistance})` on pointer-down. If it
consumes the hit, keep ownership of that pointer until the gesture ends.
Route its movement to `moveRangeDrag(ray)`, then release through
`endRangeDrag(ray)` or cancel through `cancelRangeDrag()`. Keep these events
out of world interaction, including the release after a cancellation. The
renderer displays a separate local preview and emits one proposal on release.
The host should cancel on action-target or mode changes. An unavailable
range, changed confirmed value or changed bounds also cancels the proposal.

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

For a room map, send `HudMap.marks` as an array of up to 128 entries with a
stable string `id` and numeric room coordinates `x` and `z`. Ordinary doors,
stairs (`stair`), portals (`portal`) and exits (`outside`) have distinct
markers. A visitor-specific `selected` ID highlights one marker. Set
`viewer` to the visitor's own `{x, z, heading}` or null before a pose is
known. Heading is in radians clockwise from map north (negative Z). The
optional `bounds` is `{minX, maxX, minZ, maxZ}`, defaulting to a 12-unit
square centered on the room origin. The plot preserves scale between axes.
Use companion HUD controls for typed selection actions.

For a marked exit beyond the open map, `HudBearing` shows the host's
`label`, relative `heading` in radians clockwise from straight ahead,
and optional formatted `distance`. The host owns guidance calculations,
the currently visible door, and clearing or moving to its selected target.

For local touch movement, declare `HudStick` and `HudJump` with human-readable
`label` values and the host's availability through `visible` and `disabled`.
With `bindSpatialHudPointer`, movement and jump can own separate fingers.
Another finger can activate a shared HUD control while the stick is held.
Each contact remains owned by the target it pressed, so an owned HUD
contact does not fall through to world controls.
The meshes draw the current stick and hold state. The host may mount
`hud.locomotionInput` through MML's existing
`client.setAdditionalInputProvider(hud.locomotionInput)`. Its `getOutput()`
matches the native provider's `{direction, isSprinting, jump}` or null. Stick
axes and jump holds are sampled local input. Holodeck retains movement,
collision, permissions and networking, with no A2UI traffic for the raw axes.
The control loses input on pointer cancellation, mode exclusion, removal or
disposal. A keyboard or accessible activation of Jump queues one local jump.
Keep the host's normal keyboard, pointer and movement priority.

Route actions to the same application operations used by other authorized
clients. Validate the authenticated visitor and relevant room or worktable,
the action name and typed arguments, and the current application revision
for shared mutations. The host sends confirmed results through
`updateDataModel` and `updateComponents`. Draft input, hover, local selection
and camera state remain visitor-local. Give shared and per-visitor surfaces
stable IDs within the session and dispose them on scope exit.

## Holodeck HUD inventory

The inventory was reconciled against Holodeck source at
`cb3c5ddcaa9e3f4368aff182d0104493ad6242dd`, including the ring and the sole
Matter room of that territory. Legacy spaces retain their existing
availability. Any published viewer or embedded content keeps the
presentation explicitly selected for that resource.

| Surface | Controls and host operation |
| --- | --- |
| Entry, transitions and recovery | Keep readiness, retry, lightweight entry, passage progress and uncertain send recovery. The current client retains pending sends and the native readback path. |
| Persistent world HUD | Project the current room title, presence, sound, appearance and room look, video quality, fullscreen, input help and touch movement. Sound, video, keyboard shortcuts and the controller use the visitor's own browser and input state. |
| Travel and proximity | Expose current doors, exit map, bearing and distance, clear a marked exit, indicate, edit and visit. `space-travel.mjs` already uses the authorized `POST /api/space` and passage readback. Proximity offers an action and does not perform a passage. |
| Creation and play | Preserve connection, light preview / color / position, create/edit/cancel/undo, garden progress, templates, editing, confirmation and follow. The client owns previews and calls the existing world action or garden operation on commit. |
| Conversation and history | Preserve the active room/topic/reference, open/close, composing, feedback, pending sends, activity list/pages/details, point and discuss. The situated input and history keep their current application routes; a HUD click does not manufacture a native utterance. |
| Content and instruments | Preserve visit/park/close, return to motion, exhibition search, shelf/archive pagination and restore, bench/service status and instrument entry. Model access, launches and editions retain their current actor and resource checks. |
| Matter worktable | Use a world affordance to open the app HUD. Project project/edition, scene, part, section, turn, visibility, discuss, share/follow/clear and local/shared status. The rules below distinguish visitor inspection and shared state. |

### Matter controls and authority

The client already resolves the scope through `CollectionShelves` and
`CollectionWorktable`. The old worktable panel appears with proximity.
For app mode, use that proximity and current room to offer entry and
require a distinct activation. Keep the same position and renderer
through entry and exit. End temporary pointer and key ownership on exit
and restore the previous world control if it still exists.

| Worktable action | Existing behavior to preserve |
| --- | --- |
| Choose project/edition | `chooseLocal` selects an actor-visible edition and sets that visitor's override. A restored edition stays pinned to its exact version. |
| Choose scene, part, cut, turn or visibility | The visitor's loaded model and inspection state remain local. The current part selection also comes from the world ray hit and must be a currently visible part of the shown model. |
| Follow shared | Clear the visitor override and follow the current visible shared edition. A visitor inspecting a local override keeps it across another visitor's shared change. |
| Share or clear table | Use `POST /api/space/collection` with `{resource, revision}` (resource null clears) or `{resource, revision, version}` for a restored pin. The server checks current room, edit rights, source/edition access and the table revision. |
| Confirm or recover a share | A 204 is a receipt. Read `GET /api/space/collection` for the actor's confirmed `worktable`, including `revision` and `canShare`. The existing event stream is a refresh hint. A 409 or uncertain response requires fresh readback before another write. A different reader may see the same revision with the resource redacted. |
| Discuss the current model | Preserve the authorized resource, edition, scene, scene version and optional part when preparing the existing situated conversation context. Opening the composer leaves submission to its existing explicit action. |

Keep the native resource ID in action context without alteration. For an
A2UI component derived from a worktable resource, use an identifier such as
`model_<resource>` so numeric-leading resource IDs meet the A2UI identifier
rule.

Apply the HUD palette only when the existing room look has been applied.
The current looks are `orbital`, `orbital-layered` and `amber`. The
existing appearance controller sets the room look only after image and
material application succeed. Use the confirmed look's semantic colors
for the HUD; keep a visitor's selected graphics, sound and appearance
separate from the shared worktable.

Fullscreen is a browser-local typed action. Invoke the existing browser
operation on the genuine local input, before network or other work that
can lose transient activation. Use `fullscreenchange` or readback for
the resulting pressed state. Local keys, graphics and sound continue
to follow the device owner and application input policy.

## Packaging check against Holodeck's renderer

With both worktrees installed, run from Proyección:

```sh
npm run check:holodeck-hud -- /path/to/holodeck /path/to/proyeccion-0.1.0-alpha.12.tgz
```

The check installs the supplied Proyección archive in a disposable consumer.
Omit the archive to pack the current checkout. When Holodeck has pinned
Proyección in its lockfile, pass `--host-lock` in place of the archive path
to test that exact download after verifying the recorded SHA-512 integrity.
The result includes the locked source URL and the tested archive SHA-256.
The check uses
Holodeck's installed esbuild, MML renderer, camera and animation assets,
and the browser build's minified ES2022 settings. The two checkouts have
separate dependency trees, so the probe deliberately resolves bare
`three` imports to Holodeck's installed Three.js. In the receiving app,
install the renderer alongside the host's matching Three.js dependency.
Verify one Three.js module in the receiving browser bundle.

The probe compares baseline and combined JavaScript and Brotli sizes
(quality 6). Chromium checks actual HUD pixels on the MML renderer's
canvas, one pointer action carrying its revision without a world click,
and a confirmed update. Packages exporting `placeHudInViewport` also verify
a second rendered frame and action at the same screen location after camera motion.
The probe also runs Holodeck's native collection routes with isolated state
and fixture Home identities. Two browser contexts enter Matter with distinct
permissions. The editor's A2UI share action writes through the collection
route, and both viewers refresh through the native event stream. The probe
checks redaction, rejected writes from a read-only visitor and a stale
editor revision, and the separate local selection and focus in each client
after a direct application write. It runs on loopback and cleans up its temporary
package, state and browser. Use the receiving acceptance below to verify
the real territory, shared identity, world HUD, and entry and exit behavior.

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
