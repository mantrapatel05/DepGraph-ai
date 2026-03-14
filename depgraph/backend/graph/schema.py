"""
Knowledge Graph Schema + LLMGraphTransformer builder.

Uses langchain-openai pointed at Featherless (OpenAI-compatible) so we stay
within the existing API key — no Anthropic key needed.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from dotenv import load_dotenv
load_dotenv()

# ---------------------------------------------------------------------------
# Node / Relationship vocabulary
# ---------------------------------------------------------------------------

ALLOWED_NODES = [
    "SQLTable",
    "SQLColumn",
    "PythonClass",
    "PythonFunction",
    "PythonField",
    "TypeScriptInterface",
    "TypeScriptProp",
    "ReactComponent",
    "ReactProp",
    "APIRoute",
    "ORMModel",
    "Serializer",
]

ALLOWED_RELATIONSHIPS = [
    # Cross-language (THE KEY ONES)
    "MAPS_TO",           # SQL column  → Python ORM field
    "SERIALIZES_TO",     # Python field → TS interface prop (via serializer)
    "EXPOSES_AS",        # Python route → TS fetch call
    "RENDERS",           # TS prop     → React component prop
    "FLOWS_TO",          # generic cross-language data flow
    "TRANSFORMS",        # with camelCase / snake_case transformation
    "BREAKS_IF_RENAMED", # highest severity
    # Intra-language
    "HAS_COLUMN",
    "HAS_FIELD",
    "HAS_PROP",
    "DEFINED_IN",
    "CALLS",
    "IMPLEMENTS",
    "IMPORTS",
]

NODE_PROPERTIES = [
    "name",
    "qualified_name",
    "language",
    "layer",
    "file",
    "line_start",
    "is_boundary",
    "confidence",
    "description",
]

RELATIONSHIP_PROPERTIES = [
    "confidence",
    "transformation_type",     # "snake_to_camel", "direct", "alias"
    "transformation_example",  # "user_email → userEmail"
    "inferred_by",             # "ast", "naming_convention", "llm"
    "break_risk",              # "CRITICAL", "HIGH", "MEDIUM", "LOW"
]

CUSTOM_EXTRACTION_PROMPT = """
You are a code analysis expert extracting a knowledge graph from source code entities.

Your task: Given a code entity description, extract nodes and relationships per the schema.

CRITICAL RULES:
1. For EVERY SQLColumn, look for a PythonField with the same snake_case name → MAPS_TO with confidence=1.0, inferred_by="ast"
2. For EVERY PythonField in a Serializer/Pydantic model, look for a TypeScriptProp with the camelCase equivalent → SERIALIZES_TO, transformation_type="snake_to_camel"
3. For EVERY TypeScriptProp, look for a ReactProp in component files → RENDERS relationship
4. If snake_case maps to camelCase, add: transformation_example="field_name → fieldName"
5. Mark any relationship that breaks on rename: break_risk="CRITICAL"
6. Always include: language, layer, file, is_boundary on every node
7. layer must be exactly one of: "database", "backend", "frontend"

Focus on cross-language MAPS_TO, SERIALIZES_TO, FLOWS_TO relationships — these are the most valuable.
"""


def build_llm_graph_transformer():
    """
    Build a LLMGraphTransformer using Featherless AI (OpenAI-compatible).
    Returns None gracefully if langchain-experimental is not installed.
    """
    try:
        from langchain_openai import ChatOpenAI
        from langchain_experimental.graph_transformers import LLMGraphTransformer

        llm = ChatOpenAI(
            base_url=os.getenv("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"),
            api_key=os.getenv("FEATHERLESS_API_KEY", ""),
            model=os.getenv("FEATHERLESS_MODEL", "zai-org/GLM-4.7-Flash"),
            temperature=0,
            max_tokens=4096,
        )

        transformer = LLMGraphTransformer(
            llm=llm,
            allowed_nodes=ALLOWED_NODES,
            allowed_relationships=ALLOWED_RELATIONSHIPS,
            node_properties=NODE_PROPERTIES,
            relationship_properties=RELATIONSHIP_PROPERTIES,
            strict_mode=False,   # allow fallback to prompt extraction if no fn-calling
        )
        return transformer
    except ImportError as e:
        print(f"  [WARN] langchain-experimental not available: {e}")
        return None
    except Exception as e:
        print(f"  [WARN] Could not build LLMGraphTransformer: {e}")
        return None
