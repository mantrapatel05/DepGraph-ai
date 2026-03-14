import re
import sys
import os
from dataclasses import dataclass
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from backend.core.models import CodeNode
from backend.parsers.dispatcher import flatten_tree


# Regex patterns that signal a node is at a cross-language boundary
BOUNDARY_PATTERNS = {
    "python": [
        r"class\s+\w+\(.*Serializer\)",          # DRF serializer
        r"class\s+\w+\(.*BaseModel\)",            # Pydantic BaseModel
        r"class\s+\w+\(.*Schema\)",               # Marshmallow schema
        r"@app\.(get|post|put|delete|patch)\(",   # FastAPI route
        r"@router\.(get|post|put|delete)\(",      # FastAPI router
        r"response_model\s*=",                    # FastAPI response_model
        r"model_config\s*=\s*ConfigDict",         # Pydantic v2 config
        r"model_config\s*=\s*\{",                # Pydantic v2 dict config
        r"class Meta:\s*model\s*=",              # DRF ModelSerializer Meta
        r"fields\s*=\s*\[",                      # DRF explicit fields list
    ],
    "typescript": [
        r"interface\s+\w+(DTO|Response|Request|Payload|Schema)",
        r"type\s+\w+(DTO|Response|Request)\s*=",
        r"export\s+(interface|type)\s+\w+",
        r"fetch\(|axios\.|useQuery\(|useMutation\(",
        r"z\.object\(",                            # Zod schema
    ],
    "react": [
        r"props\.\w+",
        r"user\.\w+|response\.\w+|data\.\w+",
        r"useSelector|useAppSelector",
        r"\.userEmail|\.user_email|\.fullName|\.full_name",
    ],
    "sql": [],   # All SQL tables/columns are potential boundary emitters
}


@dataclass
class BoundaryPair:
    emitter: CodeNode
    receiver: CodeNode
    emitter_language: str
    receiver_language: str
    signal: str


def detect_boundary_nodes(all_file_nodes: list) -> list:
    """Find all nodes that are at a cross-language boundary."""
    boundary_nodes = []
    seen_ids = set()

    for node in flatten_tree(all_file_nodes):
        if node.id in seen_ids:
            continue

        is_boundary = False

        # Check language-specific patterns
        patterns = BOUNDARY_PATTERNS.get(node.language, [])
        for pattern in patterns:
            if re.search(pattern, node.source_lines, re.MULTILINE | re.DOTALL):
                node.metadata["is_boundary"] = True
                node.metadata["boundary_signal"] = pattern
                is_boundary = True
                break

        # All SQL tables/columns are potential emitters
        if node.language == "sql" and node.type in ("table", "column"):
            node.metadata["is_boundary"] = True
            is_boundary = True

        if is_boundary:
            boundary_nodes.append(node)
            seen_ids.add(node.id)

    print(f"  Boundary Zone Detector: {len(boundary_nodes)} boundary nodes found")
    return boundary_nodes


def _name_similarity(a: str, b: str) -> float:
    """
    Token-level Jaccard similarity between two identifiers after
    splitting on underscores and camelCase boundaries.  Returns 0.0–1.0.
    """
    def tokenize(name: str) -> set:
        s = re.sub(r'([A-Z])', r'_\1', name)
        return set(t.lower() for t in re.split(r'[_\s]+', s) if len(t) > 1)

    ta, tb = tokenize(a), tokenize(b)
    union = ta | tb
    if not union:
        return 0.0
    return len(ta & tb) / len(union)


def create_boundary_pairs(boundary_nodes: list, max_pairs: int = 25) -> list:
    """
    Pair boundary nodes across adjacent language layers.
    Language adjacency: sql → python → typescript → react

    To stay within 3-4 total LLM calls the total number of pairs is capped at
    *max_pairs*.  When capping is needed we keep pairs with the highest
    name-similarity score so the most-likely real connections are preserved.
    """
    lang_order = ["sql", "python", "typescript", "react", "javascript"]

    # Build all candidate pairs, scoring each by name similarity
    scored: list[tuple[float, object]] = []
    for i in range(len(lang_order) - 1):
        emitter_lang = lang_order[i]
        receiver_lang = lang_order[i + 1]
        emitters = [n for n in boundary_nodes if n.language == emitter_lang]
        receivers = [n for n in boundary_nodes if n.language == receiver_lang]
        for e in emitters:
            for r in receivers:
                score = _name_similarity(e.name, r.name)
                pair = BoundaryPair(
                    emitter=e,
                    receiver=r,
                    emitter_language=emitter_lang,
                    receiver_language=receiver_lang,
                    signal=e.metadata.get("boundary_signal", "sql_table")
                )
                scored.append((score, pair))

    # Sort descending by similarity so we keep the best candidates when capping
    scored.sort(key=lambda x: x[0], reverse=True)

    pairs = [pair for _, pair in scored[:max_pairs]]

    total_nodes = len(flatten_tree(boundary_nodes))
    skipped = max(0, len(scored) - len(pairs))
    print(
        f"  Boundary Zone Detector: {len(pairs)} pairs selected "
        f"(from {len(scored)} candidates, {skipped} low-similarity pairs skipped, "
        f"~{total_nodes} total boundary nodes)"
    )
    return pairs
