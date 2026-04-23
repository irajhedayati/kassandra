"""
Configuration Persistence Module

Handles saving and loading application configuration to/from JSON file
in the user's home directory. Auto-creates directories if missing.
"""

import argparse
import logging
import json
import os
from pathlib import Path
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict, field


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class ConnectionProfile:
    """Represents a saved Cassandra connection profile."""
    name: str
    hosts: list[str]
    port: int = 9042
    username: str = ""
    password: str = ""
    ssl_enabled: bool = False
    ssl_protocol: str = "PROTOCOL_TLS"
    ssl_cert_path: str = ""
    default_keyspace: str = ""
    consistency_level: str = "LOCAL_ONE"
    connection_timeout: int = 5
    protocol_version: int = 5

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ConnectionProfile":
        return cls(**data)


@dataclass
class AppSettings:
    """Application settings container."""
    connections: list[ConnectionProfile] = field(default_factory=list)
    last_connection_name: str = ""
    window_geometry: dict = field(default_factory=dict)
    # Stores metadata per table: "keyspace.table" -> {"column_name": {"hide": bool, "map_schema": [...]}}
    table_metadata: Dict[str, Dict[str, Dict[str, Any]]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "connections": [c.to_dict() for c in self.connections],
            "last_connection_name": self.last_connection_name,
            "window_geometry": self.window_geometry,
            "table_metadata": self.table_metadata
        }

    @classmethod
    def from_dict(cls, data: dict) -> "AppSettings":
        connections = [
            ConnectionProfile.from_dict(c)
            for c in data.get("connections", [])
        ]
        return cls(
            connections=connections,
            last_connection_name=data.get("last_connection_name", ""),
            window_geometry=data.get("window_geometry", {}),
            table_metadata=data.get("table_metadata", {})
        )


class ConfigManager:
    """
    Manages application configuration persistence.

    Configuration is stored in ~/.py-sandra/config.json by default.
    Can be overridden with --home command line argument or PY_SANDRA_HOME env var.
    """

    DEFAULT_CONFIG_DIR_NAME = ".py-sandra"
    CONFIG_FILE_NAME = "config.json"

    def __init__(self):
        self._config_dir = self._get_config_dir()
        self._config_file = self._config_dir / self.CONFIG_FILE_NAME
        self._settings: Optional[AppSettings] = None

    @property
    def config_dir(self) -> Path:
        return self._config_dir

    @property
    def config_file(self) -> Path:
        return self._config_file

    def _get_config_dir(self) -> Path:
        """
        Determine configuration directory from command line args, env var, or default.
        """
        parser = argparse.ArgumentParser(add_help=False)
        parser.add_argument("--home", type=str, help="Path to configuration directory")

        # Parse known args to avoid conflict with streamlit args
        args, _ = parser.parse_known_args()

        if args.home:
            logger.info("Home directory (arg): " + args.home)
            return Path(args.home)

        env_home = os.environ.get("PY_SANDRA_HOME", None)
        if env_home:
            logger.info("Home directory (env): " + env_home)
            return Path(env_home)

        logger.info("Home directory (default): " + str(Path.home() / self.DEFAULT_CONFIG_DIR_NAME))
        return Path.home() / self.DEFAULT_CONFIG_DIR_NAME

    def _ensure_config_dir(self) -> None:
        """Create configuration directory if it doesn't exist."""
        self._config_dir.mkdir(parents=True, exist_ok=True)

    def load(self) -> AppSettings:
        """
        Load settings from configuration file.
        Returns default settings if file doesn't exist.
        """
        if self._config_file.exists():
            try:
                with open(self._config_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._settings = AppSettings.from_dict(data)
            except (json.JSONDecodeError, KeyError) as e:
                print(f"Warning: Could not parse config file: {e}")
                self._settings = AppSettings()
        else:
            self._settings = AppSettings()

        return self._settings

    def save(self, settings: AppSettings) -> None:
        """Save settings to configuration file."""
        self._ensure_config_dir()
        self._settings = settings

        with open(self._config_file, "w", encoding="utf-8") as f:
            json.dump(settings.to_dict(), f, indent=2)

    def get_all_connections(self) -> List[ConnectionProfile]:
        """Get all connection profiles."""
        if self._settings:
            return self._settings.connections
        return []

    def get_connection(self, name: str) -> Optional[ConnectionProfile]:
        """Get a connection profile by name."""
        if self._settings:
            for conn in self._settings.connections:
                if conn.name == name:
                    return conn
        return None

    def add_connection(self, connection: ConnectionProfile) -> None:
        """Add or update a connection profile."""
        if self._settings is None:
            self._settings = AppSettings()

        # Remove existing connection with same name
        self._settings.connections = [
            c for c in self._settings.connections if c.name != connection.name
        ]
        self._settings.connections.append(connection)
        self.save(self._settings)

    def delete_connection(self, name: str) -> None:
        """Delete a connection profile by name."""
        if self._settings:
            self._settings.connections = [
                c for c in self._settings.connections if c.name != name
            ]
            self.save(self._settings)

    def set_last_connection(self, name: str) -> None:
        """Set the last used connection name."""
        if self._settings:
            self._settings.last_connection_name = name
            self.save(self._settings)

    def get_column_metadata(self, keyspace: str, table: str, column: str) -> dict:
        """Get metadata for a specific column."""
        if not self._settings:
            return {}
        
        key = f"{keyspace}.{table}"
        table_meta = self._settings.table_metadata.get(key, {})
        return table_meta.get(column, {})

    def set_column_metadata(self, keyspace: str, table: str, column: str, key: str, value: Any) -> None:
        """Set a metadata value for a column."""
        if not self._settings:
            self._settings = AppSettings()
            
        table_key = f"{keyspace}.{table}"
        if table_key not in self._settings.table_metadata:
            self._settings.table_metadata[table_key] = {}
            
        if column not in self._settings.table_metadata[table_key]:
            self._settings.table_metadata[table_key][column] = {}
            
        self._settings.table_metadata[table_key][column][key] = value
        self.save(self._settings)
