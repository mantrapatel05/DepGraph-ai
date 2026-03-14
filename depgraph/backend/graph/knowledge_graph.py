import networkx as nx
import json
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from backend.parsers.dispatcher import flatten_tree, parse_file, build_node_index
from backend.graph.llm_resolver import batch_annotate_nodes, resolve_boundary_edges
from backend.graph.boundary import detect_boundary_nodes, create_boundary_pairs


def build_knowledge_graph(
    all_file_nodes: list,
    structural_graph: nx.DiGraph,
    semantic_edges: list[dict]
) -> nx.DiGraph:
    """
    Merge the structural (AST) graph with LLM-resolved semantic edges
    into a unified knowledge graph.
    """
    G = structural_graph.copy()

    def get_domain(lang):
        if lang == 'sql': return 'Database'
        if lang == 'python': return 'Backend'
        if lang in ('typescript', 'react', 'javascript'): return 'Frontend'
        return 'Unknown'

    # Add/update node metadata with LLM summaries
    for node in flatten_tree(all_file_nodes):
        node_domain = get_domain(node.language)
        # Exclude keys that are already set as explicit kwargs to avoid
        # "got multiple values for keyword argument" TypeError
        _EXCLUDE = {'file', 'name', 'type', 'language', 'domain',
                    'line_start', 'line_end', 'summary'}
        meta = {k: v for k, v in node.metadata.items() if k not in _EXCLUDE}
        if node.id in G.nodes:
            G.nodes[node.id].update({
                "summary": node.summary,
                "domain": node_domain,
                **meta,
            })
        else:
            G.add_node(node.id,
                       name=node.name,
                       type=node.type,
                       language=node.language,
                       domain=node_domain,
                       file=node.file,
                       line_start=node.line_start,
                       line_end=node.line_end,
                       summary=node.summary,
                       **meta)

    # Build a lookup: last ID component → node_id  (for fuzzy LLM matching)
    _suffix_index: dict[str, str] = {}
    _name_index: dict[str, str] = {}
    for nid, ndata in G.nodes(data=True):
        # key by everything after the last "::" separator
        suffix = nid.split("::")[-1].lower()
        _suffix_index.setdefault(suffix, nid)
        name = ndata.get("name", "").lower()
        if name:
            _name_index.setdefault(name, nid)

    def _resolve_node_id(raw_id: str) -> str | None:
        """Resolve an LLM-returned node ID to an actual graph node ID."""
        if not raw_id:
            return None
        if raw_id in G:
            return raw_id
        # Try suffix match  (LLM often shortens absolute paths)
        suffix = raw_id.split("::")[-1].lower()
        if suffix in _suffix_index:
            return _suffix_index[suffix]
        # Try name match
        if raw_id.lower() in _name_index:
            return _name_index[raw_id.lower()]
        return None

    # Add semantic edges from LLM
    added = 0
    for edge in semantic_edges:
        src = _resolve_node_id(edge.get("source_node_id", ""))
        tgt = _resolve_node_id(edge.get("target_node_id", ""))
        if src and tgt and src != tgt:
            conf = edge.get("confidence", 0)
            if conf >= 0.4:  # slightly lower threshold to keep more LLM edges
                G.add_edge(src, tgt,
                           type=edge.get("relationship", "FLOWS_TO"),
                           confidence=conf,
                           inferred_by="llm",
                           transformation=edge.get("transformation", ""),
                           data_fields=edge.get("data_fields", []),
                           break_risk=edge.get("break_risk", "none"),
                           break_reason=edge.get("break_reason", ""))
                added += 1
    print(f"  LLM edges added: {added} / {len(semantic_edges)} candidates")

    return G


class _SafeEncoder(json.JSONEncoder):
    """Converts non-JSON-serializable types to their closest JSON equivalent."""
    def default(self, obj):
        if isinstance(obj, set):
            return list(obj)
        if hasattr(obj, '__dict__'):
            return str(obj)
        try:
            return super().default(obj)
        except TypeError:
            return str(obj)


def save_graph(G: nx.DiGraph, path: str = "depgraph_knowledge.json"):
    """Serialize the knowledge graph to JSON."""
    data = nx.node_link_data(G)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, cls=_SafeEncoder)
    print(f"  Graph saved to {path} ({G.number_of_nodes()} nodes, {G.number_of_edges()} edges)")


def load_graph(path: str = "depgraph_knowledge.json") -> nx.DiGraph:
    """Load a knowledge graph from JSON (handles both NetworkX 2.x 'links' and 3.x 'edges' formats)."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    # NetworkX 3.2+ uses 'edges' key; older saves use 'links' — normalise
    if "links" in data and "edges" not in data:
        data["edges"] = data.pop("links")
    return nx.node_link_graph(data, edges="edges")


async def update_graph_for_changed_file(
    G: nx.DiGraph,
    changed_filepath: str,
    all_file_nodes: list
) -> nx.DiGraph:
    """
    Incremental re-analysis: only re-parse the changed file.
    Removes old nodes, re-parses and re-annotates, re-resolves boundary pairs.
    This function is async because the LLM annotation/resolution calls are async.
    """
    # Remove nodes belonging to changed file
    to_remove = [n for n, d in G.nodes(data=True) if d.get("file") == changed_filepath]
    G.remove_nodes_from(to_remove)

    new_file_node = parse_file(changed_filepath)
    if not new_file_node:
        return G

    node_index = build_node_index(all_file_nodes)

    # Annotate new boundary nodes (async)
    new_boundary = detect_boundary_nodes([new_file_node])
    await batch_annotate_nodes(new_boundary, node_index)

    new_pairs = create_boundary_pairs(
        detect_boundary_nodes([new_file_node] + all_file_nodes)
    )
    new_edges = await resolve_boundary_edges(new_pairs, node_index)

    def get_domain(lang):
        if lang == 'sql': return 'Database'
        if lang == 'python': return 'Backend'
        if lang in ('typescript', 'react', 'javascript'): return 'Frontend'
        return 'Unknown'

    for node in flatten_tree([new_file_node]):
        G.add_node(node.id,
                   name=node.name, type=node.type,
                   language=node.language, domain=get_domain(node.language),
                   file=node.file,
                   summary=node.summary, **node.metadata)
    for edge in new_edges:
        src = edge.get("source_node_id")
        tgt = edge.get("target_node_id")
        if src and tgt and src in G and tgt in G:
            G.add_edge(src, tgt, **edge)

    return G
