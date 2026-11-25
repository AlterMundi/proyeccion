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
`Action` defined by the host. The optional `icon` on a button or static label
selects `minimize` or `resize` from the local icon catalog. Keep the full
accessible name in `label`. Screen-space icons have a compact glyph independent
of the action target. Set `quiet: true` on an icon button for quiet chrome with
the same hit area and focus affordance. A panel or column stacks its children. A row
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

The host can opt into `controlStyle: 'optical'` and provide
`controlRole(surfaceId, componentId, componentType)`. Use `primary`,
`navigation`, or `utility` for distinct plate silhouettes and accents.
The visitor palette supplies color, and the declared pressed and disabled
states select the visual treatment. The host role does not change the
catalog, action, label, hit area or accessibility focus. Map, conversation,
appearance, video and activity glyphs are drawn alongside their labels.
Animation controls can use `play`, `pause`, `previousFrame`, `nextFrame`,
`loop` and `compare`. Set `icon` as a name or a string binding. For playback,
bind both the icon and action label to the current host state. Use `pressed`
for toggles such as loop and comparison. Keep the component ID and action
stable when these bindings change so input ownership and focus follow the same
control. An unrecognized icon leaves the label visible.

For a compact dock, the host can pass `controlIconOnly(surfaceId, componentId)`
and return `true` for the buttons that should draw a centered glyph. The
callback is read during layout, so viewport changes only replace the visual
label. Keep a full localized `label` and mount the accessibility root. The
control identity, focus, hit area, action and status stay the same. An
unrecognized glyph keeps the label visible. Fit the host placement to the
viewport and safe area, and size the plate to at least 44 × 44 CSS pixels
for touch. Use the same buttons for the expanded and compact dock.

A host that hides text fields in responsive HUD sections can opt into
`retainTextDrafts: true`. An unpublished edit and its caret stay local to
the renderer when a field is hidden. The same text field restores the
edit when its draft path and confirmed value still match. The renderer
retains at most 32 hidden drafts per surface and clears them on deletion.
Re-key the field when its resource changes. Only the existing explicit
submission gesture sends data to the host.

For screen-space HUD text, set
`setTextDensity(surfaceId, {cssPixelsPerUnit, pixelRatio, fontSize})` after
creating the surface. Match the density to its placement and HUD framebuffer.
The default font size is 14 CSS px and fits the available row height.
Narrow labels use ellipsis. Choices retain their trailing value or option
suffix where space permits. Supply `accessibilityRoot` for the full name and
values. Update when placement scale or DPR changes, using stable or rounded
scale values for animated placement. Clearing the density restores the spatial
raster. The setting covers labels, choice menus, multiline status text, text
fields and the jump button.
The screen-space raster limit is 2,048 pixels per side. Multiline status text
gets a larger pixel budget as the line count grows, up to 1,048,576 pixels per
label, so long notices can match the display density.

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

After `hud.update()`, `hud.getSurfaceBounds(surfaceId)` returns the visible
panel's `{left, right, top, bottom}` in its local units, including background
padding. It returns `undefined` until a visible panel has been laid out.
Use `right - left` and `top - bottom` to fit the available CSS viewport
after reserving space for other controls. Refit when those bounds change, for
example when opening a project menu or adding worktable inspection controls.
For a top edge at `topInset`, pass `y: topInset + top * pixelsPerUnit` to
`placeHudInViewport`.

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

An owned tap is canceled if its visible label or action changes before
release. Use a resource-specific component ID or update the action
definition when a contextual control switches to another resource with the
same label. Confirmation revisions can keep using data model bindings.

Use `handleKey(event, {surfaceId})` only when the host routes keyboard input
to that HUD surface. Tab cycles enabled controls in display order, Shift+Tab
cycles backwards, Enter and Space activate, and Escape clears renderer focus.
Use `handleKey(event, {surfaceIds: [appSurface, sharedSurface]})` to tab across
multiple panels in a host-selected order. It skips disabled and out-of-scope
controls and only activates the panel that currently holds focus.
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
A labeled glyph such as `conversation` can lead a title or multiline
label. The glyph uses the focus accent. Wrapped lines share the text
inset, and the accessible label remains the human-readable text.

For a range such as the worktable section or a frame timeline, `HudRange`
takes finite numeric `min`, `max` and positive `step` values. Each accepts a
literal or an A2UI numeric binding. An integer timeline can bind `max` to the
last frame of the selected clip and use `step: 1`. Bind `value` to the confirmed
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
Bind the optional `gestureKey` to a stable host-defined string identifying
the target and mode. Changing it cancels a pending gesture, including when the
new target has identical bounds and confirmed value. An unavailable range,
changed confirmed value or changed bounds also cancels the proposal. Include
the resource identity and revision in the action for host-side validation.
For animation review, supply the selected rig, clip, animation revision and
frame bounds in one model update. Use their composite identity as
`gestureKey` and include the proposal, clip and expected revision in the
seek action. Disable or pause playback before interactive scrubbing if
incoming frame updates would otherwise supersede the local preview. Keep
the viewport pose local and publish the confirmed frame via the room
writer so both clients can observe the same pose revision.

For a selection such as project, scene or part, `HudChoice` binds `options`
to an ordered array of up to 1,024 items with unique string `id` and string
`label`. `disabled: true` makes an item unavailable. Bind `value` to the
confirmed ID and `draft` to its separate writable proposal path. The menu
places up to five options plus page controls in the scene, under the
selector. It accepts a ray pick, or Enter/Space to open, arrows and Home/End
to browse, Enter/Space to choose, and Escape to close. Menu page and
highlight stay local. A selection emits the supplied action with the
proposed ID. The confirmed label follows the host's data update.

For a short viewport, set `setChoicePageSize(surfaceId, size)`, where
`size` is one through five, before the next `update()`. Omit the size to
restore the default. Reserve space for up to two additional navigation
rows. Changing the size preserves the highlighted option and rebuilds only
the visible page. Page changes and viewport reflow do not submit a choice.

Use `setChoicePresentation(surfaceId, 'overlay')` with short HUDs that must
hold their placement while a choice is open. The menu covers part of its
surface and expands the bounds only if its page is taller than that surface.
Hosts that own Escape can call `dismissChoice(surfaceId)`. It returns true
if it closes that surface's menu, allowing the host to keep the panel open.
A pointer press on the rest of that panel dismisses the menu before it can
activate a different control. The native accessibility select and the
existing keyboard, action and revision rules still apply. Omit the
presentation to restore the inline layout.

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
For vertical movement, declare separate `HudJump` controls with
`vertical: 1` and `vertical: -1`. They return a local `vertical` sample
while held, independently of the stick. Opposing holds produce zero.
Omit `vertical` for an ordinary jump. Relabeling a released control does
not turn its previous hold into a jump.
Keep the host's normal keyboard, pointer and movement priority.
For screen-space Jump, the lettering raster follows the control's uniform
scale in both dimensions when a narrow row shrinks the button.

Set `iconOnly: true` on a `HudJump` to draw a centered glyph for its actual
motion: jump, ascend or descend. Keep the full localized `label` for the
native accessibility control. The glyph changes the presentation and
leaves the local hold, pointer target and keyboard activation intact.
Put an isolated touch control in a `HudPanel` with `chrome: 'none'` to keep
its layout bounds and accessible contents while removing the plate. The
empty area around the control lets world gestures pass through. The optical
control style draws a thin palette-colored rim.

Route actions to the same application operations used by other authorized
clients. Validate the authenticated visitor and relevant room or worktable,
the action name and typed arguments, and the current application revision
for shared mutations. The host sends confirmed results through
`updateDataModel` and `updateComponents`. Draft input, hover, local selection
and camera state remain visitor-local. Give shared and per-visitor surfaces
stable IDs within the session and dispose them on scope exit.

## Holodeck HUD inventory

The selected Holodeck release is `74f574592917` at source `98a2a61`, as
recorded by Holodeck in `docs/STATUS.md` at `16b5135`. The toroidal world
selects Matter as its single room. The table's spatial HUD is live. The
other rows describe the existing interface and authority to preserve in the
world HUD migration. Legacy spaces keep their existing availability, and a
published viewer or embedded resource keeps its explicitly selected presentation.

| Surface | Controls and host operation |
| --- | --- |
| Entry, transitions and recovery | `#world-entry` and `#room-passage` show readiness, lightweight entry, retry and passage progress. Keep admission, passage readback and uncertain-send recovery in the existing client flow. |
| Persistent world HUD | `#hud`, `#view-tools` and `#help` show the room, presence, sound, appearance, room look, graphics, fullscreen and input help. `world-audio.mjs`, `video-settings.mjs`, `room-looks.mjs` and `touchControls` in `client.mjs` own the visitor's browser state. Avatar appearance uses the actor-scoped `api/appearance` read and write. Display an applied room look only after the client confirms it. |
| Travel and proximity | `#house-door`, `#space-travel`, `#door-guidance` and `#pointing` expose the current doors, map, bearing, clear-mark, indicate, edit and visit controls. `space-travel.mjs` uses `POST /api/space` and `GET /api/space?live=1`; `world-indication.mjs` keeps the selected world target. Proximity offers explicit activation. |
| Creation and play | `#dock`, `#signal-editor` and `#play-near` cover connection, light preview / color / position, create/edit/cancel/undo, garden progress, templates, editing, confirmation and follow. `signal-garden-editor.mjs`, `playable-hud.mjs` and `indoor-garden-hud.mjs` supply state and actions. Previews stay local. Commits and recovery use the existing world action or scoped garden operation. |
| Conversation and history | `#conversation-panel`, `#activity-dialog` and `world-history.mjs` keep the active room/topic/reference, composing, feedback, pending sends, activity pages/details, point and discuss. Keep the situated application operation and explicit submission. |
| Content and instruments | `content-visitor.mjs`, `exhibition-index.mjs`, `collection-shelves.mjs` and `collection-archive.mjs` cover visit/park/close, return to motion, exhibition search, shelf/archive pagination and restore, bench/service status and instrument entry. The scoped `api/space/content-visits` and collection endpoints retain current actor, resource and edition checks. The surrounding HUD stays spatial when the selected resource itself opens as a webpage. |
| Matter worktable | `matter-worktable-hud.mjs` mounts Proyección for the explicit entry control, project/edition, scene, part, section, turn, visibility, discuss, share/follow/clear and local/shared status. The rules below preserve the split between local inspection and shared state. |

### Matter controls and authority

The client resolves the scope through `CollectionShelves` and
`CollectionWorktable`. The live build uses proximity and the current room to
offer the spatial entry control. Integrate world controls with the same
explicit app mode, position and renderer. End temporary pointer and key
ownership on exit and restore the previous world control if it still exists.

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
npm run check:holodeck-hud -- /path/to/holodeck /path/to/proyeccion-0.1.0-alpha.13.tgz
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
