"""
Cassandra Connection Manager

Handles creating, testing, and managing connections to Cassandra clusters.
Supports authentication, SSL, and multiple hosts.
"""

from typing import Optional, Callable, List, Dict, Any
from dataclasses import dataclass

from cassandra import ConsistencyLevel
from cassandra.cluster import (
    Cluster,
    Session,
    NoHostAvailable,
    ExecutionProfile,
    EXEC_PROFILE_DEFAULT
)
from cassandra.auth import PlainTextAuthProvider
from cassandra.policies import RoundRobinPolicy
from cassandra.query import dict_factory, SimpleStatement
import ssl

from config.settings import ConnectionProfile

from enum import Enum

class Color(Enum):
    RED = 1
    GREEN = 2
    BLUE = 'blue'

class CassandraConsistencyLevel(Enum):
    ANY = ConsistencyLevel.ANY
    ONE = ConsistencyLevel.ONE
    TWO = ConsistencyLevel.TWO
    THREE = ConsistencyLevel.THREE
    QUORUM = ConsistencyLevel.QUORUM
    ALL = ConsistencyLevel.ALL
    LOCAL_QUORUM = ConsistencyLevel.LOCAL_QUORUM
    EACH_QUORUM = ConsistencyLevel.EACH_QUORUM
    SERIAL = ConsistencyLevel.SERIAL
    LOCAL_SERIAL = ConsistencyLevel.LOCAL_SERIAL
    LOCAL_ONE = ConsistencyLevel.LOCAL_ONE


@dataclass
class QueryResult:
    """Result of a CQL query execution."""
    success: bool
    data: Optional[List[Dict[str, Any]]] = None
    message: Optional[str] = None
    paging_state: Optional[bytes] = None
    has_more_pages: bool = False


@dataclass
class ConnectionResult:
    """Result of a connection attempt."""
    success: bool
    message: str
    session: Optional[Session] = None


class CassandraConnectionManager:
    """
    Manages Cassandra cluster connections.

    Provides methods to connect, disconnect, test connections,
    and switch keyspaces at runtime.
    """

    def __init__(self):
        self._cluster: Optional[Cluster] = None
        self._session: Optional[Session] = None
        self._current_profile: Optional[ConnectionProfile] = None
        self._current_keyspace: Optional[str] = None
        self._on_disconnect_callbacks: list[Callable] = []

    @property
    def is_connected(self) -> bool:
        """Check if there's an active connection."""
        return self._session is not None and not self._session.is_shutdown

    @property
    def current_keyspace(self) -> Optional[str]:
        """Get the currently selected keyspace."""
        return self._current_keyspace

    @property
    def session(self) -> Optional[Session]:
        """Get the current session."""
        return self._session

    @property
    def current_profile(self) -> Optional[ConnectionProfile]:
        """Get the current connection profile."""
        return self._current_profile

    def add_disconnect_callback(self, callback: Callable) -> None:
        """Register a callback to be called on disconnect."""
        self._on_disconnect_callbacks.append(callback)

    def connect(self, profile: ConnectionProfile) -> ConnectionResult:
        """
        Establish a connection to Cassandra using the given profile.

        Args:
            profile: Connection profile with hosts, credentials, etc.

        Returns:
            ConnectionResult with success status and session if successful.
        """
        # Disconnect any existing connection
        self.disconnect()

        try:
            # Build authentication provider if credentials provided
            auth_provider = None
            if profile.username and profile.password:
                auth_provider = PlainTextAuthProvider(
                    username=profile.username,
                    password=profile.password
                )

            # Build SSL options if enabled
            ssl_context = None
            if profile.ssl_enabled:
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            # Create execution profile with dict factory for easier data handling
            exec_profile = ExecutionProfile(
                load_balancing_policy=RoundRobinPolicy(),
                row_factory=dict_factory
            )

            # Create cluster connection
            self._cluster = Cluster(
                contact_points=profile.hosts,
                port=profile.port,
                auth_provider=auth_provider,
                ssl_context=ssl_context,
                execution_profiles={EXEC_PROFILE_DEFAULT: exec_profile},
                protocol_version=4
            )

            # Connect to cluster
            self._session = self._cluster.connect()
            self._current_profile = profile

            # Set default keyspace if specified
            if profile.default_keyspace:
                self.set_keyspace(profile.default_keyspace)

            return ConnectionResult(
                success=True,
                message=f"Connected to {', '.join(profile.hosts)}",
                session=self._session
            )

        except NoHostAvailable as e:
            return ConnectionResult(
                success=False,
                message=f"Could not connect to any host: {str(e)}"
            )
        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"Connection failed: {str(e)}"
            )

    def disconnect(self) -> None:
        """Close the current connection."""
        if self._session:
            self._session.shutdown()
            self._session = None

        if self._cluster:
            self._cluster.shutdown()
            self._cluster = None

        self._current_profile = None
        self._current_keyspace = None

        # Notify listeners
        for callback in self._on_disconnect_callbacks:
            callback()

    def test_connection(self, profile: ConnectionProfile) -> ConnectionResult:
        """
        Test a connection without persisting it.

        Args:
            profile: Connection profile to test.

        Returns:
            ConnectionResult indicating success or failure.
        """
        try:
            auth_provider = None
            if profile.username and profile.password:
                auth_provider = PlainTextAuthProvider(
                    username=profile.username,
                    password=profile.password
                )

            ssl_context = None
            if profile.ssl_enabled:
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE

            cluster = Cluster(
                contact_points=profile.hosts,
                port=profile.port,
                auth_provider=auth_provider,
                ssl_context=ssl_context,
                protocol_version=4
            )

            session = cluster.connect()

            # Run a simple query to verify connection
            session.execute("SELECT release_version FROM system.local")

            session.shutdown()
            cluster.shutdown()

            return ConnectionResult(
                success=True,
                message="Connection test successful!"
            )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"Connection test failed: {str(e)}"
            )

    def set_keyspace(self, keyspace: str) -> None:
        """
        Switch to a different keyspace.

        Args:
            keyspace: Name of the keyspace to use.
        """
        if self._session:
            self._session.set_keyspace(keyspace)
            self._current_keyspace = keyspace

    def execute(self, query: str, parameters: tuple = None, page_size: int = None, paging_state: bytes = None):
        """
        Execute a CQL query.

        Args:
            query: CQL query string.
            parameters: Optional tuple of parameters for prepared statement.
            page_size: Number of rows to fetch (fetch_size).
            paging_state: State string to resume pagination.

        Returns:
            Query result set.
        """
        if not self._session:
            raise RuntimeError("No active connection")

        if parameters:
            prepared = self._session.prepare(query)
            bound = prepared.bind(parameters)
            bound.consistency_level = self._current_profile.consistency_level
            if page_size:
                bound.fetch_size = page_size
            return self._session.execute(bound, paging_state=paging_state)
        else:
            statement = SimpleStatement(query)
            if page_size:
                statement.fetch_size = page_size
            return self._session.execute(statement, paging_state=paging_state)

    def execute_cql(self, query: str, parameters: tuple = None, page_size: int = None, paging_state: bytes = None) -> QueryResult:
        """
        Execute a CQL query and return a structured result.

        Args:
            query: CQL query string.
            parameters: Optional tuple of parameters.
            page_size: Number of rows to fetch.
            paging_state: State string to resume pagination.

        Returns:
            QueryResult object containing success status, data, or error.
        """
        if not self._session:
            raise RuntimeError("No active connection")
        if not query or not query.strip():
            return QueryResult(success=True, message="Empty query", data=[])

        try:
            rs = self.execute(query, parameters, page_size, paging_state)
            # Convert ResultSet to list to consume it and get data
            data = list(rs)
            return QueryResult(
                success=True,
                data=data,
                paging_state=rs.paging_state,
                has_more_pages=rs.has_more_pages
            )
        except Exception as e:
            return QueryResult(success=False, message=str(e))
