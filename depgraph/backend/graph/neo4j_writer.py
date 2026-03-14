"""
Neo4j Knowledge Graph writer — uses the official neo4j driver directly.
Falls back gracefully to no-op if NEO4J_URI is not set.
"""
import io
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from dotenv import load_dotenv
load_dotenv()

# Ensure stdout can handle unicode (runs in worker threads on Windows)
if hasattr(sys.stdout, 'buffer') and getattr(sys.stdout, 'encoding', 'utf-8').lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')


def _p(msg: str) -> None:
    """Print safely — replaces any unencodable character instead of crashing."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode('utf-8', errors='replace').decode('ascii', errors='replace'), flush=True)


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
                _p("  [Neo4j] Connected to Aura instance.")
            except Exception as e:
                _p(f"  [Neo4j WARN] Could not connect: {e} - NetworkX-only mode")
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
            _p(f"  [Neo4j WARN] Query failed: {e}")

    # ──────────────────────────────────────────────────────────────
    # Write helpers
    # ──────────────────────────────────────────────────────────────

    def clear_graph(self):
        if not self.enabled:
            return
        self._run("MATCH (n) DETACH DELETE n")
        _p("  [Neo4j] Graph cleared.")

    def write_nodes(self, nodes_meta: list[dict]):
        """Batch-write nodes in chunks to avoid Aura free-tier timeouts."""
        if not self.enabled or not nodes_meta:
            return
        CHUNK = 50
        total = 0
        for i in range(0, len(nodes_meta), CHUNK):
            chunk = nodes_meta[i:i + CHUNK]
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
                    """, nodes=chunk)
                total += len(chunk)
            except Exception as e:
                _p(f"  [Neo4j WARN] write_nodes chunk {i} failed: {e}")
        _p(f"  [Neo4j] Wrote {total} nodes.")

    def write_edges(self, edges_meta: list[dict]):
        """Write edges one by one using MERGE (APOC not required)."""
        if not self.enabled or not edges_meta:
            return
        written = 0
        try:
            with self.driver.session(database=self.db) as s:
                for e in edges_meta:
                    rel_type = e.get("type", "FLOWS_TO").replace(" ", "_").replace("-", "_")
                    try:
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
                        written += 1
                    except Exception as ee:
                        _p(f"  [Neo4j WARN] edge {e.get('src')} -> {e.get('tgt')}: {ee}")
            _p(f"  [Neo4j] Wrote {written} edges.")
        except Exception as e2:
            _p(f"  [Neo4j WARN] write_edges failed: {e2}")

    def add_cross_language_edges(self):
        """
        Deterministic Cypher rules for cross-language variable chains.
        Works on language property rather than specialised labels.
        """
        if not self.enabled:
            return
        rules = [
            # SQL column -> Python variable/field (same name)
            ("""
                MATCH (col:CodeNode {language: 'sql'}),
                      (field:CodeNode {language: 'python'})
                WHERE col.name = field.name
                  AND col.node_type IN ['column', 'table']
                MERGE (col)-[r:MAPS_TO]->(field)
                SET r.confidence = 1.0, r.inferred_by = 'ast',
                    r.break_risk = 'high'
            """, "SQL->Python MAPS_TO"),

            # Python variable -> JS/TS prop (snake_case -> camelCase)
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
            """, "Python->JS snake_to_camel SERIALIZES_TO"),
        ]
        for cypher, label in rules:
            try:
                with self.driver.session(database=self.db) as s:
                    s.run(cypher)
                _p(f"  [Neo4j] Rule applied: {label}")
            except Exception as e:
                _p(f"  [Neo4j WARN] Rule '{label}' failed: {e}")

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
