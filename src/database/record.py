from typing import Any, Dict
from src.database.schema import TableSchema

class Record:
    """
    Represents a single Cassandra record/row with its associated schema.
    """
    def __init__(self, schema: TableSchema, row: Any):
        """
        Initialize a record.

        Args:
            schema: The TableSchema associated with this record.
            row: A row from a Cassandra ResultSet (dict-like or named-tuple).
        """
        self.schema = schema
        self._data: Dict[str, Any] = {}
        
        # Construct the internal record based on the schema columns
        for col in self.schema.columns:
            # Handle row as dict or object (ResultSet rows can vary depending on row_factory)
            if hasattr(row, col.name):
                self._data[col.name] = getattr(row, col.name)
            elif isinstance(row, dict) and col.name in row:
                self._data[col.name] = row[col.name]
            else:
                self._data[col.name] = None

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
