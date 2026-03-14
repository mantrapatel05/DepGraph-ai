import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from backend.core.models import CodeNode

try:
    import tree_sitter_python as tspython
    from tree_sitter import Language, Parser
    PY_LANGUAGE = Language(tspython.language())
    _TS_AVAILABLE = True
except Exception:
    _TS_AVAILABLE = False


def walk_ast(node):
    yield node
    for child in node.children:
        yield from walk_ast(child)


def get_child_text(node, field_name: str, source: bytes) -> str:
    child = node.child_by_field_name(field_name)
    return source[child.start_byte:child.end_byte].decode('utf-8', errors='replace') if child else ""


def extract_attribute_node(node, parent_id: str, source: bytes, filepath: str):
    """Extract a class attribute (Column(), field, annotated field, etc.) as a CodeNode."""
    src = source[node.start_byte:node.end_byte].decode('utf-8', errors='replace').strip()

    name = None

    # Handle annotated_assignment: `name: type = value` OR `name: type` (Pydantic fields)
    if node.type == "annotated_assignment":
        left = node.child_by_field_name("left")
        if left:
            name = source[left.start_byte:left.end_byte].decode('utf-8', errors='replace').strip()
            # Strip any subscript/complex expression — only keep simple identifiers
            if ':' in name:
                name = name.split(':')[0].strip()
        elif ':' in src:
            # Fallback: take everything before the first colon
            name = src.split(':')[0].strip()

    elif '=' in src and len(src) < 300:
        name = src.split('=')[0].strip()
        # Support `name: Type = ...`
        if ':' in name:
            name = name.split(':')[0].strip()

    if name and name.isidentifier() and not name.startswith('__'):
        return CodeNode(
            id=f"{parent_id}::{name}",
            type="variable",
            language="python",
            name=name,
            source_lines=src,
            file=filepath,
            line_start=node.start_point[0],
            line_end=node.end_point[0],
            parent_id=parent_id
        )
    return None


def parse_python_file(filepath: str) -> CodeNode:
    """Parse a Python file using tree-sitter and return a CodeNode tree."""
    try:
        with open(filepath, 'rb') as f:
            source = f.read()
    except Exception:
        return None

    file_node = CodeNode(
        id=filepath,
        type="file",
        language="python",
        name=os.path.basename(filepath),
        source_lines=source.decode('utf-8', errors='replace'),
        file=filepath,
        line_start=1,
        line_end=source.count(b'\n') + 1
    )

    if not _TS_AVAILABLE:
        # Fallback: basic regex extraction
        _extract_python_regex(file_node, source.decode('utf-8', errors='replace'), filepath)
        return file_node

    parser = Parser(PY_LANGUAGE)
    tree = parser.parse(source)

    for node in walk_ast(tree.root_node):
        if node.type == "class_definition":
            class_name = get_child_text(node, "name", source)
            class_src = source[node.start_byte:node.end_byte].decode('utf-8', errors='replace')
            class_node = CodeNode(
                id=f"{filepath}::{class_name}",
                type="class",
                language="python",
                name=class_name,
                source_lines=class_src,
                file=filepath,
                line_start=node.start_point[0],
                line_end=node.end_point[0],
                parent_id=filepath
            )

            # Only walk the DIRECT class body children — do NOT recurse into methods.
            # This prevents capturing assignments inside method bodies as class fields.
            body = node.child_by_field_name("body")
            if body:
                for child in body.children:
                    if child.type in ("assignment", "expression_statement", "annotated_assignment"):
                        attr = extract_attribute_node(child, class_node.id, source, filepath)
                        if attr:
                            # Avoid duplicate IDs (can happen with property re-use patterns)
                            if not any(c.id == attr.id for c in class_node.children):
                                class_node.children.append(attr)

            file_node.children.append(class_node)

    return file_node


def _extract_python_regex(file_node: CodeNode, source: str, filepath: str):
    """Fallback regex-based Python extraction when tree-sitter unavailable."""
    import re
    lines = source.split('\n')
    current_class = None
    for i, line in enumerate(lines):
        cls_match = re.match(r'^class\s+(\w+)', line)
        if cls_match:
            current_class = CodeNode(
                id=f"{filepath}::{cls_match.group(1)}",
                type="class",
                language="python",
                name=cls_match.group(1),
                source_lines=line,
                file=filepath,
                line_start=i,
                line_end=i,
                parent_id=filepath
            )
            file_node.children.append(current_class)
        if current_class:
            # Match `attr = Column(...)` (SQLAlchemy ORM)
            attr_match = re.match(r'^\s{4}(\w+)\s*=\s*Column\(', line)
            if attr_match:
                attr = CodeNode(
                    id=f"{current_class.id}::{attr_match.group(1)}",
                    type="variable",
                    language="python",
                    name=attr_match.group(1),
                    source_lines=line.strip(),
                    file=filepath,
                    line_start=i,
                    line_end=i,
                    parent_id=current_class.id
                )
                current_class.children.append(attr)
            # Match Pydantic annotated fields: `attr: type` or `attr: type = default`
            pydantic_match = re.match(r'^\s{4}(\w+)\s*:\s*\w+', line)
            if pydantic_match:
                name = pydantic_match.group(1)
                if name not in ('class', 'def', 'model_config') and not name.startswith('__'):
                    attr = CodeNode(
                        id=f"{current_class.id}::{name}",
                        type="variable",
                        language="python",
                        name=name,
                        source_lines=line.strip(),
                        file=filepath,
                        line_start=i,
                        line_end=i,
                        parent_id=current_class.id
                    )
                    if not any(c.id == attr.id for c in current_class.children):
                        current_class.children.append(attr)
        # Reset class context when we exit the class indent
        if current_class and i > 0 and line and not line[0].isspace() and not line.startswith('class'):
            current_class = None
