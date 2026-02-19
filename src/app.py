"""
Main Application Controller for Cassandra GUI

Initializes and coordinates all components of the application.
"""
import streamlit as st

from src.config.settings import ConfigManager
from src.database.connection import CassandraConnectionManager
from src.database.model import SchemaInspector
from src.database.repository import CassandraRepository
from src.view import main_view, dialogs_view

class CassandraGUIApp:
    """
    Main application controller for Cassandra GUI Client.
    """

    def __init__(self):
        # Initialize session state for main components
        if 'config_manager' not in st.session_state:
            st.session_state.config_manager = ConfigManager()
        if 'connection_manager' not in st.session_state:
            st.session_state.connection_manager = CassandraConnectionManager()
        if 'repository' not in st.session_state:
            st.session_state.repository = CassandraRepository(st.session_state.connection_manager)
        if 'schema_inspector' not in st.session_state:
            st.session_state.schema_inspector = None

        self._config = st.session_state.config_manager
        self._connection = st.session_state.connection_manager
        self._repository = st.session_state.repository

    def run(self):
        """Run the main application loop."""
        main_view.render_sidebar(
            connections=self._config.get_all_connections(),
            is_connected=self._connection.is_connected,
            connect_callback=self._connect_to_profile,
            disconnect_callback=self._disconnect,
            schema_inspector=st.session_state.schema_inspector
        )

        current_table_schema = self._get_current_table_schema()
        
        data_callbacks = {
            'get_records': self._repository.get_records,
            'update': self._repository.update_record,
            'delete': self._repository.delete_record,
            'insert': self._repository.insert_record,
        }
        
        cql_callbacks = {
            'execute': self._repository.execute_cql,
        }

        main_view.render_main_content(
            is_connected=self._connection.is_connected,
            schema=current_table_schema,
            data_callbacks=data_callbacks,
            cql_callbacks=cql_callbacks
        )
        
        dialogs_view.render_delete_confirmation(self._repository.delete_record)

    def _connect_to_profile(self, name: str):
        """Connect to the selected profile."""
        profile = self._config.get_connection(name)
        if profile:
            # noinspection PyTypeChecker
            with st.spinner(f"Connecting to {name}..."):
                result = self._connection.connect(profile)
                if result.success:
                    st.session_state.schema_inspector = SchemaInspector(self._connection.session)
                    st.session_state.default_keyspace = profile.default_keyspace
                    st.success(f"Connected to {name}")
                    st.rerun()
                else:
                    st.error(f"Connection failed: {result.message}")

    def _disconnect(self):
        """Disconnect from the current cluster."""
        self._connection.disconnect()
        st.session_state.schema_inspector = None
        if 'current_table_schema' in st.session_state:
            del st.session_state.current_table_schema
        st.rerun()

    def _get_current_table_schema(self):
        """Get the schema for the currently selected table."""
        if self._connection.is_connected and st.session_state.get('selected_table'):
            keyspace = st.session_state.selected_keyspace
            table = st.session_state.selected_table
            
            # Cache schema to avoid re-fetching on every interaction
            if 'current_table_schema' not in st.session_state or \
               st.session_state.current_table_schema.table_name != table or \
               st.session_state.current_table_schema.keyspace != keyspace:
                st.session_state.current_table_schema = st.session_state.schema_inspector.get_table_schema(keyspace, table)
            
            return st.session_state.current_table_schema
        return None

if __name__ == "__main__":
    app = CassandraGUIApp()
    app.run()
