import pandas as pd
import streamlit as st

def render_delete_confirmation(delete_callback):
    """Render delete confirmation dialog."""
    if 'delete_target' in st.session_state:
        target = st.session_state.delete_target
        with st.container():
            st.warning("⚠️ Are you sure you want to delete this record?")
            st.json(target['row'])

            col1, col2 = st.columns([1, 5])
            if col1.button("Yes, Delete", type="primary"):
                try:
                    delete_callback(target['schema'], target['row'])
                    st.success("Record deleted successfully")
                except Exception as e:
                    st.error(f"Delete failed: {e}")
                del st.session_state.delete_target
                st.rerun()

            if col2.button("Cancel"):
                del st.session_state.delete_target
                st.rerun()


def render_map_schema_editor(config_manager):
    """Render the map schema editor dialog."""
    if 'map_editor_target' not in st.session_state:
        return

    target = st.session_state.map_editor_target
    keyspace = target['keyspace']
    table = target['table']
    column = target['column']
    current_schema = target['current_schema']

    st.markdown("---")
    st.subheader(f"Edit Map Schema: `{column}`")
    st.caption("Define the known keys for this map column and their display labels.")

    df = pd.DataFrame(current_schema if current_schema else [], columns=["key", "label"]).astype(str).replace("nan", "")
    edited_df = st.data_editor(
        df,
        num_rows="dynamic",
        use_container_width=True,
        key="map_schema_editor",
        column_config={
            "key": st.column_config.TextColumn("Map Key", help="The key name in the Cassandra map"),
            "label": st.column_config.TextColumn("Display Label", help="Human-readable label shown in the UI"),
        },
    )

    col1, col2 = st.columns([1, 5])
    with col1:
        if st.button("Save", type="primary", key="map_schema_save"):
            new_schema = edited_df.dropna(how="all").to_dict("records")
            config_manager.set_column_metadata(keyspace, table, column, "map_schema", new_schema)
            del st.session_state.map_editor_target
            st.rerun()
    with col2:
        if st.button("Cancel", key="map_schema_cancel"):
            del st.session_state.map_editor_target
            st.rerun()
