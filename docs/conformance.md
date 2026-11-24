# A2UI 1.0 renderer conformance inventory

This inventory describes the requirements being tracked for the reference renderer. A conditional requirement applies whenever the selected profile accepts its triggering input. An upstream test passing in the upstream SDK does not qualify a Proyeccion package or a browser projection.

The source is [the protocol at a337e800ede809c3a8ebca604918149380c11ec6](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md), the [version manifest](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/versions.json), and the [schemas at that commit](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json). The canonical Basic Catalog ID is `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`. Its repository file is [catalogs/basic/v1/catalog.json](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/basic/v1/catalog.json).

The upstream [adapter blueprint](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/blueprints/modules/a2ui_framework_adapter.blueprint.md) gives the current preferred framework seam: SurfaceModel, NodeResolver, ComponentNode and node actions. Do not use the old versioned core module as the sole processor merely because a guide imports it. Inspect the published exports, use native input activation synchronously and qualify the exact package. The registry reports Web Core 0.16.1 at integrity `sha512-sdQ8q4RNAaKla18AAXIGdAvfbzpE8+qay2vXMSPmgnBVUMZmi7ZwguzVsoCeRQSzvyAgNMjde/CcclARv7SzQw==` with no gitHead. Package integrity and a source commit hash establish different facts.

## Coverage map

| ID | Acceptance requirement and actor | Exact source | Test evidence to gather |
| --- | --- | --- | --- |
| W01 | Transport passes reliably ordered, individually delimited ingress and metadata. Selected interactive binding returns outbound envelopes to the correct author. Renderer validates wire version and exactly one recognized message. | [Transport](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L81-L94), [ingress](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/agent_to_renderer.json), [egress](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_to_agent.json) | Split, multi-record and malformed fixture streams. Validate generated envelopes for all four egress variants. |
| W02 | Capabilities list the actual supported catalogs under 1.0. Capability scope follows the binding. Data model sync is full, current and owner-scoped per surface when enabled and sent alongside an outgoing message. Passive edits never send by themselves. | [sync](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1095-L1102), [metadata](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1612-L1645), [capabilities schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_capabilities.json), [sync schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_data_model.json) | Two transport recipients with visibly distinct data. Assert no cross-recipient snapshot, immutable send-time snapshot and no sync on passive edits. |
| W03 | Valid unknown extension keys are tolerated across applicable metadata scopes and ignored. Strict ordinary wire validation remains active. | [extensions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1647-L1669) | Accept unknown valid names inside allowed maps in wire and catalog fixtures. Compare behavior with the extension omitted. Reject extra ordinary fields where schema disallows them. |
| S01 | Surface lifecycle registers a unique existing surface until deletion. Initial data is applied before components. No update can target an absent surface. Only the fixed Surface-to-root edge renders the reachable tree. | [lifecycle](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L174-L299), [root buffering](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L779-L811) | Named cases in `message_processor_v1_0`, `validator_v1_0`, `node_resolution`. Observe initial bound output and disappear/recreate on actual mount. |
| S02 | Incremental ID map materializes valid edges as definitions arrive, with no visibility before root. An unknown child cannot prevent valid siblings from rendering. The reserved Surface is immutable. Catalog parent/child restrictions apply through every edge including root and templates. | [composition](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L779-L860) | `node_resolution`, `composition_constraints`, `adapter_conformance`. Include stream-time pending vs final integrity, bad edges, cycles, repeated references and cleanup. |
| C01 | Explicit component/function catalog takes precedence over surface default. Absence of both and unknown ID cause resolution failure. Catalog IDs do not fetch remote URLs. Mixed catalog entries remain isolated by catalog and share the same wire version. | [catalog resolution](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L511-L524), [catalog loading](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L535-L647) | `multi_catalog`, `catalog`, `validator_v1_0`. Same component name in two installed catalogs, missing/defaultless/explicit cases and no outbound network fetch. |
| C02 | Validate UAX #31 entity IDs, reserved names, allowed schema shapes/reference targets and applicable catalog typing. A foreign reference produces a catalog error without network access. | [catalog validation](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L157-L168), [entity and schema rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L548-L648) | `catalog`, `common_types`, pinned valid catalog plus negative catalog load cases. Verify the selected SDK catches constraints that are outside JSON Schema. |
| C03 | Resolve both static child lists and repeated template children. Nested relative paths and `@index` bind to the innermost matching collection context, with absolute paths rooted at the surface. | [common types](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L124-L134), [scopes](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L911-L977), [index](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1372-L1381) | `data_context`, `index_function`, `node_resolution`. Reorder, add and remove items and observe displayed row data and action contexts. |
| D01 | Upsert at valid JSON Pointers. Root replacement, explicit null removal, escaped keys and array behavior follow pinned cases. Resolved values update subscribed components. | [data](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1030-L1102), [schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/agent_to_renderer.json) | `data_model`, `data_deletion`, `data_model_pointers`. Cover arrays, null root treatment, invalid pointers and independent surfaces. |
| D02 | Dynamic types resolve literal/path/function where permitted. Reserved single-@ directives are rejected unless recognized and doubled prefixes unescape in dynamic objects. Inactive bindings cannot execute user-activated functions. | [dynamic types](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L124-L134), [directives](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1256-L1270), [activation](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L322-L329) | `reserved_keys`, `functions`, `common_types`. Compare literal path/call property names and special escaped keys. |
| D03 | Supported inputs read the data model and synchronously update the bound path on native interaction, creating missing containers when applicable. Matching visible bindings react immediately. | [read/write and sync](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L986-L1009) | Actual keyboard/pointer changes for all five input kinds. Assert readback, passive network silence and resolved action values. |
| F01 | Catalog functions resolve and validate parameters in their context, apply defaults where specified, enforce caller and activation, and evaluate system @ functions only locally. | [renderer RPC policy](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L314-L329), [call routing](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1474-L1495) | `functions`, `agent_function_routing`, `index_function`. Include catalog-qualified collisions, host keyboard and pointer activation, passive rejection and unregistered behavior. |
| F02 | Agent-to-renderer calls are dispatched after earlier synchronous mutations while later envelopes can proceed before asynchronous completion. Calls use selected root or isolated empty root. Accepted invocation returns exactly one valid result/error with original ID, including void. | [renderer RPC](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L300-L389), [response](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1516-L1555) | `rpc_functions`, `message_processor_v1_0`. Validate error and value shape, unknown surface, bad args, omitted catalog, blocked activations and out-of-order completions. |
| F03 | Remote routing correlates outcomes, validates received envelopes, sends effective catalog ID and resolved/defaulted args, and never deduplicates imperative calls. Pending and failure outcomes differ for binding, check and action. | [routing](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1474-L1515), [pending and recovery](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1580-L1608) | `agent_function_routing`, `error_responses`. Check malformed responses, errors/timeouts, stale values after surface deletion, pending indicators and action pipeline stop with already-applied effects preserved. |
| F04 | A genuine interaction activates a local function or produces an agent action with surface ID, source component ID, time, name, resolved context and optional resolved user message. Failed validation has the specified blocking behavior. | [action](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L862-L905), [egress](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1438-L1473), [checks](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1112-L1227) | `actions`, `validation_result`, `adapter_conformance`. Use real browser activation to verify identity, no duplicate event, no localized date splice and schema-valid outbound data. |
| F05 | DynamicBoolean and check coercions, fallback message and severity, and resolution failure follow the defined rules. | [coercion](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1118-L1153), [failure](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1602-L1608) | `validation_result`, `adapter_conformance`. Table of numeric, string, null, object, boolean, result and remote pending/error cases. |
| F06 | Render the complete advertised Basic Catalog, including standard formatting and validation functions. Support the published formatString literal/interpolation/nesting/conversion rules and Basic regex dialect/safety behavior. | [Basic Catalog](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/basic/v1/catalog.json), [formatString/regex/index](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1286-L1398) | `expressions`, `functions`, `adapter_conformance`, `conformance/adapter/markdown_subset.yaml`. Real media interaction and all 18 component and 14 catalog function entries plus the system index. |
| A01 | Map label, description, live and hidden to real accessibility APIs. Infer useful defaults from visible role/title and let explicit values override. | [accessibility](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L526-L533), [attributes schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/common_types.json) | `accessibility` and `adapter_conformance` plus Chromium accessibility tree from package example, testing static and changed bindings, keyboard focus, modal focus restoration and fallback error display. |
| E01 | Distinguish validation, integrity, expression, execution and invalid function failures. Egress errors use the right schema/discriminator and the applicable surface/call/path correlation. | [validation error](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1416-L1423), [general errors](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1556-L1565), [failure semantics](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1602-L1608), [egress schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_to_agent.json) | `error_responses`, `rpc_functions`, browser bad-message test. Only one protocol result, no cross-surface mutation, no double reply to invalid RPC. |

[Official core suites](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core) and [harness guide](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/conformance_harness_implementation_guide.md) describe fixtures used across SDKs. [React upstream examples](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6/typescript/renderers/react/a2ui_explorer) and the [TypeScript agent SDK](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6/typescript/agents/a2ui_agent) are candidate interoperability producers or visual behavior checks. Select actual cross-implementation evidence from pinned examples. Record suite case IDs after qualifying the dependency. Pure schema-generation, benchmark and legacy-protocol cases are applicability decisions, not substitutions for semantic acceptance.

## Profile choices and evidence boundaries

- Binding-specific A2A, MCP, AG-UI and network servers, agent-side inference encodings, extension-specific behavior and legacy protocol versions are outside this renderer profile. Unknown extension tolerance and runtime semantics of supported optional fields remain required.
- Inline catalog negotiation is conditional on selected transport capabilities. The minimum reference uses locally registered catalogs. Schema support for an inline catalog announcement does not justify resolving unknown executable components or authorizing the sender to register code.
- Reactive RPC request deduplication and caching are optional. An implementation may omit both. Every imperative invocation is fresh.
- A strict validation fixture and a live streaming fixture can exercise different modes. Classify cases explicitly and preserve pinned schema vs prose vs fixture discrepancies as decisions. Do not silently relax a mandatory field to reproduce a prose example.

## Verification in 0.1.0-alpha.0

The six automated checks exercise the following behavior through Proyeccion's entry points:

- Ordered JSON Lines and progressive creation and removal.
- Distinct correlated protocol errors for malformed calls and missing surfaces.
- Overlapping renderer function calls, send-time data snapshots and exact correlation.
- Owner-scoped outbound function-call data and suppression of replacement-surface data after deletion.
- A real Chromium scene with live Markdown and editing, pointer and keyboard input, a spatial ray, narrow viewport and owned-resource disposal.
- One shared application subject observed and modified through two attributed fixture ports. The app reports the result to the active projection. A stale direct management operation is rejected.
- One browser round trip with the published A2UI TypeScript Agent SDK. It negotiates capabilities, generates a second surface, consumes its A2UI action and sends a visible component update.

The six tests include several scenarios in a single Chromium test. They do not
cover every Basic Catalog component or replace the upstream corpus manifest.
The public milestone tracks the remaining catalog, metadata and accessibility
cases, schema-level wire checks and end-to-end adapter coverage. The
[accessor clause](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1671-L1682)
and [corpus manifest](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/manifest_corpora.json) are the references
for metadata behavior and case accounting. Production integration is
verified separately from this fixture.

## Mandatory coverage on main

The [mandatory renderer milestone](https://github.com/AlterMundi/proyeccion/milestone/1)
tracks the remainder of the normative inventory. Current work attaches
independent JSON Schema checks to actual emitted Actions, Error and
RendererFunctionResponse envelopes, 1.0 capabilities and applicable data
model snapshots. See [wire coverage](https://github.com/AlterMundi/proyeccion/issues/1).
The selected tests use verbatim schemas from the pinned protocol. They
exercise the Basic Catalog's wire shape, renderer responses and a declared
custom-catalog call with schema-checked arguments. Local
transport failures and domain authorization remain host responsibilities.

Optional feature qualification follows the mandatory milestone. Score each
optional feature by its normative source, applicability, use in spatial
projections and typed domain actions, and reproducible acceptance tests.
Track any unsupported feature with a concrete reason and observed evidence.

### Accessibility case evidence

All seven cases in the pinned
[accessibility suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/accessibility.yaml)
run through the mounted Three.js renderer in Chromium. The test checks the
rendered attributes, browser roles and names where specified, and the named
axe-core rules. It also tests the upstream legacy-field transition case.
This evidence covers the suite rather than all forms of assistive technology
or the remaining Basic Catalog scenarios.

Run `A2UI_CONFORMANCE_MANIFEST_DIR=./results node --test test/accessibility.test.js`
with a fresh results directory. The pinned upstream comparer verifies these
records with `--harness proyeccion --corpus adapter --only core/accessibility.yaml`.

### Spatial adapter case evidence

The browser adapter runs the unmodified
[pinned framework fixtures](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/adapter_conformance.yaml).
Twenty-one cases pass through Proyección's mounted views:

| Case | Observed behavior |
| --- | --- |
| `tree_hierarchy_declared_order` | Exact component order and nested layout. |
| `single_message_v10_surface_render` | Inline components and initial data mount in one envelope. |
| `progressive_arrival_placeholder_upgrade_in_place` | A pending child materializes without replacing its mounted sibling. |
| `dynamic_repeater_list_insert_delete_reorder_and_index` | Additions, removals and reordering reconcile existing rows and update their indices. |
| `two_way_binding_control_write_updates_dependents` | Browser text editing updates dependent components and reaches the bound model. |
| `teardown_unmount_releases_subscriptions` | Unmounting the view releases its subscriptions while the live model retains its own observers. |
| `delete_surface_unmounts_view` | A protocol deletion removes the CSS3D view and disposes its model. |
| `type_change_under_same_id_resets_view_state` | A component type change replaces its mounted view and releases the previous one. |
| `removed_components_release_subscriptions` | A detached component releases its view subscriptions. |
| `two_way_binding_inputs_checkbox_choice_slider_datetime` | Native checkbox, choice, slider and date/time input update their data bindings. |
| `action_execution_event_vs_local_function_call` | A real click dispatches resolved event context or performs the selected local update. |
| `user_activation_gated_function_gesture_vs_programmatic` | A trusted click opens the link. Direct and synthetic invocation produce a schema-valid expression error without opening it. |
| `multi_catalog_mixed_surface_rendering` | The Basic Catalog and a locally registered custom badge render in the same surface. |
| `validation_results_error_disables_warning_allows` | Error results mark an input invalid. Warnings and information are visible without marking it invalid. |
| `accessibility_attributes_and_implicit_label_override` | Explicit labels override child text. The browser exposes the named controls, descriptions, live region and hidden state. |
| `v10_theme_dropped_in_permissive_mode_renders_like_none` | Legacy theme input leaves the model and CSS unthemed. |
| `agent_function_action_failure_reports_expression_error` | A failed custom-catalog call stops later state changes, reports the correlated error and leaves the view mounted. |
| `media_components_bind_url_and_name` | Bound media sources update and the bundled stock icon uses a loaded ligature font. |
| `tabs_switch_content` | A real browser gesture swaps the mounted tab content. |
| `modal_open_shows_content` | The browser opens the modal and emits the specified action. |
| `divider_and_slider_datetime_render` | Correct divider orientation and bound native control values. |

The combined `fallback_states_unknown_type_and_cyclic_diagnostics` fixture
remains skipped. Web Core 0.16.1 rejects cycles atomically before resolution
with `RECURSION_LIMIT_EXCEEDED`. This differs from the fixture's
`CYCLIC_REFERENCE` placeholder. A separate browser test verifies that an
unknown component occupies no layout space, its valid sibling remains
visible, and the adapter sends the resolver's `UNKNOWN_COMPONENT_TYPE`.
The same test verifies that a rejected cyclic update leaves the previous
scene mounted.

Two additional browser tests verify native media controls, muted decoding
and playback with local synthetic WAV and WebM, and modal focus cycling,
Escape and return to the trigger.

### Data model case evidence

All fourteen cases in the pinned
[data deletion](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/data_deletion.yaml)
and [data pointer](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/data_model_pointers.yaml)
suites pass through the renderer's protocol entry point. The tests check null
deletion, root replacement, key and index paths, preservation of state on
rejected writes, and the emitted `DATA_ERROR` messages against the wire schema.
A separate metadata test verifies that deleting an array entry delivers a JSON
null at that index in the outgoing snapshot.

### Catalog selection and agent routing evidence

All eight cases in
[multi_catalog.yaml](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/multi_catalog.yaml)
pass through the renderer session. The tests observe exact advertised catalog
IDs, selection of the component and function implementation, rejection of an
unregistered catalog or a mixed protocol version, and resolved text within a
defaultless surface. The mixed-catalog Chromium case also checks that the
adapter issues no request to any registered catalog URL.

Thirty-nine cases in
[agent_function_routing.yaml](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/agent_function_routing.yaml)
pass through the renderer session. They cover live bindings, checks, actions and
events, ordered or concurrent argument evaluation, error propagation and
cancellation by surface deletion. The suite checks the resolved values and
actual transport messages, including exact response correlation and
schema-checked arguments for declared remote functions. Undeclared functions
use the protocol's fallback rule and the test verifies the call envelope
and resolved JSON arguments against the fixture.

Four routing cases are skipped. The configured role requires an outbound
transport and accepts only 1.0, so the missing-listener and v0.9 cases use a
different profile. Two retry-after-cancellation cases call a Web Core API to
cancel a live surface's calls without removing its surface. The protocol entry
point provides cancellation through surface deletion or session disposal.

### Surface lifecycle and message processing evidence

Sixty-four cases in the pinned
[message processor suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/message_processor_v1_0.yaml)
pass through the renderer entry point. The cases verify create/update/delete
ordering, buffering before root, the atomic rejection of cyclic component
batches, extension validation, catalog selection through component updates,
metadata replacement and removal, and a real emitted data snapshot for a
surface with no default catalog. Invalid framing reports one transport error
and leaves the session unchanged. Valid envelopes that fail processing return
schema-checked protocol errors.

Twenty cases are skipped, with a reason for each in the manifest. Most cover
the standalone SDK API, stricter validation profiles, legacy versions or
inline capability advertisement. A focused test verifies that an unsupported
reserved system function resolves to null and reports an expression error
without calling the agent. The strict upstream fixture expects rejection at
ingress. In the nested-combiner case, Web Core 0.16.1's `Catalog.fromJson`
produces a runtime component schema that contains only `text`. The
renderer consequently interprets the custom `catalogId` as a catalog route
and reports a not-found error. The focused test reproduces the wire result.
Ordinary inline custom properties and the canonical `@metadata` envelope pass
in adjacent cases.

### Reproduce the case accounting

Run `A2UI_CONFORMANCE_MANIFEST_DIR=./results npm test` with an empty results
directory. Run the pinned upstream comparer from its source checkout:

```sh
python3 conformance/scripts/check_executed_cases.py \
  --manifest-dir /path/to/results --harness proyeccion --corpus adapter --corpus core \
  --only core/accessibility.yaml --only core/adapter_conformance.yaml \
  --only core/data_deletion.yaml --only core/data_model_pointers.yaml \
  --only core/multi_catalog.yaml --only core/agent_function_routing.yaml \
  --only core/message_processor_v1_0.yaml
```

The selected suites account for 153 passed and 25 skipped cases.
