import re
import sys
import os
import networkx as nx
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from backend.parsers.dispatcher import build_node_index, flatten_tree


def snake_to_camel(name: str) -> str:
    """Convert snake_case to camelCase."""
    parts = name.split('_')
    return parts[0] + ''.join(p.capitalize() for p in parts[1:])


def naming_confidence(name_a: str, name_b: str) -> float:
    """
    Compute Jaccard similarity between two identifiers after
    case-normalizing tokenization. Returns 0.85–0.95 range.
    """
    def tokenize(name: str) -> set:
        # Split on underscores and camelCase boundaries
        s1 = re.sub(r'([A-Z])', r'_\1', name)
        return set(t.lower() for t in re.split(r'[_\s]+', s1) if len(t) > 1)

    tokens_a = tokenize(name_a)
    tokens_b = tokenize(name_b)
    union = tokens_a | tokens_b
    if not union:
        return 0.0
    jaccard = len(tokens_a & tokens_b) / len(union)
    return round(0.85 + (jaccard * 0.10), 3)


def find_by_name(name: str, index: dict, languages: list) -> str | None:
    """Find first node ID with a given name in the specified languages."""
    for nid, node in index.items():
        if node.name == name and node.language in languages:
            return nid
    return None


def extract_structural_edges(all_file_nodes: list, G: nx.DiGraph):
    """
    Extract all edges detectable with rule-based pattern matching.
    These edges never go to the LLM. Confidence = 1.0 for AST-proven,
    0.85-0.95 for naming convention matches.
    """
    node_index = build_node_index(all_file_nodes)

    for node in node_index.values():

        # ──────────────────────────────────────────────────────────
        # RULE 1: SQLAlchemy ORM mapping (confidence = 1.0)
        # Column("user_email", String) or attribute named user_email with Column(
        # ──────────────────────────────────────────────────────────
        if node.language == "python" and node.type == "variable":
            src = node.source_lines

            # Check for Column() usage
            if "Column(" not in src:
                # Also check Pydantic single-line field: `user_email: str`
                # These get a naming match below, not an ORM_MAP
                pass
            else:
                # Explicit column name: Column("user_email", String)
                explicit = re.search(r'Column\(["\'](\w+)["\']', src)
                if explicit:
                    col_name = explicit.group(1)
                else:
                    # Implicit: attribute name IS the column name
                    col_name = node.name

                found_orm = False
                for cid, candidate in node_index.items():
                    if (candidate.language == "sql"
                            and candidate.type == "column"
                            and candidate.name == col_name):
                        if G.has_node(cid) and G.has_node(node.id):
                            G.add_edge(cid, node.id,
                                       type="ORM_MAP",
                                       confidence=1.0,
                                       inferred_by="ast",
                                       transformation="direct",
                                       break_risk="high",
                                       break_reason="SQLAlchemy Column name mismatch → silent None on all queries")
                            found_orm = True
                if found_orm:
                    print(f"  [DEBUG] Linked ORM column: {col_name}")

        # ──────────────────────────────────────────────────────────
        # RULE 2: Naming convention map (snake_case → camelCase)
        # Confidence = Jaccard similarity 0.85–0.95
        # ──────────────────────────────────────────────────────────
        if node.language in ("python", "sql") and node.type in ("variable", "column"):
            camel = snake_to_camel(node.name)
            if camel != node.name:  # Only apply where conversion actually changes name
                conf = naming_confidence(node.name, camel)
                found_conv = False
                for cid, candidate in node_index.items():
                    if (candidate.language in ("typescript", "react")
                            and candidate.name == camel
                            and candidate.type == "variable"):
                        if G.has_node(node.id) and G.has_node(cid):
                            G.add_edge(node.id, cid,
                                       type="CONVENTION_MAP",
                                       confidence=conf,
                                       inferred_by="naming",
                                       transformation="snake_to_camel",
                                       break_risk="medium",
                                       break_reason="Convention match: rename breaks camelCase TS consumer")
                            found_conv = True
                if found_conv:
                    print(f"  [DEBUG] Convention map: {node.name} -> {camel}")

        # ──────────────────────────────────────────────────────────
        # RULE 3: TypeScript/JS import tracking (confidence = 1.0)
        # import { X } from "..."  → find X in typescript nodes
        # ──────────────────────────────────────────────────────────
        if node.language in ("typescript", "react", "javascript"):
            imports = re.findall(
                r"import\s+\{([^}]+)\}\s+from\s+['\"]([^'\"]+)['\"]",
                node.source_lines
            )
            for symbols, module_path in imports:
                for sym in [s.strip() for s in symbols.split(",")]:
                    sym = sym.strip()
                    if not sym:
                        continue
                    target_id = find_by_name(sym, node_index, ["typescript", "react", "javascript"])
                    if target_id and G.has_node(node.id) and G.has_node(target_id):
                        G.add_edge(node.id, target_id,
                                   type="IMPORTS",
                                   confidence=1.0,
                                   inferred_by="ast",
                                   transformation="none",
                                   break_risk="low",
                                   break_reason="Import reference: rename breaks this import")

        # ──────────────────────────────────────────────────────────
        # RULE 4: Python import tracking (confidence = 1.0)
        # from module import X  →  find X in python nodes
        # Also tracks class inheritance: class Child(Parent)
        # ──────────────────────────────────────────────────────────
        if node.language == "python":
            # from X import Y, Z
            py_imports = re.findall(
                r'from\s+[\w.]+\s+import\s+([\w,\s]+)',
                node.source_lines
            )
            for import_group in py_imports:
                for sym in import_group.split(','):
                    sym = sym.strip()
                    if not sym or sym == '*':
                        continue
                    target_id = find_by_name(sym, node_index, ["python"])
                    if target_id and node.id != target_id and G.has_node(node.id) and G.has_node(target_id):
                        G.add_edge(node.id, target_id,
                                   type="IMPORTS",
                                   confidence=1.0,
                                   inferred_by="ast",
                                   transformation="none",
                                   break_risk="low",
                                   break_reason="Python import: rename breaks this import")

            # class Child(Parent) → inheritance edge
            bases = re.findall(r'class\s+\w+\(([^)]+)\)', node.source_lines)
            for base_group in bases:
                for base in base_group.split(','):
                    base = base.strip().split('[')[0]  # strip generics
                    if not base or base in ('object', 'ABC', 'BaseModel', 'Enum'):
                        continue
                    target_id = find_by_name(base, node_index, ["python"])
                    if target_id and node.id != target_id and G.has_node(node.id) and G.has_node(target_id):
                        G.add_edge(node.id, target_id,
                                   type="INHERITS",
                                   confidence=1.0,
                                   inferred_by="ast",
                                   transformation="none",
                                   break_risk="medium",
                                   break_reason="Inheritance: rename breaks subclass")
