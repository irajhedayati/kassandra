"""
Main View for Cassandra GUI

Handles all UI rendering for the Streamlit application.
"""
from typing import Dict, List

import streamlit as st

from config.settings import ConnectionProfile
from database.model import TableSchema
from view.connection_form import render_connection_form
from view.cql_editor import render_cql_editor
from view.data_grid import render_data_grid
from view.form import render_insert_form
from view.table_info import render_table_info


def render_main_content(is_connected: bool, schema: TableSchema, data_callbacks: Dict, cql_callbacks: Dict):
    """Render the main content area."""
    if not is_connected:
        st.info("Please select a connection and click 'Connect' to start.")
        return

    if schema:
        st.header(f"Table: {schema.keyspace}.{schema.table_name}")
        tab1, tab2, tab3, tab4 = st.tabs(["Data Browser", "Insert Record", "Table Info", "CQL Editor"])

        with tab1:
            render_data_grid(schema, data_callbacks)
        with tab2:
            render_insert_form(schema, data_callbacks['insert'])
        with tab3:
            render_table_info(schema)
        with tab4:
            render_cql_editor(cql_callbacks['execute'])
    else:
        st.info('Select a keyspace and table from the sidebar to view data.')


def render_sidebar(connections: List[ConnectionProfile],
                   is_connected: bool,
                   connect_callback,
                   disconnect_callback,
                   schema_inspector):
    """Render the sidebar for navigation and connection management."""
    with st.sidebar:
        st.title("Cassandra GUI")
        st.header("Connections")

        connection_names = [c.name for c in connections]
        selected_conn = st.selectbox(
            "Select Connection",
            ["Select..."] + connection_names,
            key="selected_connection"
        )

        col1, col2 = st.columns(2)
        with col1:
            if st.button("Connect", disabled=selected_conn == "Select..."):
                connect_callback(selected_conn)
        with col2:
            if st.button("Disconnect", disabled=not is_connected):
                disconnect_callback()

        with st.expander("Manage Connections"):
            render_connection_form(connections)

        if is_connected and schema_inspector:
            st.divider()
            st.header("Schema")

            keyspaces = schema_inspector.get_keyspaces()
            default_ks = st.session_state.get('default_keyspace', None)
            idx = keyspaces.index(default_ks) if default_ks and default_ks in keyspaces else 0

            selected_ks = st.selectbox("Keyspace", keyspaces, index=idx, key="selected_keyspace")

            if selected_ks:
                tables = schema_inspector.get_tables(selected_ks)
                st.selectbox("Table", tables, key="selected_table")

                if st.button("Refresh", help="Refresh the list of tables", use_container_width=True):
                    st.rerun()
