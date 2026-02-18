"""
Main Application Logic

Coordinates all components of the Cassandra GUI client:
- Connection management
- Schema navigation
- Data browsing and CRUD operations
"""

import json
import re
from typing import Dict, Any

import pandas as pd
import streamlit as st

from src.database.schema import Record, render_form
from src.config.settings import ConfigManager, ConnectionProfile
from src.database.connection import CassandraConnectionManager
from src.database.schema import SchemaInspector, TableSchema
from src.utils.ssl import supported_ssl_protocols


# noinspection SqlNoDataSourceInspection,PyTypeChecker
class CassandraGUIApp:
    """
    Main application controller for Cassandra GUI Client.
    """

    def __init__(self):
        # Initialize session state
        if 'config_manager' not in st.session_state:
            st.session_state.config_manager = ConfigManager()
        if 'connection_manager' not in st.session_state:
            st.session_state.connection_manager = CassandraConnectionManager()
        if 'schema_inspector' not in st.session_state:
            st.session_state.schema_inspector = None
        
        self._config = st.session_state.config_manager
        self._connection = st.session_state.connection_manager
        
        # Load settings
        if 'settings' not in st.session_state:
            st.session_state.settings = self._config.load()

    def run(self):
        """Run the main application loop."""
        self._render_sidebar()
        self._render_main_content()
        self._render_delete_confirmation()
        self._render_map_schema_editor()

    def _render_sidebar(self):
        """Render the sidebar for navigation and connection management."""
        with st.sidebar:
            st.title("Cassandra GUI")
            
            # Connection Management
            st.header("Connections")
            
            connections = self._config.get_all_connections()
            connection_names = [c.name for c in connections]
            
            selected_conn = st.selectbox(
                "Select Connection",
                ["Select..."] + connection_names,
                key="selected_connection"
            )
            
            col1, col2 = st.columns(2)
            with col1:
                if st.button("Connect", disabled=selected_conn == "Select..."):
                    self._connect_to_profile(selected_conn)
            with col2:
                if st.button("Disconnect", disabled=not self._connection.is_connected):
                    self._disconnect()

            # Add/Edit Connection
            with st.expander("Manage Connections"):
                self._render_connection_form()

            # Schema Navigation
            if self._connection.is_connected and st.session_state.schema_inspector:
                st.divider()
                st.header("Schema")

                keyspaces = st.session_state.schema_inspector.get_keyspaces()
                if self._connection.current_profile.default_keyspace:
                    try:
                        idx = keyspaces.index(self._connection.current_profile.default_keyspace)
                    except ValueError:
                        idx = 0
                else:
                    idx = 0
                selected_ks = st.selectbox("Keyspace", keyspaces, index=idx, key="selected_keyspace")
                
                if selected_ks:
                    tables = st.session_state.schema_inspector.get_tables(selected_ks)
                    selected_table = st.selectbox("Table", tables, key="selected_table")

                    if st.button("Refresh", help="Refresh the list of tables", use_container_width=True):
                        st.rerun()

                    if selected_table:
                        # Reset pagination when table changes
                        if 'current_table_name' not in st.session_state or st.session_state.current_table_name != selected_table:
                            st.session_state.current_table_name = selected_table
                            st.session_state.paging_state = None
                            st.session_state.page_history = []
                            # Reset collection inputs
                            if 'collection_inputs' in st.session_state:
                                del st.session_state.collection_inputs

                        st.session_state.current_table_schema = st.session_state.schema_inspector.get_table_schema(selected_ks, selected_table)

    def _render_main_content(self):
        """Render the main content area."""
        if not self._connection.is_connected:
            st.info("Please select a connection and click 'Connect' to start.")
            return

        if 'current_table_schema' in st.session_state and st.session_state.current_table_schema:
            schema = st.session_state.current_table_schema
            st.header(f"Table: {schema.keyspace}.{schema.table_name}")
            
            tab1, tab2, tab3, tab4 = st.tabs(["Data Browser", "Insert Record", "Table Info", "CQL Editor"])
            
            with tab1:
                self._render_data_grid()
            
            with tab2:
                self._render_insert_form()
                
            with tab3:
                self._render_table_info()
                
            with tab4:
                self._render_cql_editor()
        else:
            st.info("Select a keyspace and table from the sidebar to view data.")

    def _render_connection_form(self):
        """Render form for adding/editing connections."""
        
        # Default values
        defaults = {
            "name": "",
            "hosts": "127.0.0.1",
            "port": 9042,
            "username": "",
            "password": "",
            "default_keyspace": "system_cluster_metadata",
            "ssl_enabled": False,
            "ssl_protocol": supported_ssl_protocols[0] if supported_ssl_protocols else "PROTOCOL_TLS",
            "ssl_cert_path": ""
        }

        # Load from selected connection if available
        selected_conn_name = st.session_state.get("selected_connection")
        if selected_conn_name and selected_conn_name != "Select...":
            profile = self._config.get_connection(selected_conn_name)
            if profile:
                defaults["name"] = profile.name
                defaults["hosts"] = ",".join(profile.hosts)
                defaults["port"] = profile.port
                defaults["username"] = profile.username or ""
                defaults["password"] = profile.password or ""
                defaults["default_keyspace"] = profile.default_keyspace or ""
                defaults["ssl_enabled"] = profile.ssl_enabled
                defaults["ssl_protocol"] = profile.ssl_protocol or defaults["ssl_protocol"]
                defaults["ssl_cert_path"] = profile.ssl_cert_path or ""

        # Use a suffix for keys to ensure form resets when selection changes
        key_suffix = selected_conn_name if selected_conn_name else "new"

        with st.form("connection_form"):
            st.caption(f"Editing: {selected_conn_name}" if selected_conn_name and selected_conn_name != "Select..." else "New Connection")
            
            name = st.text_input("Name", value=defaults["name"], key=f"conn_name_{key_suffix}")
            hosts = st.text_input("Hosts (comma-separated)", value=defaults["hosts"], key=f"conn_hosts_{key_suffix}")
            port = st.number_input("Port", value=defaults["port"], key=f"conn_port_{key_suffix}")
            username = st.text_input("Username", value=defaults["username"], key=f"conn_user_{key_suffix}")
            password = st.text_input("Password", value=defaults["password"], type="password", key=f"conn_pass_{key_suffix}")
            default_keyspace = st.text_input("Default Keyspace", value=defaults["default_keyspace"], key=f"conn_ks_{key_suffix}")
            
            # SSL
            ssl_enabled = st.checkbox("SSL Enabled", value=defaults["ssl_enabled"], key=f"conn_ssl_{key_suffix}")
            
            try:
                proto_index = supported_ssl_protocols.index(defaults["ssl_protocol"])
            except ValueError:
                proto_index = 0
                
            ssl_protocol = st.selectbox("SSL Protocol", supported_ssl_protocols, index=proto_index, key=f"conn_proto_{key_suffix}")
            ssl_cert_path = st.text_input("SSL certificate file if required", value=defaults["ssl_cert_path"], key=f"conn_cert_{key_suffix}")

            if st.form_submit_button("Save Connection"):
                profile = ConnectionProfile(
                    name=name,
                    hosts=[h.strip() for h in hosts.split(",")],
                    port=port,
                    username=username if username else None,
                    password=password if password else None,
                    ssl_enabled=ssl_enabled,
                    ssl_protocol=ssl_protocol if ssl_protocol else None,
                    ssl_cert_path=ssl_cert_path if ssl_cert_path else None,
                    default_keyspace=default_keyspace
                )
                self._config.add_connection(profile)
                st.success(f"Saved connection '{name}'")
                st.rerun()

    def _connect_to_profile(self, name: str):
        """Connect to the selected profile."""
        profile = self._config.get_connection(name)
        if profile:
            with st.spinner(f"Connecting to {name}..."):
                result = self._connection.connect(profile)
                if result.success:
                    st.session_state.schema_inspector = SchemaInspector(self._connection.session)
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

    def _render_data_grid(self):
        """Render the data grid and filters."""

        # Helper to add item
        def add_collection_item(col_name):
            if col_name not in st.session_state.collection_inputs:
                st.session_state.collection_inputs[col_name] = []
            st.session_state.collection_inputs[col_name].append("")

        # Helper to remove item
        def remove_collection_item(col_name, idx):
            if col_name in st.session_state.collection_inputs:
                st.session_state.collection_inputs[col_name].pop(idx)

        schema: TableSchema = st.session_state.current_table_schema
        # Determine visible columns
        visible_columns = []
        for col in schema.columns:
            meta = self._config.get_column_metadata(schema.keyspace, schema.table_name, col.name)
            if not meta.get("hide", False):
                visible_columns.append(col)

        # Filters
        with st.expander("Filters"):
            cols = st.columns(3)
            filter_params = {}
            for i, col in enumerate(schema.columns):
                # Simple filter implementation
                val = cols[i % 3].text_input(f"Filter {col.name}")
                if val:
                    filter_params[col.name] = val
        page_size = st.selectbox("Rows per page", [10, 25, 50], index=0, key="page_size_selector")
        
        # Query Data
        query = f"SELECT * FROM {schema.keyspace}.{schema.table_name}"
        
        # Reset pagination if filters change (simple detection)
        current_filter_hash = str(filter_params)
        if 'last_filter_hash' not in st.session_state or st.session_state.last_filter_hash != current_filter_hash:
            st.session_state.last_filter_hash = current_filter_hash
            st.session_state.paging_state = None
            st.session_state.page_history = []

        if filter_params:
            where_clauses = []
            for k, v in filter_params.items():
                # "text"
                if schema.column(k).cql_type == "text":
                    where_clauses.append(f"{k} = '{v}'")
                else:
                # "int", "bigint", "float", "double", "uuid", "boolean", "timestamp"
                    where_clauses.append(f"{k} = {v}")
            query += " WHERE " + " AND ".join(where_clauses) + " LIMIT " + str(page_size) + " ALLOW FILTERING"
            # Note: In a real app, handle type conversion for params
            rows = self._connection.execute(query,)
        else:
            rows = self._connection.execute(query + " LIMIT " + str(page_size))

        # Display Data
        records = [Record(schema, crow) for crow in rows]
        
        if records:
            # Custom grid rendering to support row actions
            st.write("### Data")
            df = pd.DataFrame([r.data for r in records])[[c.name for c in visible_columns]]
            for col in visible_columns:
                if col.is_set_or_list:
                    df[col.name] = df[col.name].apply(lambda x: list([str(u) for u in x]) if x else None)
            event = st.dataframe(data=df, on_select="rerun", selection_mode="single-row")
            if len(event.selection['rows']):
                selected_row = event.selection['rows'][0]
                render_form([st],
                            records[selected_row],
                            schema,
                            add_collection_item=add_collection_item,
                            remove_collection_item=remove_collection_item)
                self._render_row_details(records[selected_row])
        else:
            st.info("No data found.")

    @staticmethod
    def _confirm_delete(schema: TableSchema, row: Any):
        """Show confirmation dialog for deletion."""
        st.session_state.delete_target = {
            'schema': schema,
            'row': row
        }
        st.rerun()

    def _render_delete_confirmation(self):
        """Render delete confirmation dialog if needed."""
        if 'delete_target' in st.session_state:
            target = st.session_state.delete_target
            schema = target['schema']
            row = target['row']
            
            # Use a container at the top or a modal-like expander
            with st.container():
                st.warning("⚠️ Are you sure you want to delete this record?")
                st.json(row)  # Display the row data clearly
                
                col1, col2 = st.columns([1, 5])
                if col1.button("Yes, Delete", type="primary"):
                    self._delete_record(schema, row)
                    del st.session_state.delete_target
                    st.rerun()
                
                if col2.button("Cancel"):
                    del st.session_state.delete_target
                    st.rerun()

    def _render_row_details(self, row):
        """Render row details dialog if needed."""
        schema = st.session_state.current_table_schema

        with st.container():
            st.markdown("---")
            st.subheader("Edit Row Details")

            with st.form("edit_row_form"):
                updated_data = {}

                for col in schema.all_columns_sorted:
                    val = row.get(col.name)

                    # Determine input type based on CQL type
                    if col.cql_type in ('int', 'bigint', 'varint', 'smallint', 'tinyint', 'counter'):
                        updated_data[col.name] = st.number_input(f"{col.name} ({col.cql_type})", value=int(val) if val is not None else 0, disabled=col.is_primary_key)
                    elif col.cql_type in ('float', 'double', 'decimal'):
                        updated_data[col.name] = st.number_input(f"{col.name} ({col.cql_type})", value=float(val) if val is not None else 0.0, disabled=col.is_primary_key)
                    elif col.cql_type == 'boolean':
                        updated_data[col.name] = st.checkbox(f"{col.name} ({col.cql_type})", value=bool(val) if val is not None else False, disabled=col.is_primary_key)
                    elif col.cql_type.startswith('map<'):
                        with st.expander(f"{col.name} ({col.cql_type})"):
                            # Handle Map types
                            updated_data[col.name] = {}
                            meta = self._config.get_column_metadata(schema.keyspace, schema.table_name, col.name)
                            map_schema = dict([(item['key'],item['type']) for item in meta.get("map_schema", [])])
                            if map_schema:
                                for map_k, map_v in val.items():
                                    if map_k in map_schema:
                                        map_v_type = map_schema[map_k]
                                        if map_v_type in ('int', 'bigint', 'varint', 'smallint', 'tinyint',
                                                                 'counter'):
                                            updated_data[col.name][map_k] = st.number_input(f"{map_k} ({map_v_type})",
                                                                                     value=int(map_v) if map_v is not None else 0)
                                        elif map_v_type in ('float', 'double', 'decimal'):
                                            updated_data[col.name][map_k] = st.number_input(f"{map_k} ({map_v_type})",
                                                                                            value=float(map_v) if map_v is not None else 0.0)
                                        elif map_v_type == 'boolean':
                                            updated_data[col.name][map_k] = st.checkbox(f"{map_k} ({map_v_type})",
                                                                                        value=bool(map_v) if map_v is not None else False)
                                        else:
                                            updated_data[col.name][map_k] = st.text_input(f"{map_k} ({map_v_type})",
                                                                                          value=str(map_v) if map_v is not None else "")
                                    else:
                                        updated_data[col.name][map_k] = st.text_input(f"{map_k} (text)",
                                                                                      value=str(map_v) if map_v is not None else "")
                            else:
                                display_value = json.dumps(val, indent=2)
                                updated_data[col.name] = st.text_area(f"{col.name} ({col.cql_type})",
                                                                      value=display_value,
                                                                      height=150)

                    else:
                        # Default to text input
                        updated_data[col.name] = st.text_input(f"{col.name} ({col.cql_type})", value=str(val) if val is not None else "", disabled=col.is_primary_key)

                col1, col2 = st.columns([1, 5])
                if col1.form_submit_button("Save Changes", type="primary"):
                    self._update_record(schema, row, updated_data)
                    if st.session_state.__contains__("view_details_target"):
                        del st.session_state.view_details_target
                    st.rerun()

                if col2.form_submit_button("Cancel"):
                    if st.session_state.__contains__("view_details_target"):
                        del st.session_state.view_details_target
                    st.rerun()
            st.markdown("---")

    def _update_record(self, schema: TableSchema, original_row: Any, updated_data: Dict[str, Any]):
        """Update a record."""
        keyspace = schema.keyspace
        table = schema.table_name
        
        # Build SET clause
        set_parts = []
        set_values = []
        
        for col in schema.regular_columns:
            new_val = updated_data.get(col.name)
            
            # Handle Map types conversion back from JSON string
            if col.cql_type.startswith('map<'):
                try:
                    if isinstance(new_val, str):
                        new_val = json.loads(new_val)
                except json.JSONDecodeError:
                    st.error(f"Invalid JSON for column {col.name}")
                    return

            set_parts.append(f"{col.name} = %s")
            set_values.append(new_val)
            
        # Build WHERE clause using primary key from original row
        where_parts = []
        where_values = []
        for col in schema.primary_key_columns:
            val = original_row.get(col.name)
            where_parts.append(f"{col.name} = %s")
            where_values.append(val)
            
        if not set_parts:
            st.warning("No columns to update.")
            return

        query = f"UPDATE {keyspace}.{table} SET {', '.join(set_parts)} WHERE {' AND '.join(where_parts)}"
        
        try:
            self._connection.execute(query, tuple(set_values + where_values))
            st.success("Record updated successfully")
        except Exception as e:
            st.error(f"Update failed: {str(e)}")

    def _delete_record(self, schema: TableSchema, row: Any):
        """Delete a record."""
        keyspace = schema.keyspace
        table = schema.table_name
        
        # Build WHERE clause using primary key
        where_parts = []
        where_values = []
        for col in schema.primary_key_columns:
            # row is a dict
            val = row.get(col.name)
            where_parts.append(f"{col.name} = %s")
            where_values.append(val)
            
        query = f"DELETE FROM {keyspace}.{table} WHERE {' AND '.join(where_parts)}"
        
        try:
            self._connection.execute(query, tuple(where_values))
            st.success("Record deleted successfully")
        except Exception as e:
            st.error(f"Delete failed: {str(e)}")

    def _render_insert_form(self):
        """Render form for inserting new records."""
        schema: TableSchema = st.session_state.current_table_schema
        # Initialize collection inputs state if needed
        if 'collection_inputs' not in st.session_state:
            st.session_state.collection_inputs = {}

        # Helper to add item
        def add_collection_item(col_name):
            if col_name not in st.session_state.collection_inputs:
                st.session_state.collection_inputs[col_name] = []
            st.session_state.collection_inputs[col_name].append("")

        # Helper to remove item
        def remove_collection_item(col_name, idx):
            if col_name in st.session_state.collection_inputs:
                st.session_state.collection_inputs[col_name].pop(idx)

        # We need to use a container for the form content but buttons for adding items
        # must be outside the form because they trigger reruns.
        # So we'll collect data in a dictionary and have the submit button separately?
        # Streamlit forms don't allow buttons inside that trigger callbacks.
        # Strategy: Render inputs. If it's a collection, render dynamic inputs outside a strict st.form
        # or manage the whole thing without st.form for the collection parts.
        # To keep it simple and consistent, let's use a standard container and a final button.

        st.subheader("New Record")
        cols = st.columns(2)
        form_data = render_form(cols,
                                None,
                                schema,
                                add_collection_item=add_collection_item,
                                remove_collection_item=remove_collection_item)

        for i, col in enumerate(schema.columns):
            col_container = cols[i % 2]

        st.markdown("---")
        if st.button("Insert Record", type="primary"):
            # Filter out empty strings for standard inputs
            data = {k: v for k, v in form_data.items() if v}

            # Merge collection data (already filtered)
            # Note: form_data already contains collection data from above loop

            if data:
                self._insert_record(schema, data)
                # Clear collection inputs on success
                st.session_state.collection_inputs = {}
                st.rerun()
            else:
                st.warning("Please fill in at least one field.")

    def _render_table_info(self):
        """Render table schema information."""
        schema: TableSchema = st.session_state.current_table_schema
        st.subheader("Table Schema")
        
        # Header
        cols = st.columns([2, 2, 2, 2, 2])
        cols[0].markdown("**Column Name**")
        cols[1].markdown("**Type**")
        cols[2].markdown("**Key Type**")
        cols[3].markdown("**Hide in Data Browser**", help="Check to hide this column in the Data Browser tab. Useful for large columns like maps or lists.")
        cols[4].markdown("**Map Schema**", help="Define fixed schema for MAP columns.")

        for col in schema.all_columns_sorted:
            key_type = ""
            if col.is_partition_key:
                key_type = "Partition Key"
            elif col.is_clustering_key:
                key_type = f"Clustering Key ({col.clustering_order})"
            
            # Get current metadata state
            meta = self._config.get_column_metadata(schema.keyspace, schema.table_name, col.name)
            is_hidden = meta.get("hide", False)

            cols = st.columns([2, 2, 2, 2, 2])
            cols[0].write(col.name)
            cols[1].write(col.cql_type)
            cols[2].write(key_type)
            
            # Checkbox for hiding column
            new_hidden = cols[3].checkbox(
                "Hide", 
                value=is_hidden, 
                key=f"hide_{schema.keyspace}_{schema.table_name}_{col.name}",
                label_visibility="hidden"
            )
            
            # Update config if changed
            if new_hidden != is_hidden:
                self._config.set_column_metadata(
                    schema.keyspace, 
                    schema.table_name, 
                    col.name, 
                    "hide", 
                    new_hidden
                )
                st.rerun()

            # Map Schema Editor Button
            if col.cql_type.startswith("map<"):
                if cols[4].button("Edit Schema", key=f"edit_map_{col.name}"):
                    st.session_state.map_editor_target = {
                        'keyspace': schema.keyspace,
                        'table': schema.table_name,
                        'column': col.name,
                        'current_schema': meta.get("map_schema", [])
                    }
                    st.rerun()
            else:
                cols[4].write("-")

    def _render_map_schema_editor(self):
        """Render editor for Map column schema."""
        if 'map_editor_target' in st.session_state:
            target = st.session_state.map_editor_target
            keyspace = target['keyspace']
            table = target['table']
            column = target['column']
            current_schema = target['current_schema']
            
            # Use a modal-like container
            with st.container():
                st.markdown("---")
                st.subheader(f"Edit Map Schema for `{column}`")
                st.info("Define the fixed keys and their types for this MAP column. This helps in validating and displaying map data.")
                
                # Initialize working copy in session state if not present
                if 'map_schema_working_copy' not in st.session_state:
                    st.session_state.map_schema_working_copy = list(current_schema)

                working_copy = st.session_state.map_schema_working_copy
                
                # Display existing keys
                if working_copy:
                    st.write("Defined Keys:")
                    for i, item in enumerate(working_copy):
                        c1, c2, c3 = st.columns([3, 2, 1])
                        c1.text_input("Key", value=item['key'], key=f"map_key_{i}", disabled=True)
                        c2.text_input("Type", value=item['type'], key=f"map_type_{i}", disabled=True)
                        if c3.button("Remove", key=f"remove_map_key_{i}"):
                            working_copy.pop(i)
                            st.rerun()
                else:
                    st.write("No keys defined yet.")

                st.markdown("#### Add New Key")
                with st.form("add_map_key_form"):
                    c1, c2 = st.columns([3, 2])
                    new_key = c1.text_input("Key Name")
                    new_type = c2.selectbox("Value Type", [
                        "text", "int", "bigint", "boolean", "float", "double", "timestamp", "uuid"
                    ])
                    
                    if st.form_submit_button("Add Key"):
                        if new_key:
                            # Check for duplicates
                            if any(k['key'] == new_key for k in working_copy):
                                st.error(f"Key '{new_key}' already exists.")
                            else:
                                working_copy.append({"key": new_key, "type": new_type})
                                st.rerun()
                        else:
                            st.error("Key name cannot be empty.")

                # Save/Cancel Actions
                st.markdown("---")
                c1, c2 = st.columns([1, 5])
                
                if c1.button("Save Schema", type="primary"):
                    self._config.set_column_metadata(
                        keyspace, 
                        table, 
                        column, 
                        "map_schema", 
                        working_copy
                    )
                    del st.session_state.map_editor_target
                    if 'map_schema_working_copy' in st.session_state:
                        del st.session_state.map_schema_working_copy
                    st.success("Map schema saved!")
                    st.rerun()
                
                if c2.button("Cancel", key="cancel_map_edit"):
                    del st.session_state.map_editor_target
                    if 'map_schema_working_copy' in st.session_state:
                        del st.session_state.map_schema_working_copy
                    st.rerun()

    def _insert_record(self, schema: TableSchema, data: Dict[str, Any]):
        """Execute insert query."""
        keyspace = schema.keyspace
        table = schema.table_name

        columns = []
        placeholders = []
        for k, v in data.items():
            value = v['value']
            if value and value != '':
                columns.append(k)
                if schema.column(k).is_text:
                    placeholders.append(f"'{value}'")
                elif schema.column(k).cql_type == 'date':
                    placeholders.append(f"'{value.strftime('%Y-%m-%d')}'")
                elif schema.column(k).cql_type == 'datetime' or schema.column(k).cql_type == 'timestamp':
                    placeholders.append(f"'{value.strftime('%Y-%m-%d %H:%M:%S.%f')}'")
                elif schema.column(k).cql_type.startswith("list<"):
                    placeholders.append(f"{str(value)}")
                elif schema.column(k).cql_type.startswith("set<"):
                    placeholders.append(str(set(value)))
                else:
                    placeholders.append(str(value))

        query = f"INSERT INTO {keyspace}.{table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
        try:
            # Note: Type conversion should be handled here
            self._connection.execute(query, data)
            st.success("Record inserted successfully")
        except Exception as e:
            st.error(f"Insert failed: {str(e)}")

    def _render_cql_editor(self):
        """Render CQL Editor tab."""
        st.subheader("CQL Editor")
        
        # Query Input
        query = st.text_area("Enter CQL Query", height=150, help="Type your CQL query here.")
        
        # Options
        col1, col2 = st.columns([1, 3])
        extended_mode = col1.checkbox("Extended Mode", help="Show results in extended format (stacked columns). Limits results to 10.")
        
        if st.button("Execute", type="primary"):
            if not query.strip():
                st.warning("Please enter a query.")
                return
                
            # Handle Extended Mode Limit
            final_query = query
            if extended_mode:
                # Check for existing LIMIT
                limit_match = re.search(r'\bLIMIT\s+(\d+)', final_query, re.IGNORECASE)
                if limit_match:
                    st.warning(f"Extended mode overrides LIMIT {limit_match.group(1)} with LIMIT 10.")
                    final_query = re.sub(r'\bLIMIT\s+\d+', 'LIMIT 10', final_query, flags=re.IGNORECASE)
                else:
                    final_query += " LIMIT 10"
            
            try:
                # Execute Query
                # Note: We don't use pagination here as per typical editor behavior, 
                # but we could add it if needed. For extended mode, it's limited to 10 anyway.
                rows = self._connection.execute(final_query)
                data = list(rows)
                
                if not data:
                    st.info("Query executed successfully. No results returned.")
                else:
                    st.success(f"Query executed successfully. Returned {len(data)} rows.")
                    
                    if extended_mode:
                        # Extended Mode Rendering
                        for i, row in enumerate(data):
                            with st.container():
                                st.markdown(f"**Row {i+1}**")
                                # Create a DataFrame for the single row to display as key-value pairs
                                row_data = [{"Column": k, "Value": str(v)} for k, v in row.items()]
                                st.table(row_data)
                                st.markdown("---")
                    else:
                        # Standard Mode Rendering
                        df = pd.DataFrame(data)
                        st.dataframe(df, use_container_width=True)
                        
            except Exception as e:
                st.error(f"Error executing query: {str(e)}")
