"""
Post-analysis detection utilities.
These run after the main graph is built and find higher-level patterns.
"""
import re
import networkx as nx
from backend.parsers.dispatcher import flatten_tree


LANG_TO_LAYER = {
    "sql": "database",
    "python": "backend",
    "typescript": "frontend",
    "react": "frontend",
    "javascript": "frontend",
}


def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def detect_variable_chains(G: nx.DiGraph, all_file_nodes: list) -> list:
    """
    Find cross-language variable chains: DB → Backend → Frontend.
    Uses graph edges first (MAPS_TO / SERIALIZES_TO / RENDERS),
    then falls back to name-matching heuristic.
    Returns up to 50 chain dicts.
    """
    chains: list[dict] = []
    seen: set[str] = set()

    # ── 1. Walk existing typed edges ──────────────────────────────
    CHAIN_EDGE_TYPES = {"MAPS_TO", "SERIALIZES_TO", "RENDERS", "FLOWS_TO", "IMPORTS"}
    edge_chains: dict[str, dict] = {}

    for src, tgt, edata in G.edges(data=True):
        if edata.get("type") not in CHAIN_EDGE_TYPES:
            continue
        src_data = G.nodes[src]
        tgt_data = G.nodes[tgt]
        chain_key = src_data.get("name", src)
        if chain_key not in edge_chains:
            edge_chains[chain_key] = {
                "name": chain_key,
                "steps": [{
                    "layer": LANG_TO_LAYER.get(src_data.get("language", ""), "backend"),
                    "node_id": src,
                    "name": src_data.get("name", src),
                    "file": src_data.get("file", ""),
                    "type": src_data.get("type", ""),
                    "line_start": src_data.get("line_start", 0),
                }],
            }
        edge_chains[chain_key]["steps"].append({
            "layer": LANG_TO_LAYER.get(tgt_data.get("language", ""), "frontend"),
            "node_id": tgt,
            "name": tgt_data.get("name", tgt),
            "file": tgt_data.get("file", ""),
            "type": tgt_data.get("type", ""),
            "line_start": tgt_data.get("line_start", 0),
            "relationship": edata.get("type", ""),
            "transformation": edata.get("transformation", ""),
        })

    for chain in edge_chains.values():
        layers = {s["layer"] for s in chain["steps"]}
        if len(layers) > 1:
            chains.append(chain)
            seen.add(chain["name"].lower())

    # ── 2. Name-match heuristic for SQL-less repos ─────────────────
    # Match Python snake_case vars → JS camelCase vars
    py_nodes = [
        (nid, data) for nid, data in G.nodes(data=True)
        if data.get("language") == "python"
        and data.get("type") in ("variable", "function", "class")
    ]
    js_by_name: dict[str, tuple] = {
        data.get("name", "").lower(): (nid, data)
        for nid, data in G.nodes(data=True)
        if data.get("language") in ("typescript", "javascript", "react")
    }

    for py_id, py_data in py_nodes:
        py_name = py_data.get("name", "")
        if not py_name or py_name.lower() in seen:
            continue
        camel = _snake_to_camel(py_name)
        if camel == py_name:
            continue  # no conversion happened
        js_match = js_by_name.get(camel.lower())
        if not js_match:
            continue
        js_id, js_data = js_match
        chain = {
            "name": py_name,
            "steps": [
                {
                    "layer": "backend",
                    "node_id": py_id,
                    "name": py_name,
                    "file": py_data.get("file", ""),
                    "type": py_data.get("type", ""),
                    "line_start": py_data.get("line_start", 0),
                },
                {
                    "layer": "frontend",
                    "node_id": js_id,
                    "name": js_data.get("name", ""),
                    "file": js_data.get("file", ""),
                    "type": js_data.get("type", ""),
                    "line_start": js_data.get("line_start", 0),
                    "relationship": "SERIALIZES_TO",
                    "transformation": "snake_to_camel",
                },
            ],
        }
        chains.append(chain)
        seen.add(py_name.lower())

    chains.sort(key=lambda c: len(c["steps"]), reverse=True)
    return chains[:50]


def detect_api_routes(G: nx.DiGraph) -> list:
    """
    Find Python API route functions and their downstream JS consumers.
    """
    routes = []
    ROUTE_PATTERNS = re.compile(
        r'@(app|router)\.(get|post|put|delete|patch)\(|response_model\s*=|HTTPException',
        re.IGNORECASE
    )

    for nid, data in G.nodes(data=True):
        if data.get("language") != "python":
            continue
        if data.get("type") not in ("function", "method", "class"):
            continue

        summary = data.get("summary", "")
        is_route = bool(ROUTE_PATTERNS.search(summary)) or any(
            kw in summary.lower()
            for kw in ("route", "endpoint", "api", "get ", "post ", "put ", "delete ")
        )
        if not is_route:
            continue

        # Find downstream JS/TS consumers (direct neighbours only, no full BFS)
        js_consumers = [
            {"id": tgt, "name": G.nodes[tgt].get("name", ""),
             "file": G.nodes[tgt].get("file", "")}
            for tgt in G.successors(nid)
            if G.nodes[tgt].get("language") in ("typescript", "javascript", "react")
        ][:5]

        routes.append({
            "node_id": nid,
            "name": data.get("name", ""),
            "file": data.get("file", ""),
            "line_start": data.get("line_start", 0),
            "summary": summary,
            "data_in": data.get("data_in", []),
            "data_out": data.get("data_out", []),
            "response_types": js_consumers,
            "sensitivity": data.get("sensitivity", "none"),
        })

    return routes
