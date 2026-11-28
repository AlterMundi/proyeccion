# Portable spatial surfaces

A portable spatial surface is an A2UI surface that a person can carry as a
workstation. In Holodeck the HUD can host it wherever the person goes.
A room, a physical-looking table or a web view can host the same application
surface. The application can attach different semantic context and permissions
to each instance. Moving the presentation grants no capability.

## Contract

- **Application.** The owning application decides what can be seen or done,
  supplies the A2UI document and confirmed state, validates actions and emits
  updates. Filters, selected entities and drafts use application- or
  viewer-scoped state according to their meaning. Authorizing a movement or
  changing an equipment parameter always belongs to that application's owner.
- **Mount.** The host places the surface in camera space, on an object in the
  room or in a web view. It owns transforms, navigation, reach, input focus,
  viewport adaptation, and lifetime. A HUD mount follows its visitor. A room
  mount can be shared while focus, open menus and view state remain personal.
- **Widget pack.** The trusted host chooses a pack and finish by component and
  role. The pack owns models, materials, poses, contact points, hit regions,
  focus, animation and optional local feedback. Its assets can be authored in
  Blender, supplied as preloaded GLBs or generated from geometry.
  Binding to A2UI remains independent of visual design. A different look
  or a web renderer can operate the same action without importing the 3D art.
- **Inputs.** Pointer, touch, keyboard and assistive controls address the same
  control instance. A physical bridge will address a stable semantic control
  binding, with normalized values for continuous controls. Confirmed values
  flow back from the application. Acknowledgements and origin tracking keep
  a motorized fader or indicator from creating an echo loop.

For one person's two views of the same station, bind them to the same
application state when the host has authorized it. Each mount retains its own
pose, focus, temporary feedback and pending gesture. Two visitors do not gain
each other's view state or device access. For multiple views, use stable
application entity IDs and route each action through a current context.

## Implementation and next milestones

1. **Shipped in this source branch.** The spatial renderer accepts trusted
   Three.js button models and mesh hit regions via `createButtonModel`.
   Models preserve the button's A2UI action, current state, focus, modal
   bounds and accessibility. The existing placement API positions the surface
   in camera or scene space. Holodeck's teleport instrument uses this contract.
2. **Pack contract.** Define how hosts register versioned asset packs and
   validate required anchors. Add reusable button and switch assemblies,
   and specify fallbacks, resource limits, reduced motion, optional sound
   and dispose behavior. Qualify one pack both on a table and in a HUD.
3. **Continuous controls.** Add track and arc geometry to a model binding
   for `HudRange`. Preserve capture ownership, local preview, commit on release
   and cancellation on context change. Test the same parameter in a web
   control, a 3D knob and a 3D slider.
4. **Physical bridge.** Add a host-owned MIDI adapter with explicit device
   selection, control mapping, bounded event rate and loop suppression.
   Exercise a real device against one application with live web and Three.js
   projections. Device permission belongs to the visitor and host.
5. **Shared location views.** A teleport station and a map consume the same
   authorized destination IDs, model families and action. Both can update the
   current selection and request travel. Camera/framing stays per view and
   the Holodeck receiver checks permissions each time. The first teleport
   instrument is independent of the map.

See [the renderer hook](holodeck-hud.md#authored-threejs-button-models) and
[application projection and ownership](dual-projection-apps.md).
