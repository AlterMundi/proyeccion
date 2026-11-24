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
| W04 | Surface and component metadata have read-only snapshots, validated local mutation and change notifications. Equal values leave listeners quiet. Full component replacements clear omitted metadata. Resolved node metadata stays independent of component properties. Dispatch may attach action metadata. | [SDK accessor pattern](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1671-L1682) | Observe mutation, wire replacement, listener counts, stable view updates and delivered action metadata. |
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

- The core renderer uses a host transport. Optional A2A and AG-UI bindings map payloads issued by host-owned clients. MCP and network servers, agent-side inference encodings and legacy A2UI versions are outside the core renderer profile. Unknown extension tolerance and runtime semantics of supported optional fields remain required.
- Inline catalog negotiation is conditional on the current recipient's capabilities. The host selects which locally registered definitions to disclose.
- By default the pinned Web Core shares in-flight and settled reactive RPC results per surface. A host can set a different answer limit or disable reuse. Each imperative invocation is fresh.
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

The six tests were the initial browser and wire qualification. The coverage
sections below record the later catalog, metadata, accessibility and
end-to-end adapter results. The
[accessor clause](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1671-L1682)
and [corpus manifest](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/manifest_corpora.json) are the references
for metadata behavior and case accounting. Production integration is
verified separately from this fixture.

## Mandatory coverage on main

The [mandatory renderer milestone](https://github.com/AlterMundi/proyeccion/milestone/1)
is closed for the selected renderer profile. The test suite attaches
independent JSON Schema checks to actual emitted Actions, Error and
RendererFunctionResponse envelopes, 1.0 capabilities and applicable data
model snapshots. See [wire coverage](https://github.com/AlterMundi/proyeccion/issues/1).
The selected tests use verbatim schemas from the pinned protocol. They
exercise the Basic Catalog's wire shape, renderer responses and a declared
custom-catalog call with schema-checked arguments. Local
transport failures and domain authorization remain host responsibilities.

## Optional renderer features

These are implementation choices under the pinned 1.0 specification. Fields
that may be omitted from an envelope, including `@accessibility`, `@checks`,
`@catalogId`, `userMessage`, initial surface content and `sendDataModel`, have
defined semantics when present. Those semantics are tracked in the main
coverage map.

| Feature | Use in the reference renderer | Status and acceptance |
| --- | --- | --- |
| [Inline catalog negotiation](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1616-L1636) | Share a chosen Holodeck or Harmonic Lab catalog with an accepting agent for the current capability exchange. Native widget implementations and action permissions stay local. | Verified. A separate Agent SDK starts with only the Basic Catalog, reads the selected inline definition and sends a surface using it. Chromium mounts its custom component. Missing consent or selection omits the definitions. |
| [In-flight sharing and settled reactive RPC results](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1480-L1486) | Limit repeated reads and checks. The host can disable reuse when each evaluation needs a new read of live domain state. | Verified. The [reactive RPC tests](#reactive-rpc-evidence) cover identical calls, surface isolation, retry after failure, bounded eviction and the host's opt-out. The mounted action test sends separate calls for identical imperative actions. |
| [Locally selected custom catalogs](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L140-L155) | Map Three.js and Harmonic Lab presentation vocabularies to their own registered components. A host can install a catalog when an application becomes available. | Verified. The [runtime registration cases](#declarative-catalog-loading-evidence) show duplicate rejection, earlier surfaces retaining their catalog scope, and a new surface gaining the local catalog. |
| [Interpreting recognized extensions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1647-L1682) | Hosts may select specific meanings, such as an attribution understood by both endpoints. Shared typed actions use the native application's authority. | Metadata storage, tolerance and explicit action metadata are verified. No extension-specific semantics are advertised. A first named extension needs an owning contract and a test that observes its effect and preserves the behavior of unknown keys. |
| [Optional return channel and transport choices](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L81-L118) | Interactive projections use the host's bidirectional callback. Receive-only projections omit it. | [Receive-only mode](#receive-only-projections) and callback/JSONL behavior are verified. Optional A2A, AG-UI, [HTTP/WebSocket](#http-and-websocket-binding-evidence), [bidirectional WebSocket](#bidirectional-websocket-evidence), [HTTP request-response](#http-request-response-evidence), [SSE/JSON-RPC](#sse-and-json-rpc-binding-evidence) and [MCP tool/resource](#mcp-transport-evidence) profiles have browser evidence. Alternate endpoint conventions require host mappings. |
| [AG-UI middleware activities](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L96-L102) | Render a middleware activity in a host-chosen scene location and return its UI action to an AG-UI run. | Verified with the [published middleware and Chromium](#ag-ui-binding-evidence). The mapping covers full activity snapshots, JSON Patch deltas and actions. The host owns the run, event stream and other envelope channels. |
| [A2A extension activation and capability scoping](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md#L49-L146) | Lets a host that selects A2A carry renderer messages, catalogs and scoped state. | Verified with the [official A2A JSON-RPC client and server](#a2a-binding-evidence) and an independent A2UI Agent SDK round trip. The host owns task routing and credentials. |

VegaChart and MCP are optional catalogs. They have browser evidence for
[inline plots](#vegachart-catalog-evidence) and [host-approved resources](#mcp-app-catalog-evidence).
The host selects the catalog and supplies the application policy. [MCP catalog](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/v1/catalog.json) · [VegaChart catalog](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/vegachart/v1/catalog.json)

### MCP App catalog evidence

`proyeccion/mcp` uses the published A2UI MCP catalog and sandbox proxy.
The host approves the resolved resource and its requested bindings. Chromium
shows that unapproved HTML stays out, the inner frame has an opaque origin,
and the initialized app receives both an initial bound value and a later
update. A listed tool request emits an A2UI Action from the correct surface
and component. An unlisted request is rejected, and changing the requested
tool beyond the host approval removes the app. This test runs in the source
and installed-package workflows. [Pinned MCP catalog](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/README.md) · [Browser tests](../test/mcp-app-conformance.test.js) · [MCP Apps host model](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html)

The direct profile checks both the component's live `allowedTools` and the
host's tool route for the originating surface and component. The browser
observes structured tool data in the sandbox, with assistant-only content
excluded. It observes an error for an unlisted name and a tool error for a
listed name that the host denies. A local MCP SDK server observes cancellation
when the app's surface is deleted during a call. Direct calls return through
the app bridge. The fallback profile continues to forward a listed call as
an A2UI Action. [Catalog tool bridge](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/v1/mcp_app_specification.md#L151-L173) · [A2UI app guide](https://a2ui.org/guides/mcp-apps-in-a2ui/#synchronizing-state-and-tool-calls)

Chromium verifies a widget subpath write, preserved sibling values, host
updates and echo suppression. Changing `data.paths` replaces the bridge's
subscriptions even when the app HTML stays the same. The browser then
observes an app write only at the newly bound path. An allowlisted local
function returns its result and invalid arguments produce a bridge error.
The app can also set bound `modelContext`. A later `ui/message` request
emits a schema-valid action with the component identity and the scoped
surface snapshot. [State and local function clauses](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/v1/mcp_app_specification.md#L174-L241)

The pinned component document names the resulting action `ui/message`.
The published bridge and current A2UI guide use `a2ui.mcpAppMessage`.
Both MCP catalog installers accept `messageActionName: 'ui/message'`.
Browser tests verify both names, the same payload and surface snapshot,
and an ordinary component action whose name matches the SDK alias.
Pinned mode reserves the two names from the app tool list because the
SDK routes fallback tools and messages over the same action channel.
[Pinned message clause](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/v1/mcp_app_specification.md#L280-L282) · [Published guide](https://a2ui.org/guides/mcp-apps-in-a2ui/#synchronizing-state-and-tool-calls)

The fallback profile routes the headless `callMcpTool` declaration to the
owning agent through A2UI RPC. A separate test observes the returned data
transformed and written through the catalog's local data functions. The
browser app test uses a synthetic sandbox resource. Authenticated MCP
deployments and media permissions have separate host acceptance.

### Direct MCP tool evidence

`installMcpAppCatalog` enables direct `callMcpTool` for surface actions.
The host resolves the authorized operation using its surface ID, tool name
and resolved arguments. The tool response supplies a payload to the
caller's `targetDataPath` and forwards user-visible embedded A2UI resources
to the same renderer. A newer call to the same path supersedes an older
result. A failed call leaves the displayed state intact.
[Pinned tool contract](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/mcp/README.md#callmcptool) · [A2UI MCP catalog guide](https://a2ui.org/guides/mcp-catalog/)

Chromium clicks two controls with differing arguments for one tool. The MCP
SDK server replies in reverse order. Only the newer structured data and
A2UI update reach the view. A passive expression and an unauthorized tool
never reach the MCP server. An error result writes no state, and content
marked for the assistant stays out of the visible payload. The same test
runs against the installed package.
[Browser and SDK test](../test/mcp-transport-conformance.test.js)

When the host supplies `authorizeResource`, the catalog reads approved
links through the same client that ran the tool. Result-level
`_meta.ui.resourceUri` takes precedence over the tool descriptor, and visible
`resource_link` entries can add URIs. Linked layouts reach the renderer
before embedded updates. A static layout that would recreate a live surface
is skipped, so the next embedded update reaches the existing surface.
Linked or embedded MCP App resources supply HTML and declared UI metadata
to the tool payload. The separate `authorizeApp` policy governs mounting.
[Layout guide](https://a2ui.org/guides/mcp-catalog/#tools-that-return-a2ui-surfaces) · [MCP resource read](https://modelcontextprotocol.io/specification/2025-11-25/server/resources#reading-resources)

Two Three.js renderers in the same Chromium page share an MCP client and
use the same surface IDs. The test observes a layout in each calling
renderer, result-level precedence, an unapproved URI receiving no read,
and preservation of the mounted layout on a repeat call. It also verifies
that base64 HTML from a linked MCP App can be bound in the calling renderer.
The host retains discovery for independently chosen resources, authenticated
connections and subscriptions. [Browser and SDK test](../test/mcp-transport-conformance.test.js)

### MCP transport evidence

`createMcpTransportBinding` binds a host-selected MCP client to A2UI 1.0.
A `resources/read` response for the requested URI and embedded resources in
successful tool results carry `application/a2ui+json` arrays. A result
addressed exclusively to the assistant stays outside the mounted view.
The binding sends renderer Actions and Errors to the guide's `a2ui_action`
and `a2ui_error` tools. Per-call capabilities use `_meta.a2ui.rendererCapabilities`.
The scoped snapshot uses `_meta.a2uiRendererDataModel` in this profile.
[A2UI MCP guide](https://a2ui.org/guides/a2ui-over-mcp/#full-bidirectional-a2ui-transport-over-mcp) · [Pinned metadata clauses](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1612-L1645)

The browser loads a server-owned layout, clicks its native control, and
sees the server's resulting update. A renderer validation error reaches the
server as a separate call. The receiving tool verifies the 1.0 capability,
original action and scoped data model against the canonical schemas in the
test. The MCP SDK client and server communicate over loopback Streamable HTTP.
The same test runs against the installed renderer package.
[Browser and SDK test](../test/mcp-transport-conformance.test.js)

The guide also describes `initialize.params.capabilities.a2ui`. The browser
test reproduces that this field is stripped by the tested MCP SDK 1.32.2
server schema. The binding supports the guide's per-call capability
mapping, including inline definitions when the host supplies both an
explicit selection and an accepting agent capability. A separate MCP SDK
test receives the selected definition in `tools/call`, resolves it through
the published A2UI Agent SDK and returns a surface that mounts in Chromium.
The test observes omitted definitions for unselected catalogs and when the
agent has not advertised acceptance. An unregistered selection fails
before a tool call. [Per-call capability guide](https://a2ui.org/guides/a2ui-over-mcp/#stateless-servers-via-per-call-metadata)
Authenticated deployments, resource discovery and subscriptions remain with
the host. The guide defines Action and Error tool names. A host carrying
agent and renderer function RPCs over MCP needs a mapping for those envelopes.

#### Stateful MCP negotiation

The host captures the A2UI capabilities from the browser renderer and
registers them on the TypeScript MCP client before `connect()`. The Python
MCP 1.27.1 peer reads them from its session's initialization parameters.
The same tool call returns a plain-text fallback for a session without
the Basic Catalog offer. In the accepting session it returns an A2UI
layout resource. Chromium renders a button and sends its action and
scoped snapshot back to Python. The server verifies the displayed
revision and the browser shows the confirmed update. Neither call
repeats the capability offer in request metadata.

GitHub Actions runs the example with the renderer installed in a clean
consumer project. The host selects this profile when the MCP peer
preserves the initialization field. For the TypeScript MCP 1.32.2 server
tested above, use per-call advertising.
[Initialization guide](https://a2ui.org/guides/a2ui-over-mcp/#stateful-sessions-via-mcp-initialization) · [Python server](../test/fixtures/mcp-stateful-server.py) · [Browser example](../tools/check_mcp_stateful.js)

#### A2UI inside an MCP App

The host calls an entry tool and reads its approved `ui://` HTML resource.
The MCP Apps SDK receives the entry result through the standard
`ui/notifications/tool-result` notification. The HTML bundles Proyección
and runs in the inner opaque-origin frame. Chromium activates the button
with Enter and then with a pointer click. Each action calls the allowed MCP
tool with its displayed revision and the confirmed update reaches the same
inner surface. The outer renderer has no surface with the inner surface's
ID. The pointer check uses a fixed-height app with MCP Apps automatic
resizing disabled and maps the button center through both axis-aligned
frames and the outer CSS3D scale.

The host callback `renderToolResultInHost` can keep an entry tool's A2UI
resources out of the outer renderer while preserving the tool result for
the app. The default behavior still applies A2UI results to the host view.
In the example, the layout is embedded in the result; the linked resource
is the approved application HTML.
[A2UI inside MCP Apps guide](https://a2ui.org/guides/a2ui-in-mcp-apps/) · [Bundled view](../test-support/mcp-app-view.js) · [Browser test](../test/mcp-app-conformance.test.js)

### VegaChart catalog evidence

The optional `proyeccion/vegachart` entry point attaches a browser widget to
the unmodified 1.0 catalog. Chromium renders Vega and Vega-Lite as SVG in
a mixed Basic and VegaChart surface. The test changes bound frequency data
and chart height, then deletes the surface. It runs against the source and
again against the packed module installed with its optional peers. [Pinned catalog](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/vegachart/v1/catalog.json) · [Browser coverage](../test/vegachart-conformance.test.js)

Charts use inline resources and the Vega expression interpreter. The
browser test observes zero requests for an external chart data URL and
verifies that a chart cannot bind a signal to the host's input. Top-level
form bindings and global window or selector events are disabled in this
profile. Hosts can fetch approved data through their application and then
supply it inline. [Vega expression interpreter](https://vega.github.io/vega/usage/interpreter/)

### Inline catalog evidence

The host passes the current `agentCapabilities` and an explicit list of
local `inlineCatalogIds` to `capabilities()`. The browser test verifies the
canonical capabilities schema, refusal of unregistered IDs, deduplication
of the selection and fresh document snapshots. The pinned
`test_v10_get_renderer_capabilities_inline_catalogs` case also compares
the emitted capability document and both schema unions against its exact
expected 1.0 payload. The browser test uses the published
Agent SDK's accepting catalog resolver and message processor to build and
mount a custom component in Chromium. See the
[browser negotiation test](../test/catalog-loader.test.js).

### A2A binding evidence

`createA2aBinding` wraps renderer envelopes in ordered arrays tagged with
`application/a2ui+json`. It handles malformed tagged parts and leaves
ordinary A2A parts to the host. The browser test observes a valid update
after a malformed part and an invalid envelope, then uses the Agent SDK to
read the per-turn offer and consume a native button action. The matching
surface snapshot follows the action and the agent's update reaches the view.

An installed-package browser test sends four JSON-RPC turns to an
independent loopback server using the [official A2A JavaScript SDK](https://github.com/a2aproject/a2a-js).
The SDK discovers the Agent Card, negotiates A2A 1.0 and decodes tagged data
parts that the renderer mounts directly. An ordinary text turn carries the
fresh synchronized model after a real browser field edit. A later button
action carries its scoped model and the server response updates the button.
Explicit activation without an A2UI offer carries neither the offer nor the
model. A focused case verifies that the text-turn snapshot omits deleted,
unsynchronized and other-session surfaces and is detached from the live data.
[A2UI turn and snapshot rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md#L142-L148)

The same test runs an A2A 1.0 JSON-RPC stream. A status message creates a
surface, the first artifact chunk renders before the server releases the
next, and an appended chunk applies its valid update after reporting an
invalid envelope in that list. The host-selected stream can also deliver a
standalone message. A task snapshot is kept out of renderer ingress because
its history and accumulated artifacts may contain previously applied parts.
The host owns task selection and replay.
[A2A stream forms](https://a2a-protocol.org/latest/specification/#312-send-streaming-message)
· [A2UI list processing rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/extensions/a2a/docs/a2ui_extension_specification.md#L185-L195)

The binder reads inline-catalog acceptance only from the versioned A2UI
Agent Card extension. The turn encoder clears inherited A2UI metadata at
both message and part scope, and replaces inherited A2UI data parts. HTTP
activation is optional and independent
of the capability offer. The A2UI extension uses the legacy part form in
its examples. The selectable A2A 1.0 mapping follows the current
[A2A Part model](https://a2a-protocol.org/latest/specification/#416-part)
and [HTTP header definitions](https://a2a-protocol.org/latest/specification/#142-http-header-field-registrations).

One pinned A2A case exercises the applicable MIME recognition rule. Ten
cases use older A2UI envelopes or the agent's responsibilities for
advertising and selecting extensions. Those cases carry reasons in the
case manifest. The host owns authenticated network routing and gRPC request
encoding.

### AG-UI binding evidence

The binder consumes middleware `ACTIVITY_SNAPSHOT` events of type
`a2ui-surface` with 1.0 `a2ui_operations`. It scopes each view to one
activity `messageId`. Equivalent snapshots leave the view intact, a longer
snapshot with the same prefix applies its new operations, and a divergent
replacement rebuilds the scoped view from the new snapshot. Explicit
`replace: false` leaves an existing view intact. A matching
`ACTIVITY_DELTA` applies RFC 6902 JSON Patch to the last accepted activity
content before checking the resulting A2UI operation list. A delta before
the first snapshot has no effect. Failed patches and unsupported A2UI
operation envelopes leave the previous content and mounted view intact.
The host owns activity retirement and supplies a fresh projection for each
mount. [Middleware event source](https://github.com/ag-ui-protocol/ag-ui/blob/ed94ca4a3240527d3ef20fd0f0cc63501f44e469/middlewares/a2ui-middleware/src/index.ts#L1576-L1640) · [AG-UI activity events](https://docs.ag-ui.com/sdk/js/core/events#activitydeltaevent)

The browser test uses `@ag-ui/a2ui-middleware` 0.0.16 and `@ag-ui/client`
1.0.5. It observes a generated snapshot, a native click, delivery as
`forwardedProps.a2uiAction.userAction`, and the middleware's returned
update on the same mounted button. The browser receives the middleware's
appended operation as an activity delta, then receives the equivalent
snapshot without replaying the operation. The same test runs against the
installed package. AG-UI's middleware path consumes UI actions. An
application needing complete A2UI RPC or synchronized surface snapshots
provides its own envelope and metadata channel. [Middleware action source](https://github.com/ag-ui-protocol/ag-ui/blob/ed94ca4a3240527d3ef20fd0f0cc63501f44e469/middlewares/a2ui-middleware/src/index.ts#L443-L481) · [Browser test](../test/ag-ui-conformance.test.js)

## Renderer conformance evidence

### Wire transport and metadata evidence

| Requirement | Observed behavior |
| --- | --- |
| W01 | The JSONL receiver processes split and coalesced records in order. It reports malformed or oversized records and resumes at the next record. Actual Action, Error, CallAgentFunction and RendererFunctionResponse messages are checked against the pinned schemas. |
| W02 | Two independent connections reuse one surface ID with distinct state. Passive writes emit nothing. Each outgoing action carries only its connection's send-time snapshot, which is unaffected by subsequent updates. Capabilities and snapshots pass the canonical schema checks. |
| W03 | The catalog, ingress and action cases exercise extension containers with valid unknown keys and literal JSON. The browser retains its text and view identity while instance metadata changes. |
| W04 | In Chromium, the Web Core `metadata` property setter takes a defensive immutable copy on both models. Structurally equal writes and redundant removals emit nothing. An invalid extension key fails, an explicit null value survives and deleting the final key clears the snapshot. Replacement and omission over the wire notify listeners and update the resolved node without scheduling a view update. The action metadata test verifies an explicit egress extension. |
| S01 and S02 | [Lifecycle](#surface-lifecycle-and-message-processing-evidence), [composition](#composition-and-template-context-evidence) and the [mounted adapter](#spatial-adapter-case-evidence) verify progressive root, incremental definitions, the fixed root edge, deletion and view disposal. |
| E01 | [Error reporting](#error-reporting-and-data-model-synchronization-evidence) and [ingress validation](#a2ui-10-ingress-validation-evidence) verify classified errors, paths, scope, wire shape and correlation. |

Run the [protocol tests](../test/protocol.test.js),
[mounted adapter tests](../test/adapter.test.js) and the
[pinned case accounting](#reproduce-the-case-accounting) for issue
[#1](https://github.com/AlterMundi/proyeccion/issues/1).

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

The mounted Basic Catalog also has a Chromium regression test for editing and
clearing date-only, time-only and combined DateTimeInput controls. Clearing
either half of a combined control clears the bound string and both visible
fields. For `ChoicePicker`, two independently mounted renderers receive the
same surface and component IDs. Chromium checks that native keyboard and
pointer selection change only the corresponding model and visible radio
group. A separate browser test verifies filterable multiple selection and
exclusive chips, including the chips' pressed state. Passive edits stay on
the renderer. The
[Basic Catalog issue](https://github.com/AlterMundi/proyeccion/issues/3) tracks
the remaining adapter qualification.

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

In the installed renderer, reordering explicit children in a `Row`,
`Column` or `List` preserves the surviving input's browser focus and text
selection. A subsequent keystroke still writes to its original binding.
Removing the focused child leaves focus with the browser. A separate
browser test switches a mounted component between two catalogs under the
same ID and type, verifies rejection of an unknown catalog, and checks
that the unchanged sibling retains focus. Both use the package's real
ingress and mounted controls.
[Catalog resolution](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L511-L533)

A packaged browser test mounts the viewport inside nested closed shadow
roots. A host-mediated scene ray focuses the native button and dispatches
one action with the mounted surface ID when it is visible. An overlapping
external DOM control blocks the ray without receiving a synthesized click.

### Basic Catalog component evidence

The [18 component definitions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/basic/v1/catalog.json#L7-L676)
are exercised in mounted Chromium surfaces. The evidence below covers the
adapter's viewport presentation and browser interaction with the catalog.
The [adapter fixtures](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/adapter_conformance.yaml)
and [local browser assertions](../test/adapter.test.js) provide these checks:

| Component | Mounted behavior verified |
| --- | --- |
| `Text` | Declared text and hierarchy, live updates from a bound input, and the specified Markdown subset. |
| `Image` | Description becomes the accessible name. An updated bound URL decodes a different local image, confirmed by its intrinsic width. |
| `Icon` | The stock icon name binds to a Material Icons ligature and the bundled font loads. |
| `Video` | Bound source and native controls. Chromium decodes and plays a synthetic WebM to completion. |
| `AudioPlayer` | Bound source and native controls. Chromium decodes and plays a synthetic WAV to completion. |
| `Row` | Mounted children appear in the declared order in a nested hierarchy. |
| `Column` | Declared children mount in order, including late definitions and replacement of a component type. |
| `List` | Horizontal and vertical layouts preserve order in the browser. Repeaters reconcile insertions, removals, reorderings and scoped index values. |
| `Card` | A single declared child mounts in the nested hierarchy, and accessibility attributes reach the browser. |
| `Tabs` | A browser gesture switches the mounted content. |
| `Modal` | Opens from a browser gesture, cycles focus, closes on Escape and returns focus to the trigger. |
| `Divider` | Orientation appears in the rendered separator. |
| `Button` | Pointer, keyboard and host-mediated ray activation resolve the expected action. Validation and activation policies govern dispatch. |
| `TextField` | Default short text, multiline text, numeric input and obscured input expose their native types. Edits write strings to the model and agent updates reach the controls. |
| `CheckBox` | Native checked state updates its boolean binding. |
| `ChoicePicker` | Exclusive selection, filterable multiple selection and chips update their string-array bindings. Independent projections retain independent radio groups. |
| `Slider` | The native bound range updates its numeric model value. |
| `DateTimeInput` | Date, time and combined edits reach their string bindings. Clearing either part of a combined input clears both native fields and the model. |

The [browser round trip](../test/browser.test.js) verifies the pointer,
keyboard and host-mediated ray paths on a transformed surface. The adapter
suite also verifies view release on unmount, component removal and surface
deletion. The [function evidence](#basic-catalog-function-evidence),
[template evidence](#composition-and-template-context-evidence) and
[accessibility evidence](#accessibility-case-evidence) cover the rest of the
catalog's adapter qualification in issue [#3](https://github.com/AlterMundi/proyeccion/issues/3).

### Data model case evidence

Issue [#2](https://github.com/AlterMundi/proyeccion/issues/2) links the
measured requirements for data, catalogs and functions:

| Requirements | Evidence |
| --- | --- |
| C01–C03 | [Catalog selection](#catalog-selection-and-agent-routing-evidence), [declarative loading](#declarative-catalog-loading-evidence) and [composition and template scope](#composition-and-template-context-evidence). |
| D01–D03 | Pointer and deletion cases below, [dynamic values](#node-resolution-and-dynamic-value-evidence), [reserved keys](#expression-syntax-and-literal-data-evidence) and [mounted two-way bindings](#basic-catalog-component-evidence). |
| F01–F03 | [Basic functions](#basic-catalog-function-evidence), [fallback routing](#catalog-selection-and-agent-routing-evidence) and [RPC ordering, scope, cancellation and failure](#invocation-and-transport-failure-evidence). |
| F04–F05 | [Action dispatch](#action-dispatch-evidence) and [validation recovery](#validation-and-action-recovery-evidence), including trusted gestures and the behavior of checks before and after a response. |

The [case manifests](#reproduce-the-case-accounting) record results and
exclusions by suite and case name.

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

The passing cases in
[agent_function_routing.yaml](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/agent_function_routing.yaml)
pass through the renderer session. They cover live bindings, checks, actions and
events, ordered or concurrent argument evaluation, error propagation and
cancellation on retained or deleted surfaces. The suite checks the resolved values and
actual transport messages, including exact response correlation and
schema-checked arguments for declared remote functions. Undeclared functions
use the protocol's fallback rule and the test verifies the call envelope
and resolved JSON arguments against the fixture.

The case for a missing listener passes in receive-only mode. Two routing
cases are skipped. One uses A2UI 0.9. The other is the upstream alternative
for cores that re-evaluate a nested call after an unrelated outer binding
changes. This renderer passes the equal-argument rewrite case instead.

The host can call `cancelSurfaceCalls(surfaceId)` to cancel outstanding
agent RPCs without unmounting a surface. Late replies for its cancelled
calls are ignored by the renderer. A subsequent qualifying data change
starts a new call. Chromium verifies the retained surface's identity and
observes the second surface's pending call complete independently. The
agent and its transport own any remote cancellation.

### Surface lifecycle and message processing evidence

Seventy-eight cases in the pinned
[message processor suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/message_processor_v1_0.yaml)
pass through the renderer entry point. The cases verify create/update/delete
ordering, buffering before root, the atomic rejection of cyclic component
batches, extension validation, catalog selection through component updates,
metadata replacement and removal, and a real emitted data snapshot for a
surface with no default catalog. Invalid framing reports one transport error
and leaves the session unchanged. Valid envelopes that fail processing return
schema-checked protocol errors.

Strict cases verify catalog selection for components and nested function
calls, rejection of the legacy surface theme field and rejection of an
unknown system function at ingress. Across adjacent calls, the host can
allow temporary orphans on one update and reject them on the next. Rejected
surface creations leave no registered surface behind. In the streaming
profile, a separate test verifies that an unknown system function resolves to
null and reports an expression error without calling the agent.

Six cases are skipped. Five involve legacy or mixed versions. The
nested-combiner fixture expects a structural root declaration that
A2UI 1.0 prohibits. A separate registration test verifies that Proyección
rejects that catalog before processing component fields. Ordinary inline
custom properties and the canonical `@metadata` envelope pass in adjacent cases.

### Composition and template context evidence

All ten cases in the pinned
[composition suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/composition_constraints.yaml)
pass through the renderer session. They verify the implicit `Surface` parent,
multiple incoming edges, container allowlists, and the resolved tree after a
partial update drops a child. In the streaming profile the disconnected
definition stays available. With strict topology enabled the update reports
`INTEGRITY_ERROR` and the original parent still contains the child.
Wire assertions check the error code, surface, applicable path and offending
component. They normalize the display notation of the allowed-type list.
A separate test verifies that a late invalid template definition leaves its
two rows pending and that a valid definition resolves both at their own paths.

All eleven
[path-context cases](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/data_context.yaml)
and four
[index-function cases](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/index_function.yaml)
pass. The renderer resolves absolute references from the surface and relative
references from each row. Outside a list, `@index` resolves to null and reports
an expression error during evaluation. The Chromium probe nests two lists,
then changes the ordering inside one group. The visible labels and the
innermost indices update with the data while the outer group indices stay
the same.

### Invocation and transport failure evidence

Twenty-eight cases in
[rpc_functions.yaml](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/rpc_functions.yaml)
pass through the renderer session. They check caller boundaries, malformed
invocation envelopes, argument validation, exact response correlation, and
the isolated data context for calls without a surface. They also check
timeout, late response handling, cancellation on deletion or disposal, and
recovery of bindings, checks and action pipelines from a failed agent reply.
The renderer assigns call IDs, requires a transport listener, rejects mixed
versions at registration, and takes no browser activation from wire messages.
Five standalone SDK fixtures are excluded. Two register a gesture-required
function for agent invocation. A separate test checks registration rejection
and the correlated denial of an agent call against a valid renderer-only
gesture function.

Two JSONL regressions verify [RPC dispatch ordering](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L314-L320)
and [resolved fallback arguments](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1478-L1495).
A renderer function reads the preceding write while a later mutation takes
effect before the function finishes. A declared agent function receives its
resolved catalog, binding and default argument. Its response resumes the
action once, observes the earlier update, and a duplicate response produces
no second effect.

Transport rejection is treated as a failed agent call immediately. Both a
synchronous throw and a rejected delivery promise produce a correlated
expression error, stop dependent local effects, and ignore a late reply.
Synchronous and asynchronous renderer RPC argument failures produce a single
reply tied to the invocation. Proyección scopes the argument diagnostic
channel through the pinned Web Core 0.16.1 argument resolver. Its regression
test rejects two calls on the same surface in reverse order while an
independent binding fails with identical error text. The binding's error is
delivered while the calls are pending, each invocation receives just its own
reply, and the outer function never runs. Requalify this adapter seam when
updating Web Core.

The wire boundary checks each renderer function result before sending it. A
cyclic result, BigInt, non-finite number or nested undefined value produces a
schema-valid `EXECUTION_ERROR` with the original call ID. Successful results
are JSON snapshots. At the session limit of 256 pending calls, a new call
receives a correlated `INVALID_FUNCTION_CALL` and can be retried after a
slot opens. A duplicate pending ID reports a transport fault so it cannot
settle the original call. These cases are tested independently of the
pinned fixture counts. See the [function response contract](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1516-L1527).

### Reactive RPC evidence

With the default policy, two mounted text bindings on one surface share a
request and display its answer. With `maxAgentCallCacheEntries: 0`, the same
bindings send independent call IDs and receive their own answers. This policy
applies per renderer session. A positive limit bounds the settled answers
held by each surface, with 256 by default. The cache uses catalog, function
and canonical JSON arguments as its key.

The [renderer RPC tests](../test/rpc-conformance.test.js) also observe
independent copies of shared results, cache isolation across surfaces,
eviction at a one-entry limit, a fresh invocation after a failed call, and
cache disposal on deletion and recreation. The separate
[action tests](../test/action-conformance.test.js) verify that identical
button gestures make separate calls and keep their own result and timestamp.

### Validation and action recovery evidence

Four cases in the pinned
[validation result suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/validation_result.yaml)
pass with mounted Chrome controls. They verify structured results, nonblocking
warnings and information, recovery on an agent data update, and
`ValidationResult.valid` coercion in logical expressions.

The numeric and multi-rule fixtures are recorded as skipped because their
expected messages prioritize the rule text over a function's returned message.
The same payloads run in Chrome with separate assertions following
[the A2UI 1.0 coercion rule](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1137-L1140):
the returned message is shown, and rule text supplies the fallback.
These assertions also verify the original declaration order. The correction
is scoped to the renderer's Lit views and relies on the pinned Web Core
resolver and binder hooks. Requalify them when updating Web Core or Lit.

A separate browser test edits an invalid email through the native input.
The accompanying button stays disabled until the correction, then sends
exactly one action with the new email. A second browser test gives three
checks correlated remote failures. A check without rule text shows the
remote error message, while each check with explicit text retains it,
including an explicit string identical to the SDK default. This follows
[validation failure propagation](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1604-L1608).

### Declarative catalog loading evidence

The three pinned [runtime registration cases](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/add_catalog.yaml)
pass through the host `addCatalog(catalog)` entry point. A catalog becomes
available to new surfaces and is included in capability IDs. Existing
surfaces retain their original catalog scope, and registration rejects a
duplicate ID. In Chromium a new surface mounts a locally added custom
widget. The same test observes that a wire envelope named `addCatalog`
reports a transport fault and grants no new catalog, the earlier view
stays mounted, and a disposed session refuses registration.

Thirty-one cases in
[the catalog suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/catalog.yaml)
exercise `loadCatalog` and registration. They cover Unicode identifiers,
function permissions, catalog-local references, rejection of foreign
references, component metadata, and capability advertisement for the loaded
catalog. An intercepted `fetch` observes zero calls across accepted and
rejected documents. The Basic Catalog's loaded component shapes and function
boundaries match the built-in implementations.

Programmatic registration rejects duplicate catalog IDs before exposing
capabilities. This keeps default and explicit lookups on one catalog.
Registration also enforces [catalog entity names](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L545-L555)
and the [gesture-only declaration rule](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/catalog_definition.json#L152-L174)
for host-constructed functions.

The loader follows the versioned
[catalog structure rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L594-L647).
It rejects structural root combinators and reserved `Surface` declarations at
registration. It accepts the standard `Checkable` import used by the Basic
Catalog. A browser test also verifies that failed registration adds neither a
scene group nor a viewport layer. One upstream leaf-definition fixture uses a redundant
`ComponentCommon` root wrapper. The manifest records it as skipped. A separate
test rejects that original catalog and verifies the same leaf constraints
with a flat component. The Basic Catalog serializes to the published JSON
and produces the upstream validation schema. The Basic and MCP catalogs
and the function and component metadata fixtures round-trip unchanged,
including in the renderer's negotiated inline payload. Catalog derivation
is a host authoring utility, and the legacy and noncanonical wrapper
cases carry their reasons in the manifest.

### Expression syntax and literal data evidence

All 98 cases in the pinned
[expression suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/expressions.yaml)
pass. Ninety-two exercise the Web Core parser shipped with the renderer.
Six exercise expression evaluation through a registered catalog and live
surface resolver, including invalid syntax and excessive nesting. The invalid
binding produces null and emits a schema-valid expression error with the
original surface ID. The fixtures do not assert the number of diagnostics.
These cases exercise the
[`formatString` rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1286-L1368).

All ten cases in the pinned
[reserved-key suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/reserved_keys.yaml)
pass. Registered surfaces apply the
[directive and escaping rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1256-L1266).
A mounted Chromium button sends an action whose payload preserves literal
`path`, `call` and escaped `@` keys alongside a resolved data-model reference.

### Error reporting and data-model synchronization evidence

Twenty-three cases in the pinned
[error response suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/error_responses.yaml)
pass through the renderer session. The checks verify a single schema-valid
envelope for the rejected operations, the correlation field, and the exact
JSON Pointer when the fixture specifies one. The progressive rendering case
observes a pending child resolve when its definition arrives. With strict
validation enabled, the renderer emits `INTEGRITY_ERROR` for missing child
definitions and orphaned components, and `VALIDATION_FAILED` with
`/components/0/component` for an unknown component type. The cycle case
rejects the update with the expected code and surface ID and identifies
`root` in the diagnostic. The only excluded case targets A2UI 0.9.

If an agent RPC fails while evaluating a surface binding, Proyección now sends
the originating surface's current model in the transport metadata when enabled.
The wire error retains the call ID as its sole correlation field. The regression
test uses overlapping surface IDs on two transports, a passive edit between
dispatch and failure, and a surface replacement before error delivery. It
verifies targeted snapshots, send-time values, and no data from the replacement.
See [data model synchronization](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1095-L1102)
and [error correlation](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1556-L1565).

### Action dispatch evidence

Thirteen cases in the pinned
[action dispatch suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/actions.yaml)
pass on mounted Chromium surfaces. The checks compare exact event names,
source IDs, resolved context, optional user messages and schema-valid
timestamps. Clicking the second repeated row resolves its own data and
index. The bound action also accepts valid extension metadata from the
renderer call site and rejects an invalid extension name before sending.

A local function can update the data model without emitting an agent action.
A thrown local failure emits one surface-correlated `EXECUTION_ERROR` and
leaves the surface mounted. The activation probe confirms that `openUrl`
invokes the browser opener for a genuine click and declines a synthetic
click. This follows [action definitions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L862-L905)
and the [outbound action schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_to_agent.json).

Three legacy cases are excluded. Two fixtures expect runtime `INVALID_ACTION`
for malformed action declarations. Through the renderer's wire entry point
they instead produce a schema-valid `VALIDATION_FAILED` before the control
mounts. A separate browser probe starts with a valid dynamic `userMessage`,
updates its binding to a number and observes one `INVALID_ACTION`. Updating
it to a string restores successful dispatch from the same button.

Browser action timestamps mark when the interaction starts, before any
asynchronous context or user-message expressions resolve. A Chromium test
clicks the same button twice and completes the two agent calls in reverse
order. Each outbound action contains its own interaction timestamp and the
value from its own reply. The adapter relies on the pinned Web Core binder
and the identity of its fully resolved action context. Requalify both when
updating Web Core. See the [action timestamp clause](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1444-L1454).

### Basic Catalog function evidence

Eighty-nine cases in the pinned
[functions suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/functions.yaml)
pass. They exercise the 14 Basic Catalog functions through live surfaces,
including argument validation, nested calls and date, number, currency and
plural formatting. A nested call written as a JSON argument resolves its own
catalog. A call embedded in a `formatString` template inherits the enclosing
function's catalog. The system `@index` remains catalogless, and an
agent-only function refuses renderer invocation.
See [catalog resolution](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L511-L524)
and [Basic Catalog functions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1268-L1339).

The [regex dialect cases](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1342-L1366)
check matching, Unicode code points, safety rejection codes and the pattern
and input limits. The two `openUrl` cases use trusted clicks on mounted
Chromium buttons with an instrumented opener. HTTPS reaches the opener, and
a disallowed scheme produces one surface-correlated expression error.

Six cases target 0.9. Seventeen older cases expect a bare boolean. Their
inputs run on 1.0 surfaces and the `valid` field agrees with the expected
boolean, while the manifest records the original result shape as excluded.
Four older cases pass arrays to `length` or strings to `numeric`. The
1.0 catalog declares a DynamicString and a DynamicNumber respectively, and
the renderer reports an expression error for those literal arguments.
See the [1.0 function schemas](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/basic/v1/catalog.json)
and [ValidationResult coercion](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1118-L1153).

### Basic Catalog Markdown evidence

All seven cases in the pinned
[Markdown adapter suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/adapter/markdown_subset.yaml)
pass in a mounted Chromium surface. Titles, lists, emphasis and inline code
render as formatted content. Raw HTML displays as text. Markdown links and
images display their label or alternative text without creating an active
link or an image request. This follows the [Text component schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/catalogs/basic/v1/catalog.json#L9-L19).

### A2UI 1.0 ingress validation evidence

The passing cases in the pinned
[validator suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/validator_v1_0.yaml)
pass through Proyección. They exercise framing, custom schema constraints,
surface isolation, recursion limits, Unicode identifiers, extension keys
and caller restrictions in bindings and actions. The test uses a locally
registered alias for the old Basic Catalog URL used by some fixtures.

Invalid `updateDataModel.path` syntax produces one `VALIDATION_FAILED`
report with `/path` and the requested surface ID. This also applies when
the target surface is absent. A regression test verifies that an invalid
escape preserves the old data and a subsequent RFC 6901 escape updates the
intended key. See the [update format](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1036-L1050)
and [validation error format](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1416-L1423).

An empty JSON Pointer, an omitted pointer and `/` reach the root.
Surfaces with `sendDataModel` enabled require an object there because the
[snapshot schema](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/renderer_data_model.json)
defines each synchronized model as a JSON object. Invalid root replacements
leave the previous model intact. A null root replacement clears it to an
empty object. Surfaces without synchronization retain Web Core's ability
to use arbitrary JSON values at the root.

For a host that expects a complete component tree after an update,
`receive(envelope, {strictTopology: true})` checks the root, reachability
and child references before applying it. `receiveBatch` can apply the same
check to each update in a batch of complete trees. Chromium observes an
invalid update leave the view intact, then applies the same update
progressively and adds the missing child. Normal ingestion continues
to support incomplete trees. With `strictTopology: true`, a host can add
`allowOrphanComponents: true` to stage definitions before attaching them.
The root and all child references must still resolve before each update
applies. Chromium verifies that a staged child stays out of the view until
attached and that a rejected dangling reference leaves the current view intact.
The independent `strictCatalog` option rejects
undeclared component and function names against the resolved catalogs.
Chromium verifies strict catalog checks allow progressive composition, and
combining both options rejects an unknown child without changing the valid
sibling in the same update. Passing only `strictTopology` applies the same
update, renders the valid sibling and reports `UNKNOWN_COMPONENT_TYPE` for
the skipped child. The validator suite retains its cycle diagnostic exclusion.
[Progressive composition rules](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L779-L818)

The renderer checks the height computed by Web Core for the candidate
component graph before committing an update. Both the 50-edge chain and
the 51-edge rejection are covered by the pinned fixtures. A separate test
buffers a 50-edge chain before the root arrives, verifies that adding one
more edge is rejected without changing the buffered nodes, and then mounts
the same subtree at an allowed depth.

Proyección's 1.0 ingress guard distinguishes literal JSON from
[binding and template paths](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/common_types.json#L78-L152).
Literal `path` keys keep their values in a mounted action. Raw data,
extension metadata and agent function results also preserve literal
`@path` keys. Malformed data binding and child-template paths report
their exact fields, including `/components/0/text/@path` and
`/components/0/children/path`. The original messages still go through
the Web Core operation parser and catalog validator. The guard uses Web
Core's existing depth limits and the catalog's child-reference map.
Requalify these processor hooks when updating Web Core.

### Node resolution and dynamic value evidence

All eight A2UI 1.0 cases in the pinned
[node resolution suite](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/core/node_resolution.yaml)
pass against surfaces created through the renderer protocol. The tests cover
direct binding and function schemas, scoped writes, stable node identities,
complete property snapshots, metadata-only notifications, and action
metadata on the wire. The inline create case observes the initial bound
value with no follow-up emission. The separate-message case observes one
emission when data arrives after the component. The 24 other cases use
0.9.1 catalog fixtures and are excluded. The spatial adapter suite
independently checks mounted 1.0 views.

Ingress rejects extra fields in a data binding or function call and
malformed or extra arguments to `@index`. The regression checks a binding mixed with a call,
the exact escaped field pointer in each diagnostic, and the unchanged
component after rejection. A valid subsequent update is accepted. See
the [DataBinding and DynamicValue definitions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/common_types.json#L104-L154)
and the [FunctionCall and IndexSystemFunction definitions](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/json/common_types.json#L215-L266).

### Reproduce the case accounting

Use a fresh results directory, a checkout of the pinned A2UI revision, and
Python with PyYAML and jsonschema installed.

```sh
A2UI_CONFORMANCE_MANIFEST_DIR=./results npm test
python3 tools/check_conformance.py /path/to/a2ui ./results
```

The verifier checks the revision and fixture bytes and runs the official
comparer over every vendored suite. Successful GitHub Actions runs attach
an `a2ui-conformance-cases` artifact for 14 days. Each record names the suite,
case and observed result. Excluded cases carry the reason. The same command
regenerates the evidence after the artifact expires.

The alpha.6 manifest accounts for 567 passed and 121 skipped cases across
the 27 selected suites. The release retains the manifest alongside the
verified tarball.

| Reason | Cases in alpha.6 | What the remaining evidence covers |
| --- | ---: | --- |
| Legacy or mixed A2UI versions | 69 | The renderer implements A2UI 1.0. The applicable 1.0 cases exercise wire validation, catalog registration and resolution. |
| Agent or authoring roles | 15 | Agent-side A2A advertisement and catalog derivation use their own APIs. Proyección verifies [A2A client behavior](#a2a-binding-evidence) and [catalog loading](#declarative-catalog-loading-evidence). |
| Standalone SDK APIs | 3 | The strict graph override is verified on main after alpha.6. The other two cases require a caller-selected outbound RPC ID or a direct SDK connection to its RPC port. The renderer covers associated [routing and failure behavior](#invocation-and-transport-failure-evidence) through its public session. |
| Alternative reactive fixture | 1 | The upstream suite offers two alternatives for restarting a cancelled reactive call. Proyección passes the [equal-argument rewrite case](#catalog-selection-and-agent-routing-evidence). |
| Fixture model, schema or diagnostic differences | 33 | The manifest records each difference. The linked evidence sections cover the pinned wire rules, including 1.0 function result shapes, rejected catalogs and malformed envelopes, and the actual diagnostic for a cycle. |

[Download the alpha.6 case manifest](https://github.com/AlterMundi/proyeccion/releases/download/v0.1.0-alpha.6/a2ui-conformance-cases.jsonl)

### Ordered envelope batches

`receiveBatch` accepts an array of decoded A2UI envelopes or a host
container with a single `messages` array. Each envelope uses the same
version and shape checks as `receive`. The outer API container is a
convenience for the host. The transport remains responsible for
framing and metadata.

The pinned container fixture creates both surfaces. A separate test
observes an RPC capturing the preceding data value while a subsequent
write updates the view before the RPC settles. A malformed envelope is
reported without preventing the following valid envelope from applying.
The four Chromium transcripts also use array batches in the installed
package.
[A2UI dispatch order](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L315-L320)

### Receive-only projections

Omitting `send` configures a one-way A2UI session. In Chromium, an
incoming update and a catalog-local button action update the mounted
view without outbound delivery. The upstream routing case verifies
that a missing local function fails with an expression error on its
surface when an agent cannot be reached. An inbound renderer function
request requires a response channel. In a receive-only session it reports
`NO_LISTENER` to `onTransportError` before invoking the function.
[Transport clause](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L81-L94) · [RPC response requirement](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L300-L320)

### A2UI 1.0 end-to-end transcripts

The browser harness executes the renderer half of all four pinned 1.0
transcripts using the fixtures' exact `expectWire` envelopes. It checks
the rendered tree, labels and input values, then uses browser input and
clicks to exercise the declared interactions. It compares outgoing
actions and errors to the expected envelopes and validates them and
their accompanying snapshots against the wire schemas. The restaurant
scenario verifies repeated rows and the native date and time controls
with Chromium set to UTC. The missing-surface scenario verifies the
error and absence of a mounted view.

The same cases run against an installed tarball and count in the
upstream manifest. Model chunk parsing belongs to the agent half of
these transcripts. The separate package example exercises an
independent Agent SDK round trip.
[Pinned transcripts](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6/conformance/e2e) · [Upstream renderer algorithm](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/conformance/conformance_harness_implementation_guide.md#renderer-half-algorithm) · [Browser assertions](../test/e2e-transcripts.test.js)

### Verify the installable renderer

Run `npm ci` and `npm run check:package` from the repository. The check packs
the renderer, verifies the tarball contents, and installs it with the
supported Three.js version in a temporary consumer project. Chromium runs
the example against the installed package and the published Agent SDK. The
round trip verifies a rendered agent update, a schema-checked outbound
action and its resulting update, along with the example's separately
attributed direct domain action and renderer disposal.

Successful GitHub Actions runs attach the tested tarball plus its SHA-256
checksum under `verified-renderer-package`, alongside the case manifests.
The package and browser evidence address issue
[#4](https://github.com/AlterMundi/proyeccion/issues/4). Weaver in Holodeck on
Legion has its own integration acceptance.

### HTTP and WebSocket binding evidence

`createHttpLiveBinding` receives ordered arrays of A2UI 1.0 envelopes in
WebSocket text frames. Every connection starts with a `createSurface`
envelope. Its snapshot replaces the previous projection. UI actions travel
as A2UI envelopes via HTTP POST. The application owns state and revisions.
A successful or conflicting HTTP response is a receipt, and the WebSocket
delivers application state. The host selects endpoints and reconnects.
This action-only HTTP profile follows Weaver's domain endpoints. Hosts
needing capability negotiation, transport metadata or function RPCs use
a binding that carries those channels.

Chromium exercises malformed frames, conflict receipts, live updates,
replacement by a fresh snapshot, and subsequent actions with the new
revision. The reconnect asserts that the earlier action is sent once.
[Browser test](../test/http-live-conformance.test.js)

A device-free Harmonic Weaver preview exercised the same binding against
its application server. A direct domain action updated both views, then
changes from the Three.js and native web views each reached the other
through Weaver. A reconnect mounted the current snapshot without writing
an action. The trial restored the starting volume and stopped the preview.

### Weaver host contract

The browser integration can pin [Proyección 0.1.0-alpha.6](https://github.com/AlterMundi/proyeccion/releases/tag/v0.1.0-alpha.6).
Use `createProyeccion` with `createHttpLiveBinding` against the selected
Weaver session's `/api/a2ui/weaver/live` WebSocket and
`POST /api/a2ui/weaver/actions`. The host associates these routes with the
same authorized Lab session. The application also exposes the independent
`/api/lab/controls` read and revisioned write. A direct action uses the
current session ID and revision from that read. The view's placement and
the action grants remain with the host.

The renderer's disposable preview established this exchange. The receiving
Holodeck integration still needs acceptance on the selected Legion instance,
including an authorized reversible change, independent readback and
restoration in the same world.

For a machine with the Weaver development preview available, install the
release tarball in a separate consumer directory, start a disposable preview
without audio or tracking devices, and run the browser check from the
Proyección repository.

```sh
node tools/check_weaver.js http://127.0.0.1:18895/ /path/to/consumer
```

The check uses the installed package and the preview's supplied web UI.
It verifies both views, reconnects Three.js, and holds back a UI action
while a direct application write advances the revision. Weaver rejects the
older action with HTTP 409. The check then drops the HTTP response to an
accepted write and independently reads back a single revision advance.
Both views receive the confirmed volume and the check restores the original
value. Alpha.2 through alpha.6 passed this check against Weaver revision
`0db5336e6af7be0a9b273d10d3bba2a691f07a3d`. The alpha.6 preview used the
verified CI tarball, which matched the published release byte for byte.
The Weaver side requires its development preview with the endpoints above.
[Browser check](../tools/check_weaver.js)

### HTTP request-response evidence

`createHttpTurnBinding` implements the request-response pattern using a
host-owned JSON POST endpoint. This project binding uses `{messages,
metadata}` on requests and `{messages}` on successful replies. A host can
return HTTP 204 for an empty result. An explicit poll carries an empty
message array and sends the renderer's capabilities. An outbound A2UI
message carries the originating surface snapshot when the renderer supplies
one. Inline catalog definitions require the host's selection and agent
acceptance. [A2UI request-response pattern](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L421-L446) · [Metadata clauses](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L1612-L1645)

Chromium polls the server to mount a 1.0 surface and sends a real button
action. The HTTP response contains an update, a renderer function invocation
and a later update. The function sees the prior mutation and returns its
result in a follow-up POST. A second button calls an agent function over
HTTP and uses the correlated result to send its action. The test validates
the emitted envelopes, capability offers and snapshots and repeats against
the installed package. The host owns polling cadence and authentication.
[Browser test](../test/http-turn-conformance.test.js)

### Bidirectional WebSocket evidence

`createWebSocketBinding` uses a host-selected socket and JSON text frames
with ordered `messages` arrays. The opening renderer offer carries
`metadata.a2uiRendererCapabilities`. Agent frames can announce
`metadata.a2uiAgentCapabilities`; an acceptance change updates the offer
for the host-selected inline catalog IDs. Outbound messages can carry
`metadata.a2uiRendererDataModel` from the originating surface. The binder
limits frame size and the queued outbound bytes to 1 MiB. The host owns
authentication and reconnection with a fresh renderer session.
[A2UI bidirectional transport](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L450-L478) · [WebSockets Standard](https://websockets.spec.whatwg.org/#the-websocket-interface)

Chromium negotiates with a loopback WebSocket server, exchanges calls in
both directions while one remains pending, and renders the resulting state.
The server sees each correlated response and the originating surface's
revision. The test verifies an inline catalog withdrawal, recovery after a
malformed frame and shutdown. It runs on the source and installed package.
[Browser test](../test/websocket-conformance.test.js)

### SSE and JSON-RPC binding evidence

The specification names SSE with JSON-RPC and leaves the endpoint mapping
to the binding. This project profile associates both URLs with the same
host-owned session. The stream emits named `a2ui` events with one A2UI
envelope per event. The JSON-RPC 2.0 endpoint accepts the following methods.
[Pinned A2UI transport clauses](https://github.com/a2ui-project/a2ui/blob/a337e800ede809c3a8ebca604918149380c11ec6/specification/v1_0/docs/a2ui_protocol.md#L81-L118) · [JSON-RPC 2.0](https://www.jsonrpc.org/specification)

| Method | Named parameters |
| --- | --- |
| `a2ui.capabilities` | `metadata.a2uiRendererCapabilities` |
| `a2ui.send` | `envelope` and `metadata`, including `a2uiRendererDataModel` when supplied by the originating surface |

The server returns a correlated receipt for each POST. A2UI replies and
projection updates arrive on SSE. POSTs are serialized in emission order
and keep the original send-time data even if more updates arrive while
waiting. The host acknowledges accepted requests before work that requires
a later renderer reply. The client limits outstanding POSTs and fails a
receipt after 30 seconds. It never retries an outbound write.

Chromium mounts a multiline event, continues past malformed input, verifies
send-time snapshots across delayed and invalid receipts, and receives a
function invocation resolved in the resumed surface. The loopback server
sees the browser's `Last-Event-ID` and supplies the next revision to the same
mounted view. Replay retention and authorization are server responsibilities.
The same round trip runs on the installed package.
[EventSource resumption](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header) · [Browser test](../test/sse-jsonrpc-conformance.test.js)

### Runnable shared session

`npm run dev:shared` serves the shared workbench example on loopback.
The application holds one synthetic subject in memory. Two browser views
negotiate capabilities, receive its state over SSE and submit UI actions
with JSON-RPC. A separate HTTP endpoint on the same application exposes its
typed read and rename operations. The application checks the revision
for either write and retains the fixture actor that performed it.

Chromium opens the second tab from the example, observes that draft input
stays local, applies a UI edit and waits for the other tab's confirmed
update. An HTTP client observes the revision and fixture actor, then applies
a direct write that both tabs receive. A stale direct write returns HTTP 409.
The installed package runs the same example. This synthetic session has its
own evidence. Weaver inside Holodeck on Legion has separate acceptance.
[Run the example](../README.md#open-two-live-views) · [Browser test](../test/browser.test.js)
