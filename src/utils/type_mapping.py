"""
Cassandra Type Mapping Utilities

Maps Cassandra CQL types to Python types and provides validation
and conversion utilities for form field generation.
"""

import re
import uuid
from datetime import datetime, date, time
from decimal import Decimal
from typing import Any, Optional, Tuple

# Mapping of CQL types to Python types and form field types
CQL_TYPE_MAP = {
    # Numeric types
    'int': {'python_type': int, 'widget': 'number_input', 'min': -2147483648, 'max': 2147483647},
    'bigint': {'python_type': int, 'widget': 'number_input', 'min': -9223372036854775808, 'max': 9223372036854775807},
    'smallint': {'python_type': int, 'widget': 'number_input', 'min': -32768, 'max': 32767},
    'tinyint': {'python_type': int, 'widget': 'number_input', 'min': -128, 'max': 127},
    'varint': {'python_type': int, 'widget': 'lineedit'},
    'float': {'python_type': float, 'widget': 'double_input'},
    'double': {'python_type': float, 'widget': 'double_input'},
    'decimal': {'python_type': Decimal, 'widget': 'lineedit'},
    'counter': {'python_type': int, 'widget': 'number_input', 'readonly': True},

    # String types
    'text': {'python_type': str, 'widget': 'textedit'},
    'varchar': {'python_type': str, 'widget': 'lineedit'},
    'ascii': {'python_type': str, 'widget': 'lineedit'},

    # Boolean
    'boolean': {'python_type': bool, 'widget': 'checkbox'},

    # UUID types
    'uuid': {'python_type': uuid.UUID, 'widget': 'lineedit', 'placeholder': 'UUID (auto-generated if empty)'},
    'timeuuid': {'python_type': uuid.UUID, 'widget': 'lineedit', 'placeholder': 'TimeUUID'},

    # Date/Time types
    'timestamp': {'python_type': datetime, 'widget': 'datetime'},
    'date': {'python_type': date, 'widget': 'date'},
    'time': {'python_type': time, 'widget': 'time'},
    'duration': {'python_type': str, 'widget': 'lineedit'},

    # Binary
    'blob': {'python_type': bytes, 'widget': 'textedit', 'placeholder': 'Hex string'},

    # Network types
    'inet': {'python_type': str, 'widget': 'lineedit', 'placeholder': 'IP address'},

    # Collections (handled specially)
    'list': {'python_type': list, 'widget': 'textedit', 'placeholder': 'JSON array: ["item1", "item2"]'},
    'set': {'python_type': set, 'widget': 'textedit', 'placeholder': 'JSON array: ["item1", "item2"]'},
    'map': {'python_type': dict, 'widget': 'map_edit', 'placeholder': 'JSON object: {"key": "value"}'},

    # Tuple and frozen types
    'tuple': {'python_type': tuple, 'widget': 'textedit', 'placeholder': 'JSON array'},
    'frozen': {'python_type': object, 'widget': 'textedit', 'placeholder': 'JSON'},
}


def parse_cql_type(cql_type: str) -> Tuple[str, Optional[list[str]]]:
    """
    Parse a CQL type string into base type and generic parameters.

    Examples:
        'text' -> ('text', None)
        'list<text>' -> ('list', ['text'])
        'map<text, int>' -> ('map', ['text', 'int'])
        'frozen<map<text, text>>' -> ('frozen', ['map<text, text>'])

    Args:
        cql_type: CQL type string.

    Returns:
        Tuple of (base_type, type_parameters).
    """
    # Check for generic types
    match = re.match(r'(\w+)<(.+)>$', cql_type)
    if match:
        base_type = match.group(1)
        params_str = match.group(2)

        # Simple parameter parsing (doesn't handle deeply nested types)
        if ',' in params_str and '<' not in params_str:
            params = [p.strip() for p in params_str.split(',')]
        else:
            params = [params_str]

        return base_type, params

    return cql_type, None


def get_type_info(cql_type: str) -> dict:
    """
    Get type information for a CQL type.

    Args:
        cql_type: CQL type string.

    Returns:
        Dictionary with type information for form generation.
    """
    base_type, params = parse_cql_type(cql_type)

    if base_type in CQL_TYPE_MAP:
        info = CQL_TYPE_MAP[base_type].copy()
        info['cql_type'] = cql_type
        info['base_type'] = base_type
        # noinspection PyTypeChecker
        info['type_params'] = params
        return info

    # Default for unknown types
    return {
        'python_type': str,
        'widget': 'lineedit',
        'cql_type': cql_type,
        'base_type': base_type,
        'type_params': params
    }


def convert_value(value: Any, cql_type: str) -> Any:
    """
    Convert a Python value to the appropriate type for Cassandra.

    Args:
        value: Value to convert.
        cql_type: Target CQL type.

    Returns:
        Converted value.
    """
    import json

    if value is None or value == '':
        return None

    base_type, params = parse_cql_type(cql_type)

    if base_type in ('int', 'bigint', 'smallint', 'tinyint', 'varint'):
        return int(value)

    elif base_type in ('float', 'double'):
        return float(value)

    elif base_type == 'decimal':
        return Decimal(str(value))

    elif base_type == 'boolean':
        if isinstance(value, bool):
            return value
        return str(value).lower() in ('true', '1', 'yes')

    elif base_type == 'uuid':
        if isinstance(value, uuid.UUID):
            return value
        if not value:
            return uuid.uuid4()
        return uuid.UUID(str(value))

    elif base_type == 'timeuuid':
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))

    elif base_type == 'timestamp':
        if isinstance(value, datetime):
            return value
        return datetime.fromisoformat(str(value))

    elif base_type == 'date':
        if isinstance(value, date):
            return value
        return date.fromisoformat(str(value))

    elif base_type == 'time':
        if isinstance(value, time):
            return value
        return time.fromisoformat(str(value))

    elif base_type == 'list':
        if isinstance(value, list):
            return value
        return json.loads(value)

    elif base_type == 'set':
        if isinstance(value, (set, list)):
            return set(value) if isinstance(value, list) else value
        return set(json.loads(value))

    elif base_type == 'map':
        if isinstance(value, dict):
            return value
        return json.loads(value)

    elif base_type == 'blob':
        if isinstance(value, bytes):
            return value
        return bytes.fromhex(value.replace(' ', ''))

    # Default: return as string
    return str(value)


def format_value_for_display(value: Any, cql_type: str) -> str:
    """
    Format a value for display in the UI.

    Args:
        value: Value to format.
        cql_type: CQL type of the value.

    Returns:
        String representation for display.
    """
    import json

    if value is None:
        return ''

    base_type, _ = parse_cql_type(cql_type)

    if base_type == 'map':
        return json.dumps(dict(value), default=str, indent=2)

    elif base_type == 'set':
        return json.dumps(dict(value), default=str)

    elif base_type == 'list':
        return json.dumps(value, default=str)

    elif base_type == 'blob':
        if isinstance(value, bytes):
            return value.hex()
        return str(value)

    elif base_type == 'timestamp':
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    elif base_type == 'date':
        if isinstance(value, date):
            return value.isoformat()
        return str(value)

    elif base_type == 'time':
        if isinstance(value, time):
            return value.isoformat()
        return str(value)

    return str(value)