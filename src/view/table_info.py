import streamlit as st

from database.model import TableSchema


def render_table_info(schema: TableSchema):
    """Render table schema information."""
    config_manager = st.session_state.config_manager
    st.subheader("Table Schema")
    cols = st.columns([2, 2, 2, 1, 1])
    cols[0].markdown("**Column Name**")
    cols[1].markdown("**Type**")
    cols[2].markdown("**Key Type**")
    cols[3].markdown("**Hide**")
    cols[4].markdown("**Map Schema**")

    with cols[0]:
        for col in schema.all_columns_sorted:
            st.text_input("Name", col.name,
                          label_visibility="collapsed",
                          disabled=True,
                          key=f"schema_{col.name}_name")

    with cols[1]:
        for col in schema.all_columns_sorted:
            if col.cql_type == "text":
                st.selectbox("Text Field Type",
                             options=["text"],
                             key=f"schema_{col.name}_type",
                             disabled=True,
                             label_visibility="collapsed")
            else:
                st.text_input("Field Type",
                              col.cql_type,
                              label_visibility="collapsed",
                              disabled=True,
                              key=f"schema_{col.name}_type")

    with cols[2]:
        for col in schema.all_columns_sorted:
            if col.is_partition_key:
                key_type = "Partition Key"
            elif col.is_clustering_key:
                key_type = f"Clustering Key ({col.clustering_order})"
            else:
                key_type = "-"
            st.text_input("Key Type",
                          key_type,
                          label_visibility="collapsed",
                          disabled=True,
                          key=f"schema_{col.name}_key")

    with cols[3]:
        for col in schema.all_columns_sorted:
            meta = config_manager.get_column_metadata(schema.keyspace, schema.table_name, col.name)
            is_hidden = meta.get("hide", False)
            new_hidden = st.checkbox("Hide",
                                     value=is_hidden,
                                     key=f"hide_{schema.keyspace}_{schema.table_name}_{col.name}")
            if new_hidden != is_hidden:
                config_manager.set_column_metadata(schema.keyspace, schema.table_name, col.name, "hide", new_hidden)
                st.rerun()
            st.write("")

    with cols[4]:
        for col in schema.all_columns_sorted:
            meta = config_manager.get_column_metadata(schema.keyspace, schema.table_name, col.name)
            if col.cql_type.startswith("map<"):
                if st.button("Edit Schema", key=f"edit_map_{col.name}"):
                    st.session_state.map_editor_target = {'keyspace': schema.keyspace, 'table': schema.table_name,
                                                          'column': col.name,
                                                          'current_schema': meta.get("map_schema", [])}
                    st.rerun()
            else:
                st.text_input("N/A",
                              key_type,
                              label_visibility="collapsed",
                              disabled=True,
                              key=f"schema_{col.name}_map")
