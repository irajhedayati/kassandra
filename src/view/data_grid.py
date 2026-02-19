from typing import Dict

import pandas as pd
import streamlit as st

from src.database.model import TableSchema
from src.view.form import render_row_details


def render_data_grid(schema: TableSchema, callbacks: Dict):
    """Render the data grid and filters."""
    config_manager = st.session_state.config_manager
    with st.expander("Filters"):
        cols = st.columns(3)
        filter_params = {}
        for i, col in enumerate(schema.columns):
            val = cols[i % 3].text_input(f"Filter {col.name}")
            if val:
                filter_params[col.name] = val

    page_size = st.selectbox("Rows per page", [10, 25, 50], index=0, key="page_size_selector")

    records = callbacks['get_records'](schema, filter_params, page_size)

    if records:
        visible_columns = []
        for c in schema.columns:
            if not config_manager.get_column_metadata(schema.keyspace, schema.table_name, c.name).get("hide", False):
                visible_columns.append(c)

        df = pd.DataFrame([r.data for r in records])[[c.name for c in visible_columns]]
        for col in visible_columns:
            if col.is_set_or_list:
                df[col.name] = df[col.name].apply(lambda x: list([str(u) for u in x]) if x else None)

        event = st.dataframe(data=df, on_select="rerun", selection_mode="single-row")
        if len(event.selection['rows']):
            selected_row_index = event.selection['rows'][0]
            selected_record = records[selected_row_index]
            render_row_details(selected_record, callbacks)
    else:
        st.info("No data found.")