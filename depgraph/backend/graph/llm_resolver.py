"""
LLM Resolver — batched to stay within 3-4 total API calls.

Call structure:
  Call 1 : Annotate ALL boundary nodes in one prompt   (annotation_batch)
  Call 2+: Resolve ALL boundary pairs in ≤2 prompts   (resolution_batch)

This avoids the previous pattern of 1 call per node + 1 call per pair which
triggered Featherless concurrency-limit errors on plans with limited units.
"""
import asyncio
import json
import hashlib
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))

from openai import AsyncOpenAI
from dotenv import load_dotenv
from backend.core.models import CodeNode

load_dotenv()

async_client = AsyncOpenAI(
    base_url=os.getenv("FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"),
    api_key=os.getenv("FEATHERLESS_API_KEY", "")
)
MODEL = os.getenv("FEATHERLESS_MODEL", "zai-org/GLM-4.7")

# Cache keyed by content-hash — only re-call LLM when code changes
_annotation_cache: dict[str, dict] = {}

# One in-flight request at a time for Featherless rate limits
_sem = asyncio.Semaphore(1)


# ─────────────────────────────────────────────────────────────────────────────
# Context window builder  (used to build the per-node snippet inside batches)
# ─────────────────────────────────────────────────────────────────────────────
def build_context_window(node: CodeNode, node_index: dict) -> str:
    parent = node_index.get(node.parent_id)
    siblings = [c for c in parent.children if c.id != node.id] if parent else []
    children_preview = "\n".join(
        f"  - {c.name} ({c.type}): {c.source_lines[:80]}"
        for c in node.children[:8]
    )
    sibling_names = ", ".join(s.name for s in siblings[:6])
    parent_src = (parent.source_lines[:300] if parent else "n/a")

    return (
        f"FILE: {node.file}\n"
        f"LANGUAGE: {node.language}\n"
        f"PARENT SCOPE ({parent.type if parent else 'root'}: {parent.name if parent else 'n/a'}):\n"
        f"{parent_src}\n"
        f"SIBLINGS: {sibling_names}\n"
        f"THIS NODE ({node.type}: {node.name}) lines {node.line_start}-{node.line_end}:\n"
        f"{node.source_lines[:400]}\n"
        f"CHILDREN:\n{children_preview if children_preview else '  (leaf node)'}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Call 1: Batch-annotate all boundary nodes in ONE LLM call
# ─────────────────────────────────────────────────────────────────────────────
async def _call_with_retry(prompt: str, max_tokens: int, context_label: str) -> str:
    """Make one LLM call with exponential-backoff retry on rate-limit errors."""
    async with _sem:
        for attempt in range(5):
            try:
                response = await asyncio.wait_for(
                    async_client.chat.completions.create(
                        model=MODEL,
                        max_tokens=max_tokens,
                        messages=[{"role": "user", "content": prompt}]
                    ),
                    timeout=120.0
                )
                return response.choices[0].message.content.strip()
            except asyncio.TimeoutError:
                print(f"  [LLM] {context_label} timed out (attempt {attempt + 1})")
                if attempt >= 4:
                    return ""
                await asyncio.sleep(2 ** attempt)
            except Exception as e:
                err = str(e)
                if "429" in err or "concurrency" in err.lower() or "rate" in err.lower():
                    wait = 2 ** (attempt + 2)  # 4, 8, 16, 32, 64 s
                    print(f"  [LLM] Rate-limited — waiting {wait}s (attempt {attempt + 1})")
                    await asyncio.sleep(wait)
                    continue
                print(f"  [LLM WARN] {context_label} failed (attempt {attempt + 1}): {e}")
                if attempt >= 4:
                    return ""
        return ""


def _strip_markdown(text: str) -> str:
    """Remove ```json ... ``` fences if present."""
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        # parts[1] is between first pair of fences
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


async def batch_annotate_nodes(boundary_nodes: list, node_index: dict) -> None:
    """
    Annotate ALL boundary nodes in a SINGLE LLM call.
    Results are written directly into each node's .summary and .metadata.
    Nodes whose content hash is already cached are skipped.
    """
    # Split into those already cached vs those that need a call
    to_annotate = []
    for node in boundary_nodes:
        cache_key = hashlib.md5(node.source_lines.encode()).hexdigest()
        if cache_key in _annotation_cache:
            cached = _annotation_cache[cache_key]
            node.summary = cached.get("summary", "")
            node.metadata.update(cached)
        else:
            to_annotate.append((node, cache_key))

    if not to_annotate:
        print("  [LLM] All boundary nodes served from annotation cache")
        return

    # Build one big prompt listing every node
    node_snippets = []
    for idx, (node, _) in enumerate(to_annotate):
        ctx = build_context_window(node, node_index)
        node_snippets.append(
            f"=== NODE {idx} ===\n"
            f"NODE_ID: {node.id}\n"
            f"{ctx}\n"
        )

    prompt = (
        "You are analyzing nodes in a polyglot codebase dependency system.\n\n"
        "For EACH node below, extract a JSON annotation object.\n"
        "Return a single JSON object mapping each NODE_ID to its annotation.\n"
        "Schema per node:\n"
        '{\n'
        '  "summary": "one sentence: what this is and what data it holds or transforms",\n'
        '  "data_in": ["field names this node receives"],\n'
        '  "data_out": ["field names this node exposes"],\n'
        '  "transformations": ["snake_to_camel | null_stripped | type_cast | serialization"],\n'
        '  "sensitivity": "none | low | medium | high | pii",\n'
        '  "boundary_signals": ["patterns indicating cross-language data flow"]\n'
        '}\n\n'
        "Return ONLY valid JSON — no markdown, no explanation:\n"
        '{\n  "<NODE_ID>": { ... }, ...\n}\n\n'
        + "\n---\n".join(node_snippets)
    )

    print(f"  [LLM] Batch-annotating {len(to_annotate)} boundary nodes in 1 call...")
    raw = await _call_with_retry(prompt, max_tokens=min(3000, 200 * len(to_annotate)), context_label="batch_annotate")

    # Parse the JSON response
    annotations: dict = {}
    try:
        annotations = json.loads(_strip_markdown(raw))
    except json.JSONDecodeError:
        # Try to salvage partial JSON
        try:
            # Sometimes the model truncates — try to close the object
            fixed = raw.rsplit(',', 1)[0] + "\n}"
            annotations = json.loads(_strip_markdown(fixed))
        except Exception:
            print("  [LLM WARN] batch_annotate: could not parse JSON response — using defaults")

    default_annotation = {
        "summary": "", "data_in": [], "data_out": [],
        "transformations": [], "sensitivity": "none", "boundary_signals": []
    }

    for node, cache_key in to_annotate:
        # Try exact node ID match, then fallback to a substring search
        result = annotations.get(node.id)
        if result is None:
            # Some models shorten the key; try last component
            short = node.id.split("::")[-1]
            for k, v in annotations.items():
                if k.endswith(short) or short in k:
                    result = v
                    break
        if result is None:
            result = default_annotation.copy()
            result["summary"] = f"{node.type} {node.name} in {node.language}"

        node.summary = result.get("summary", "")
        node.metadata.update(result)
        _annotation_cache[cache_key] = result
        print(f"  [LLM] Annotated: {node.id[:70]}")


# ─────────────────────────────────────────────────────────────────────────────
# Shim kept for backward compatibility with main.py loop
# ─────────────────────────────────────────────────────────────────────────────
async def traverse_and_annotate(node: CodeNode, node_index: dict):
    """
    Single-node annotation shim (called per-node in main.py).
    Uses the shared cache; only makes an LLM call if this node hasn't been
    annotated yet (i.e. when called outside of the batch flow).
    """
    cache_key = hashlib.md5(node.source_lines.encode()).hexdigest()
    if cache_key in _annotation_cache:
        cached = _annotation_cache[cache_key]
        node.summary = cached.get("summary", "")
        node.metadata.update(cached)
        return

    # Not cached — do a single-node call (fallback path)
    ctx = build_context_window(node, node_index)
    prompt = (
        "You are analyzing a node in a polyglot codebase dependency system.\n\n"
        f"{ctx}\n\n"
        "Extract the following as JSON only (no markdown, no preamble):\n"
        "{\n"
        '  "summary": "one sentence",\n'
        '  "data_in": [],\n'
        '  "data_out": [],\n'
        '  "transformations": [],\n'
        '  "sensitivity": "none | low | medium | high | pii",\n'
        '  "boundary_signals": []\n'
        "}"
    )

    result = {
        "summary": f"{node.type} {node.name} in {node.language}",
        "data_in": [], "data_out": [],
        "transformations": [], "sensitivity": "none", "boundary_signals": []
    }

    raw = await _call_with_retry(prompt, max_tokens=400, context_label=f"annotate:{node.id[:50]}")
    if raw:
        try:
            result = json.loads(_strip_markdown(raw))
        except json.JSONDecodeError:
            pass

    node.summary = result.get("summary", "")
    node.metadata.update(result)
    _annotation_cache[cache_key] = result
    print(f"  [LLM] Annotated (single): {node.id[:70]}")


# ─────────────────────────────────────────────────────────────────────────────
# Call 2 (+ optional Call 3): Batch-resolve ALL boundary pairs
# ─────────────────────────────────────────────────────────────────────────────
_PAIRS_PER_BATCH = 15   # max pairs per LLM call; adjust if context window is exceeded


async def resolve_boundary_edges(pairs: list, node_index: dict) -> list[dict]:
    """
    Resolve cross-language edges for ALL pairs using at most ⌈N/PAIRS_PER_BATCH⌉ calls.
    Typically 1-2 calls for the sample project (≤25 pairs after capping in boundary.py).
    """
    if not pairs:
        return []

    all_edges: list[dict] = []

    # Chunk pairs into batches of _PAIRS_PER_BATCH
    for batch_start in range(0, len(pairs), _PAIRS_PER_BATCH):
        batch = pairs[batch_start: batch_start + _PAIRS_PER_BATCH]

        pair_snippets = []
        for idx, pair in enumerate(batch):
            emitter_ctx = build_context_window(pair.emitter, node_index)
            receiver_ctx = build_context_window(pair.receiver, node_index)
            pair_snippets.append(
                f"=== PAIR {idx} ===\n"
                f"EMITTER_ID: {pair.emitter.id}\n"
                f"EMITTER ({pair.emitter_language}):\n{emitter_ctx}\n"
                f"Emitter summary: {pair.emitter.summary}\n"
                f"Data out: {pair.emitter.metadata.get('data_out', [])}\n\n"
                f"RECEIVER_ID: {pair.receiver.id}\n"
                f"RECEIVER ({pair.receiver_language}):\n{receiver_ctx}\n"
                f"Receiver summary: {pair.receiver.summary}\n"
                f"Data in: {pair.receiver.metadata.get('data_in', [])}\n"
            )

        prompt = (
            "You are identifying cross-language data flow in a polyglot codebase.\n\n"
            "For each PAIR below, identify fields flowing from the EMITTER to the RECEIVER.\n"
            "Return a single JSON array containing ALL edges across ALL pairs.\n"
            "Each edge object schema:\n"
            "{\n"
            '  "source_node_id": "exact EMITTER_ID or a child of it",\n'
            '  "target_node_id": "exact RECEIVER_ID or a child of it",\n'
            '  "relationship": "FLOWS_TO | TRANSFORMS | EXPOSES_AS | RENDERS",\n'
            '  "transformation": "snake_to_camel | null_stripped | type_cast | direct",\n'
            '  "confidence": 0.0,\n'
            '  "data_fields": ["field names that travel this edge"],\n'
            '  "break_risk": "none | low | medium | high",\n'
            '  "break_reason": "what breaks if source is renamed"\n'
            "}\n\n"
            "Rules:\n"
            "- Only include edges with confidence >= 0.5\n"
            "- Be conservative: return [] for a pair if nothing clearly flows\n"
            "- Return ONLY the JSON array, no markdown\n\n"
            + "\n---\n".join(pair_snippets)
        )

        batch_label = f"resolve_pairs[{batch_start}:{batch_start + len(batch)}]"
        print(f"  [LLM] Resolving {len(batch)} pairs in 1 call ({batch_label})...")
        raw = await _call_with_retry(
            prompt,
            max_tokens=min(2000, 120 * len(batch)),
            context_label=batch_label
        )

        if raw:
            try:
                edges = json.loads(_strip_markdown(raw))
                if isinstance(edges, list):
                    all_edges.extend(edges)
                    print(f"  [LLM] {batch_label}: {len(edges)} edge(s) found")
                else:
                    print(f"  [LLM WARN] {batch_label}: expected list, got {type(edges)}")
            except json.JSONDecodeError:
                # Try partial salvage
                try:
                    # Close truncated array
                    fixed = raw.rsplit(',', 1)[0] + "\n]"
                    edges = json.loads(_strip_markdown(fixed))
                    if isinstance(edges, list):
                        all_edges.extend(edges)
                        print(f"  [LLM] {batch_label}: {len(edges)} edge(s) (salvaged)")
                except Exception:
                    print(f"  [LLM WARN] {batch_label}: could not parse response — skipping batch")

    return all_edges
