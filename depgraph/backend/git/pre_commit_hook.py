import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from backend.graph.knowledge_graph import load_graph
from backend.git.diff_reader import get_changed_node_ids
from backend.query.engine import get_impact

GRAPH_PATH = os.environ.get("DEPGRAPH_GRAPH", "depgraph_knowledge.json")
REPO_PATH = os.environ.get("DEPGRAPH_REPO", ".")


def main():
    if not os.path.exists(GRAPH_PATH):
        # No graph built yet — skip silently
        sys.exit(0)

    try:
        G = load_graph(GRAPH_PATH)
    except Exception as e:
        print(f"DepGraph.ai: warning — could not load graph: {e}")
        sys.exit(0)

    changed_nodes = get_changed_node_ids(G, REPO_PATH, mode="staged")

    breaks = []
    for node in changed_nodes:
        node_id = node["node_id"]
        if node_id not in G:
            continue
        impact = get_impact(G, node_id)
        high_risk = [
            c for c in impact.get("chain", [])
            if c.get("max_break_risk") in ("high", "medium")
        ]
        if high_risk:
            breaks.append({"changed": node, "affected": high_risk})

    if breaks:
        print("\n⚠  DepGraph.ai: cross-language breaks detected\n")
        for b in breaks:
            print(f"  Changing: {b['changed']['name']} in {b['changed']['file']}")
            for a in b['affected'][:3]:
                lang = a['node'].get('language', '?')
                name = a['node'].get('name', '?')
                file_ = a['node'].get('file', '?')
                line = a['node'].get('line_start', '?')
                print(f"    -> BREAKS [{lang}]: {name} in {file_}:{line}")
        print(f"\n  Run: python -m backend.query.engine explain <node_id>")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
