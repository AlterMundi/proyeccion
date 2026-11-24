# Upstream A2UI 1.0 fixtures

These are unmodified files from A2UI revision
[`a337e800ede809c3a8ebca604918149380c11ec6`](https://github.com/a2ui-project/a2ui/tree/a337e800ede809c3a8ebca604918149380c11ec6).
The wire schemas are from `specification/v1_0/json`; `catalog.json`
is from `catalogs/basic/v1`. The accessibility cases come from
`conformance/core/accessibility.yaml` and the widget scenarios come from
`conformance/core/adapter_conformance.yaml`. The data model cases come from
`conformance/core/data_deletion.yaml` and `conformance/core/data_model_pointers.yaml`.
Catalog selection and fallback routing come from `conformance/core/multi_catalog.yaml`
and `conformance/core/agent_function_routing.yaml`. Lifecycle cases are from
`conformance/core/message_processor_v1_0.yaml`. Composition and template cases
come from `conformance/core/composition_constraints.yaml`,
`conformance/core/index_function.yaml` and `conformance/core/data_context.yaml`.
Streaming growth cases come from `conformance/core/message_processor_scaling.yaml`
and use `conformance/test_data/catalogs/composition_catalog_v1_0.json`.
Invocation and validation cases are from `conformance/core/rpc_functions.yaml`
and `conformance/core/validation_result.yaml`. Catalog loading cases are from
`conformance/core/catalog.yaml`. Runtime registration cases come from
`conformance/core/add_catalog.yaml` and use the pinned simplified and custom
catalogs in `conformance/test_data/catalogs`. Expression and reserved-key cases are from
`conformance/core/expressions.yaml` and `conformance/core/reserved_keys.yaml`.
Error envelope cases come from `conformance/core/error_responses.yaml`.
Action dispatch cases come from `conformance/core/actions.yaml`.
Function evaluation cases come from `conformance/core/functions.yaml`.
Markdown cases come from `conformance/adapter/markdown_subset.yaml`.
Ingress validator cases come from `conformance/core/validator_v1_0.yaml`.
Node resolution cases come from `conformance/core/node_resolution.yaml`.
The pinned A2A extension cases are in `conformance/extensions/a2a/a2a_integration.yaml`.
The four 1.0 setup documents are from `conformance/test_data/node`.
The `catalogs/` directory holds the pinned MCP
and VegaChart v1 catalogs plus the function selection, caller, node, function
metadata and component metadata documents from `conformance/test_data/catalogs`.
`validation-schema/basic.json` is the upstream Basic Catalog reference output
from `conformance/test_data/validation_schema/test_v10_basic_validation_schema.json`.
These files are distributed under the adjacent upstream Apache License. The renderer package excludes the test fixtures.
