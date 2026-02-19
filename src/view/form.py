from typing import Any, Dict

import streamlit as st

from src.database.model import Record, TableSchema
from src.ui.dynamic_form import render_dynamic_form


def render_insert_form(schema: TableSchema, insert_callback):
    """Render form for inserting new records."""
    data = render_dynamic_form(schema, mode="insert")
    if data:
        try:
            insert_callback(schema, data)
            st.success("Record inserted successfully")
            st.rerun()
        except Exception as e:
            st.error(f"Insert failed: {e}")


def render_row_details(record: Record, callbacks: Dict):
    """Render row details and edit form."""
    st.markdown("---")
    
    # Update Form
    data = render_dynamic_form(record.schema, record.data, mode="update")
    
    if data:
        try:
            callbacks['update'](record.schema, record.data, data)
            st.success("Record updated successfully")
            st.rerun()
        except Exception as e:
            st.error(f"Update failed: {e}")

    # Delete Action
    st.markdown("### Actions")
    col1, col2 = st.columns([1, 5])
    with col1:
        if st.button("Delete Record", type="secondary", key=f"del_{record.key}"):
            st.session_state.delete_target = {'schema': record.schema, 'row': record.data}
            st.rerun()
