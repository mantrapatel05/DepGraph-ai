"""
Neo4j Knowledge Graph writer — uses the official neo4j driver directly.
Falls back gracefully to no-op if NEO4J_URI is not set.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from dotenv import load_dotenv
load_dotenv()


def _neo4j_configured() -> bool:
    return bool(os.getenv("NEO4J_URI", "").strip())


class KnowledgeGraphWriter:
    """
    Writes the knowledge graph to Neo4j Aura using the raw neo4j driver.
    All methods are safe no-ops when NEO4J_URI is not configured.
    """

    def __init__(self):
        self.driver = None
        self.db = os.getenv("NEO4J_DATABASE", "neo4j")
        self.enabled = _neo4j_configured()
        if self.enabled:
            try:
                from neo4j import GraphDatabase
                self.driver = GraphDatabase.driver(
                    os.getenv("NEO4J_URI"),
                    auth=(os.getenv("NEO4J_USERNAME", "neo4j"),
                          os.getenv("NEO4J_PASSWORD", "")),
                )
                # Quick connectivity check
                with self.driver.session(database=self.db) as s:
                    s.run("RETURN 1")
                print("  [Neo4j] Connected to Aura instance.")
            except Exception as e:
                print(f"  [Neo4j WARN] Could not connect: {e} — NetworkX-only mode")
                self.enabled = False
                self.driver = None

    def _run(self, cypher: str, params: dict = None):
        """Run a single Cypher query, ignore errors."""
        if not self.enabled or not self.driver:
            return
        try:
            with self.driver.session(database=self.db) as s:
                s.run(cypher, params or {})
        except Exception as e:
            print(f"  [Neo4j WARN] Query failed: {e}")

    # ──────────────────────────────────────────────────────────────
    # Write helpers
    # ──────────────────────────────────────────────────────────────

    def clear_graph(self):
        if not self.enabled:
            return
        self._run("MATCH (n) DETACH DELETE n")
        print("  [Neo4j] Graph cleared.")

    def write_nodes(self, nodes_meta: list[dict]):
        """Batch-write all nodes in a single UNWIND query."""
        if not self.enabled or not nodes_meta:
            return
        try:
            with self.driver.session(database=self.db) as s:
                s.run("""
                    UNWIND $nodes AS node
                    MERGE (n:CodeNode {id: node.id})
                    SET n.name       = node.name,
                        n.language   = node.language,
                        n.layer      = node.layer,
                        n.node_type  = node.node_type,
                        n.file       = node.file,
                        n.line_start = node.line_start
                """, nodes=nodes_meta)
            print(f"  [Neo4j] Wrote {len(nodes_meta)} nodes.")
        except Exception as e:
            print(f"  [Neo4j WARN] write_nodes failed: {e}")

    def write_edges(self, edges_meta: list[dict]):
        """Batch-write all edges in a single UNWIND query."""
        if not self.enabled or not edges_meta:
            return
        try:
            with self.driver.session(database=self.db) as s:
                s.run("""
                    UNWIND $edges AS edge
                    MATCH (src:CodeNode {id: edge.src})
                    MATCH (tgt:CodeNode {id: edge.tgt})
                    CALL apoc.merge.relationship(src, edge.type, {}, {
                        confidence:  edge.confidence,
                        inferred_by: edge.inferred_by,
                        break_risk:  edge.break_risk
                    }, tgt) YIELD rel
                    RETURN rel
                """, edges=edges_meta)
            print(f"  [Neo4j] Wrote {len(edges_meta)} edges.")
        except Exception:
            # APOC not available — fall back to individual MERGE
            try:
                with self.driver.session(database=self.db) as s:
                    for e in edges_meta:
                        rel_type = e.get("type", "FLOWS_TO").replace(" ", "_")
                        s.run(f"""
                            MATCH (src:CodeNode {{id: $src}})
                            MATCH (tgt:CodeNode {{id: $tgt}})
                            MERGE (src)-[r:{rel_type}]->(tgt)
                            SET r.confidence  = $confidence,
                                r.inferred_by = $inferred_by,
                                r.break_risk  = $break_risk
                        """, src=e["src"], tgt=e["tgt"],
                             confidence=e.get("confidence", 0.5),
                             inferred_by=e.get("inferred_by", "ast"),
                             break_risk=e.get("break_risk", "none"))
                print(f"  [Neo4j] Wrote {len(edges_meta)} edges (fallback mode).")
            except Exception as e2:
                print(f"  [Neo4j WARN] write_edges fallback failed: {e2}")

    def add_cross_language_edges(self):
        """
        Deterministic Cypher rules for cross-language variable chains.
        Works on language property rather than specialised labels.
        """
        if not self.enabled:
            return
        rules = [
            # SQL column → Python variable/field (same name)
            ("""
                MATCH (col:CodeNode {language: 'sql'}),
                      (field:CodeNode {language: 'python'})
                WHERE col.name = field.name
                  AND col.node_type IN ['column', 'table']
                MERGE (col)-[r:MAPS_TO]->(field)
                SET r.confidence = 1.0, r.inferred_by = 'ast',
                    r.break_risk = 'high'
            """, "SQL→Python MAPS_TO"),

            # Python variable → JS/TS prop (snake_case → camelCase)
            ("""
                MATCH (py:CodeNode {language: 'python'}),
                      (js:CodeNode)
                WHERE js.language IN ['typescript', 'javascript', 'react']
                  AND py.node_type IN ['variable', 'column']
                  AND js.node_type IN ['variable', 'property']
                  AND js.name = toLower(left(py.name,1)) +
                      reduce(s='', word IN split(py.name,'_')[1..] |
                          s + toUpper(left(word,1)) + substring(word,1))
                MERGE (py)-[r:SERIALIZES_TO]->(js)
                SET r.confidence = 0.9, r.inferred_by = 'naming_convention',
                    r.break_risk = 'high'
            """, "Python→JS snake_to_camel SERIALIZES_TO"),
        ]
        for cypher, label in rules:
            try:
                with self.driver.session(database=self.db) as s:
                    s.run(cypher)
                print(f"  [Neo4j] Rule applied: {label}")
            except Exception as e:
                print(f"  [Neo4j WARN] Rule '{label}' failed: {e}")

    def get_node_count(self) -> int:
        if not self.enabled:
            return 0
        try:
            with self.driver.session(database=self.db) as s:
                return s.run("MATCH (n) RETURN count(n) as c").single()["c"]
        except Exception:
            return 0

    def close(self):
        if self.driver:
            self.driver.close()
