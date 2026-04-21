"""
Data Access Layer for Cassandra

Provides a repository pattern for interacting with the database.
This abstracts the CQL queries from the main application logic.
"""
import json
from typing import Any, Dict

from database.connection import CassandraConnectionManager
from database.connection import QueryResult
from database.model import TableSchema, Record


class CassandraRepository:
    """
    Repository for all Cassandra data operations.
    """

    def __init__(self, connection_manager: CassandraConnectionManager):
        self._connection = connection_manager

    def get_records(self, schema: TableSchema, filter_params: Dict[str, Any], page_size: int):
        """Fetch records from a table with optional filters."""
        query = f"SELECT * FROM {schema.keyspace}.{schema.table_name}"

        if filter_params:
            where_clauses = []
            for k, v in filter_params.items():
                if schema.column(k).is_text:
                    where_clauses.append(f"{k} = '{v}'")
                else:
                    where_clauses.append(f"{k} = {v}")
            query += " WHERE " + " AND ".join(where_clauses) + " LIMIT " + str(page_size) + " ALLOW FILTERING"
            rows = self._connection.execute(query)
        else:
            rows = self._connection.execute(query + " LIMIT " + str(page_size))

        return [Record(schema, row) for row in rows]

    def update_record(self, schema: TableSchema, original_row: Dict[str, Any], updated_data: Dict[str, Any]) -> None:
        """Update a record in the database."""
        set_parts = []
        set_values = []

        for col in schema.regular_columns:
            new_val = updated_data.get(col.name)
            if col.cql_type.startswith('map<'):
                if isinstance(new_val, str):
                    try:
                        new_val = json.loads(new_val)
                    except json.JSONDecodeError as e:
                        raise ValueError(f"Invalid JSON for column {col.name}") from e
            set_parts.append(f"{col.name} = ?")
            set_values.append(new_val)

        if not set_parts:
            raise ValueError("No columns to update.")

        where_parts = []
        where_values = []
        for col in schema.primary_key_columns:
            val = original_row.get(col.name)
            where_parts.append(f"{col.name} = ?")
            where_values.append(val)

        query = f"UPDATE {schema.keyspace}.{schema.table_name} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
        self._connection.execute(query, tuple(set_values + where_values))

    def delete_record(self, schema: TableSchema, row: Dict[str, Any]) -> None:
        """Delete a record from the database."""
        where_parts = []
        where_values = []
        for col in schema.primary_key_columns:
            val = row.get(col.name)
            where_parts.append(f"{col.name} = ?")
            where_values.append(val)

        query = f"DELETE FROM {schema.keyspace}.{schema.table_name} WHERE {' AND '.join(where_parts)}"
        self._connection.execute(query, tuple(where_values))

    def insert_record(self, schema: TableSchema, data: Dict[str, Any]) -> None:
        """Insert a new record into the database."""
        columns = []
        placeholders = []
        values = []

        for k, v in data.items():
            value = v
            if value is not None and value != '':
                columns.append(k)
                placeholders.append('%s')
                
                # Simple type handling for now, can be improved
                if schema.column(k).is_set_or_list:
                    values.append(set(value) if schema.column(k).cql_type.startswith('set') else list(value))
                else:
                    values.append(value)

        if not columns:
            raise ValueError("No data to insert.")

        if len(columns) > 0:
            query = f"INSERT INTO {schema.keyspace}.{schema.table_name} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
            self._connection.execute(query, tuple(values))

    def execute_cql(self, query: str) -> QueryResult:
        """Execute an arbitrary CQL query."""
        return self._connection.execute_cql(query)
