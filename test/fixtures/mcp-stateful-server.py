"""Python MCP peer for the A2UI stateful negotiation example."""

import asyncio
import json

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server


CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"
SURFACE_ID = "mcp_stateful"
server = Server("proyeccion-stateful-example")


def resource(envelope):
    return types.EmbeddedResource(
        type="resource",
        resource=types.TextResourceContents(
            uri="a2ui://stateful-example/panel",
            mimeType="application/a2ui+json",
            text=json.dumps([{"version": "1.0", **envelope}]),
        ),
    )


@server.list_tools()
async def list_tools():
    return [
        types.Tool(name="open_panel", inputSchema={"type": "object"}),
        types.Tool(name="a2ui_action", inputSchema={"type": "object"}),
    ]


@server.call_tool()
async def call_tool(name, arguments):
    capabilities = server.request_context.session.client_params.capabilities.model_extra
    renderer = capabilities.get("a2ui", {}).get("rendererCapabilities", {}).get("1.0", {})
    if CATALOG_ID not in renderer.get("supportedCatalogIds", []):
        return [types.TextContent(type="text", text="This session cannot display the panel.")]

    if name == "open_panel":
        return [resource({"createSurface": {
            "surfaceId": SURFACE_ID,
            "catalogId": CATALOG_ID,
            "sendDataModel": True,
            "dataModel": {"status": "Panel ready", "revision": 1},
            "components": [
                {"id": "root", "component": "Column", "children": ["status", "confirm"]},
                {"id": "status", "component": "Text", "text": {"@path": "/status"}},
                {"id": "confirm", "component": "Button", "child": "label", "action": {
                    "event": {"name": "confirm", "context": {"revision": {"@path": "/revision"}}},
                }},
                {"id": "label", "component": "Text", "text": "Confirm panel"},
            ],
        }})]

    if (arguments.get("surfaceId"), arguments.get("name"), arguments.get("context")) != (
        SURFACE_ID, "confirm", {"revision": 1},
    ):
        raise ValueError("Expected confirmation of the displayed revision")
    return [resource({"updateDataModel": {
        "surfaceId": SURFACE_ID,
        "path": "/",
        "value": {"status": "Confirmed by the MCP server", "revision": 2},
    }})]


async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
