"""
Data Model for Cassandra

Defines the structure of database entities, including tables, columns, and records.
This file replaces the previous schema.py.
"""
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import streamlit as st
from cassandra.cluster import Session
from streamlit.delta_generator import DeltaGenerator

from utils.utils import uuid_validator

number_types = ['int', 'bigint', 'varint', 'smallint', 'tinyint', 'counter']
float_types = ['float', 'double', 'decimal']
text_types = ['ascii', 'text', 'varchar']
date_types = ['date', 'time', 'timestamp', 'duration']
uuid_types = ['uuid', 'timeuuid']
collection_types = ['map', 'set', 'list']
other_types = ['boolean', 'blob', 'inet']


@dataclass
class ColumnInfo:
    """Information about a single column."""
    name: str
    cql_type: str
    is_partition_key: bool = False
    is_clustering_key: bool = False
    clustering_order: str = "ASC"
    position: int = 0

    @property
    def is_primary_key(self) -> bool:
        """Check if column is part of primary key."""
        return self.is_partition_key or self.is_clustering_key

    @property
    def label(self) -> str:
        if self.is_partition_key:
            return f"**{self.name} ({self.cql_type})**"
        elif self.is_clustering_key:
            return f"*{self.name} ({self.cql_type})*"
        else:
            return f"{self.name} ({self.cql_type})"

    @property
    def hint(self):
        if self.is_partition_key:
            return "Partition Key (Primary Key)"
        elif self.is_clustering_key:
            return "Clustering Key (Primary Key)"
        else:
            return ""

    @property
    def is_numeric(self):
        return self.cql_type in number_types or self.cql_type in float_types

    @property
    def is_text(self):
        return self.cql_type in text_types

    @property
    def is_uuid(self):
        return self.cql_type in uuid_types

    @property
    def is_set_or_list(self):
        return self.cql_type.lower().startswith('set') or self.cql_type.lower().startswith('list')

    @property
    def is_map(self):
        return self.cql_type.lower().startswith('map')

    @property
    def collection_subtype(self):
        if "<" in self.cql_type:
            return self.cql_type.split("<")[1].replace(">", "")
        return None


@dataclass
class TableSchema:
    """Complete schema information for a table."""
    keyspace: str
    table_name: str
    columns: List[ColumnInfo] = field(default_factory=list)

    def column(self, name: str) -> Optional[ColumnInfo]:
        for c in self.columns:
            if c.name == name:
                return c
        return None

    @property
    def partition_keys(self) -> List[ColumnInfo]:
        """Get partition key columns in order."""
        return sorted(
            [c for c in self.columns if c.is_partition_key],
            key=lambda c: c.position
        )

    @property
    def clustering_keys(self) -> List[ColumnInfo]:
        """Get clustering key columns in order."""
        return sorted(
            [c for c in self.columns if c.is_clustering_key],
            key=lambda c: c.position
        )

    @property
    def primary_key_columns(self) -> List[ColumnInfo]:
        """Get all primary key columns (partition + clustering)."""
        return self.partition_keys + self.clustering_keys

    @property
    def regular_columns(self) -> List[ColumnInfo]:
        """Get non-primary-key columns."""
        return [c for c in self.columns if not c.is_primary_key]

    @property
    def all_columns_sorted(self) -> List[ColumnInfo]:
        """Get all columns with primary keys first."""
        return self.primary_key_columns + self.regular_columns

    @staticmethod
    def cql_col_input(value: Any, generator: DeltaGenerator, col: ColumnInfo, **kwargs):
        out = {}
        if col.is_numeric:
            out['value'] = generator.number_input(col.label, value=value)
        elif col.cql_type == 'uuid':
            out['value'] = generator.text_input(col.label,
                                                help=col.hint,
                                                max_chars=36,
                                                value=str(value if value else uuid.uuid4()))
            out['validator'] = uuid_validator
        elif col.cql_type == 'timeuuid':
            out['value'] = generator.text_input(col.label,
                                                help=col.hint,
                                                max_chars=36,
                                                value=str(value if value else (uuid.uuid1())))
            out['validator'] = uuid_validator
        elif col.is_text or col.cql_type == 'duration' or col.cql_type in uuid_types or col.cql_type == 'inet' \
                or col.cql_type in collection_types:
            out['value'] = generator.text_input(col.label, help=col.hint, value=value)
        elif col.cql_type == 'date':
            out['value'] = generator.date_input(col.label, help=col.hint, value=value)
        elif col.cql_type == 'time':
            out['value'] = generator.time_input(col.label, help=col.hint, value=value)
        elif col.cql_type == 'timestamp':
            out['value'] = generator.datetime_input(col.label, help=col.hint, value=value)
        elif col.cql_type == 'boolean':
            out['value'] = generator.checkbox(col.label, help=col.hint, value=value)
        elif col.cql_type.startswith('list<') or col.cql_type.startswith('set<'):
            generator.markdown(f"**{col.name} ({col.cql_type})**")

            # Initialize if empty
            if col.name not in st.session_state.collection_inputs:
                st.session_state.collection_inputs[col.name] = []

            items = st.session_state.collection_inputs[col.name]

            # Render existing items
            for idx, item in enumerate(items):
                c1, c2 = generator.columns([4, 1])
                # Update item in state on change
                new_val = c1.text_input(f"Item {idx + 1}", value=item, key=f"insert_{col.name}_{idx}",
                                        label_visibility="collapsed")
                st.session_state.collection_inputs[col.name][idx] = new_val

                if c2.button("🗑️", key=f"remove_{col.name}_{idx}"):
                    kwargs['remove_collection_item'](col.name, idx)
                    st.rerun()

            if generator.button("➕ Add Item", key=f"add_{col.name}"):
                kwargs['add_collection_item'](col.name)
                st.rerun()

            # Store the list/set for submission
            # Filter out empty strings
            valid_items = [x for x in items if x]
            if valid_items:
                out['value'] = set(valid_items) if col.cql_type.startswith('set') else valid_items
        else:
            out['value'] = generator.text_area(col.label, help=col.hint, key=col.name)
        return out


@dataclass
class Record:
    """
    Represents a single Cassandra record/row with its associated schema.
    """
    _schema: TableSchema = None
    _data: Dict[str, Any] = field(default_factory=dict)
    _key: str = None

    def __init__(self, schema: TableSchema, row: Any):
        """
        Initialize a record.

        Args:
            schema: The TableSchema associated with this record.
            row: A row from a Cassandra ResultSet (dict-like or named-tuple).
        """
        self._schema = schema
        self._key = ":".join([str(row[col.name]) for col in self._schema.primary_key_columns])
        self._data = {}

        # Construct the internal record based on the schema columns
        for col in self._schema.columns:
            # Handle row as dict or object (ResultSet rows can vary depending on row_factory)
            if hasattr(row, col.name):
                self._data[col.name] = getattr(row, col.name)
            elif isinstance(row, dict) and col.name in row:
                self._data[col.name] = row[col.name]
            else:
                self._data[col.name] = None

    @property
    def key(self):
        return self._key

    @property
    def schema(self):
        return self._schema

    @property
    def data(self) -> Dict[str, Any]:
        """Returns the internal dictionary representing the record."""
        return self._data

    def get(self, column_name: str) -> Any:
        """Get value for a specific column."""
        return self._data.get(column_name)

    def set(self, column_name: str, value: Any) -> None:
        """Get value for a specific column."""
        self._data[column_name] = value

    def __str__(self):
        return self._key


# noinspection SqlNoDataSourceInspection
class SchemaInspector:
    """
    Inspects Cassandra schema metadata.

    Uses system tables to discover keyspaces, tables, and column
    information dynamically. All schema information is fetched
    at runtime to handle schema changes gracefully.
    """

    def __init__(self, session: Session):
        """
        Initialize schema inspector.

        Args:
            session: Active Cassandra session.
        """
        self._session = session

    def get_keyspaces(self) -> List[str]:
        """
        Get list of all keyspaces.

        Returns:
            List of keyspace names, excluding system keyspaces.
        """
        query = """
                SELECT keyspace_name
                FROM system_schema.keyspaces \
                """
        rows = self._session.execute(query)

        # Filter out system keyspaces
        system_keyspaces = {
            'system', 'system_auth', 'system_schema',
            'system_distributed', 'system_traces', 'system_views',
            'system_virtual_schema'
        }

        return sorted([
            row['keyspace_name']
            for row in rows
            if row['keyspace_name'] not in system_keyspaces
        ])

    def get_tables(self, keyspace: str) -> List[str]:
        """
        Get list of tables in a keyspace sorted.

        Args:
            keyspace: Name of the keyspace.

        Returns:
            List of table names.
        """
        query = """
                SELECT table_name
                FROM system_schema.tables
                WHERE keyspace_name = %s \
                """
        rows = self._session.execute(query, (keyspace,))
        return sorted([row['table_name'] for row in rows])

    def get_table_schema(self, keyspace: str, table: str) -> TableSchema:
        """
        Get complete schema information for a table.

        This method queries system_schema.columns to get all column
        information including types, and determines partition/clustering
        keys from the column kind field.

        Args:
            keyspace: Name of the keyspace.
            table: Name of the table.

        Returns:
            TableSchema with complete column information.
        """
        # Query column information from system schema
        query = """
                SELECT column_name, type, kind, position, clustering_order
                FROM system_schema.columns
                WHERE keyspace_name = %s
                  AND table_name = %s \
                """
        rows = self._session.execute(query, (keyspace, table))

        columns = []
        for row in rows:
            # Determine column role from 'kind' field
            # kind can be: partition_key, clustering, regular, static
            is_partition = row['kind'] == 'partition_key'
            is_clustering = row['kind'] == 'clustering'

            column = ColumnInfo(
                name=row['column_name'],
                cql_type=row['type'],
                is_partition_key=is_partition,
                is_clustering_key=is_clustering,
                clustering_order=row.get('clustering_order', 'ASC') or 'ASC',
                position=row['position']
            )
            columns.append(column)

        return TableSchema(
            keyspace=keyspace,
            table_name=table,
            columns=columns
        )

    def get_row_count_estimate(self, keyspace: str, table: str) -> int:
        """
        Get estimated row count for a table.

        Note: This is an estimate and may not be accurate for large tables.

        Args:
            keyspace: Name of the keyspace.
            table: Name of the table.

        Returns:
            Estimated row count.
        """
        # This query can be slow on large tables
        query = f"SELECT COUNT(*) as count FROM {keyspace}.{table} LIMIT 10000"
        result = self._session.execute(query)
        row = result.one()
        return row['count'] if row else 0