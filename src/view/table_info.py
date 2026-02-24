import streamlit as st

from database.model import TableSchema


def render_table_info(schema: TableSchema):
    """Render table schema information."""
    config_manager = st.session_state.config_manager
    st.subheader("Table Schema")
    cols = st.columns([2, 2, 2, 2, 2])
    cols[0].markdown("**Column Name**")
    cols[1].markdown("**Type**")
    cols[2].markdown("**Key Type**")
    cols[3].markdown("**Hide in Data Browser**")
    cols[4].markdown("**Map Schema**")

    for col in schema.all_columns_sorted:
        key_type = "Partition Key" if col.is_partition_key else f"Clustering Key ({col.clustering_order})" if col.is_clustering_key else ""
        meta = config_manager.get_column_metadata(schema.keyspace, schema.table_name, col.name)
        is_hidden = meta.get("hide", False)

        cols = st.columns([2, 2, 2, 2, 2])
        cols[0].write(col.name)
        cols[1].write(col.cql_type)
        cols[2].write(key_type)

        new_hidden = cols[3].checkbox("Hide", value=is_hidden,
                                      key=f"hide_{schema.keyspace}_{schema.table_name}_{col.name}",
                                      label_visibility="hidden")
        if new_hidden != is_hidden:
            config_manager.set_column_metadata(schema.keyspace, schema.table_name, col.name, "hide", new_hidden)
            st.rerun()

        if col.cql_type.startswith("map<"):
            if cols[4].button("Edit Schema", key=f"edit_map_{col.name}"):
                st.session_state.map_editor_target = {'keyspace': schema.keyspace, 'table': schema.table_name,
                                                      'column': col.name, 'current_schema': meta.get("map_schema", [])}
                st.rerun()
        else:
            cols[4].write("-")