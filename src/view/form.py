import json
from typing import Any, Dict, List

import streamlit as st
from streamlit.delta_generator import DeltaGenerator

from src.database.model import Record, TableSchema


def render_form(cols: List[DeltaGenerator], row: Record | None, schema: TableSchema, **kwargs) -> Dict[str, Any]:
    """Creates a form to show and/or edit data returning a dictionary for column values"""
    col_size = len(cols)
    form_data = {}
    for i, col in enumerate(schema.partition_keys):
        form_data[col.name] = schema.cql_col_input(row.get(col.name) if row else None, cols[i % col_size], col, **kwargs)
    offset = len(schema.primary_key_columns) - 1
    for i, col in enumerate(schema.clustering_keys):
        form_data[col.name] = schema.cql_col_input(row.get(col.name) if row else None, cols[i % col_size], col, **kwargs)
    offset += len(schema.clustering_keys) - 1
    for i, col in enumerate(schema.regular_columns):
        form_data[col.name] = schema.cql_col_input(row.get(col.name) if row else None, cols[i % col_size], col, **kwargs)
    return form_data


def render_insert_form(schema: TableSchema, insert_callback):
    """Render form for inserting new records."""
    st.subheader("New Record")

    if 'collection_inputs' not in st.session_state:
        st.session_state.collection_inputs = {}

    def add_collection_item(col_name):
        if col_name not in st.session_state.collection_inputs:
            st.session_state.collection_inputs[col_name] = []
        st.session_state.collection_inputs[col_name].append("")

    def remove_collection_item(col_name, idx):
        if col_name in st.session_state.collection_inputs:
            st.session_state.collection_inputs[col_name].pop(idx)

    cols = st.columns(2)
    form_data = render_form(cols, None, schema, add_collection_item=add_collection_item,
                            remove_collection_item=remove_collection_item)

    if st.button("Insert Record", type="primary"):
        data = {k: v for k, v in form_data.items() if v and v.get('value') is not None}
        if data:
            try:
                insert_callback(schema, data)
                st.success("Record inserted successfully")
                st.session_state.collection_inputs = {}
                st.rerun()
            except Exception as e:
                st.error(f"Insert failed: {e}")
        else:
            st.warning("Please fill in at least one field.")

def render_row_details(record: Record, callbacks: Dict):
    """Render row details and edit form."""
    st.markdown("---")
    st.subheader("Edit Row Details")
    schema = record.schema

    with st.form("edit_row_form"):
        updated_data = {}
        for col in schema.all_columns_sorted:
            val = record.get(col.name)

            if col.is_primary_key:
                st.text_input(f"{col.name} ({col.cql_type})", value=str(val) if val is not None else "", disabled=True)
                continue

            if col.cql_type in ('int', 'bigint', 'varint', 'smallint', 'tinyint', 'counter'):
                updated_data[col.name] = st.number_input(f"{col.name} ({col.cql_type})",
                                                         value=int(val) if val is not None else 0)
            elif col.cql_type in ('float', 'double', 'decimal'):
                updated_data[col.name] = st.number_input(f"{col.name} ({col.cql_type})",
                                                         value=float(val) if val is not None else 0.0)
            elif col.cql_type == 'boolean':
                updated_data[col.name] = st.checkbox(f"{col.name} ({col.cql_type})",
                                                     value=bool(val) if val is not None else False)
            elif col.cql_type.startswith('map<'):
                display_value = json.dumps(val, indent=2) if val else "{}"
                updated_data[col.name] = st.text_area(f"{col.name} ({col.cql_type})", value=display_value, height=150)
            else:
                updated_data[col.name] = st.text_input(f"{col.name} ({col.cql_type})",
                                                       value=str(val) if val is not None else "")

        col1, col2, col3 = st.columns([1, 1, 4])
        if col1.form_submit_button("Save Changes", type="primary"):
            try:
                callbacks['update'](schema, record.data, updated_data)
                st.success("Record updated successfully")
                st.rerun()
            except Exception as e:
                st.error(f"Update failed: {e}")

        if col2.form_submit_button("Delete"):
            st.session_state.delete_target = {'schema': schema, 'row': record.data}
            st.rerun()

        if col3.form_submit_button("Cancel"):
            st.rerun()