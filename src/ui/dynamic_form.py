"""
Dynamic Form Generation Module

Generates form widgets dynamically based on Cassandra table schema.
Handles type-specific input widgets, validation, and data conversion.
"""
from datetime import datetime, date, time
from typing import Optional, Any, Dict

import streamlit as st

from database.model import TableSchema, ColumnInfo
from utils.type_mapping import get_type_info, convert_value, format_value_for_display


def render_dynamic_form(schema: TableSchema, record: Optional[Dict[str, Any]] = None, mode: str = "insert") -> Optional[
    Dict[str, Any]]:
    """
    Renders a dynamic form for a Cassandra table schema.

    Args:
        schema: The table schema.
        record: Optional dictionary of existing data (for updates).
        mode: "insert" or "update".

    Returns:
        A dictionary of the form data if submitted, None otherwise.
    """
    form_data = {}

    # Use a form to group inputs and avoid premature reruns
    with st.form(key=f"dynamic_form_{schema.keyspace}_{schema.table_name}_{mode}"):
        st.subheader(f"{mode.capitalize()} Record: {schema.table_name}")

        # Primary Key Section
        st.markdown("### Primary Key (Required)")
        for col in schema.primary_key_columns:
            value = record.get(col.name) if record else None
            # Primary keys are read-only in update mode
            disabled = (mode == "update")
            form_data[col.name] = _render_field(col, value, disabled=disabled, key_prefix=f"{mode}_pk")

        # Regular Columns Section
        if schema.regular_columns:
            st.markdown("### Columns")
            for col in schema.regular_columns:
                value = record.get(col.name) if record else None
                form_data[col.name] = _render_field(col, value, key_prefix=f"{mode}_reg")

        # Submit Button
        submit_label = "Insert Record" if mode == "insert" else "Update Record"
        submitted = st.form_submit_button(submit_label, type="primary")

    if submitted:
        # Validate and Convert
        try:
            processed_data = {}
            for col_name, raw_value in form_data.items():
                # Skip empty values for non-PKs if you want, or handle defaults.
                # For now, we pass everything to convert_value which handles None/empty.

                # Basic validation for PKs
                is_pk = any(c.name == col_name for c in schema.primary_key_columns)
                if is_pk and (raw_value is None or raw_value == ''):
                    # UUIDs might be auto-generated later in convert_value if empty,
                    # but typically we want to ensure they are present or generated.
                    # The convert_value logic for UUID generates one if empty.
                    pass

                # Convert
                col_type = schema.column(col_name).cql_type
                if raw_value is not None:
                    processed_data[col_name] = convert_value(raw_value, col_type)

            return processed_data

        except Exception as e:
            st.error(f"Error processing form: {e}")
            return None

    return None


def _render_field(column: ColumnInfo, value: Any, disabled: bool = False, key_prefix: str = "") -> Any:
    """
    Renders a single form field based on column type.

    Args:
        column: The column info.
        value: The initial value.
        disabled: Whether the field is disabled.
        key_prefix: Prefix for the widget key to ensure uniqueness.

    Returns:
        The current value of the widget.
    """
    type_info = get_type_info(column.cql_type)
    widget_type = type_info.get('widget', 'lineedit')

    # Unique key for the widget
    key = f"{key_prefix}_{column.name}"
    label = f"{column.name} ({column.cql_type})"

    if widget_type == 'number_input':
        # Streamlit number_input defaults to float, need to enforce int step
        min_val = type_info.get('min', -2147483648)
        max_val = type_info.get('max', 2147483647)
        # Ensure value is within range and int
        val = int(value) if value is not None else 0
        return st.number_input(label, min_value=min_val, max_value=max_val, value=val, step=1, disabled=disabled,
                               key=key)

    elif widget_type == 'double_input':
        val = float(value) if value is not None else 0.0
        return st.number_input(label, value=val, format="%.6f", disabled=disabled, key=key)

    elif widget_type == 'checkbox':
        val = bool(value) if value is not None else False
        return st.checkbox(label, value=val, disabled=disabled, key=key)
    elif widget_type == 'map_edit':
        with st.expander(label):
            return render_json_editor(dict(value) if value else dict(), path=key)
        # val = json.dumps(dict(value), indent=2) if value else "{}"
        # placeholder = type_info.get('placeholder', '')
        # return st.text_area(label, value=val, placeholder=placeholder, disabled=disabled,
        #                     key=f"should_be_deleted_{key}")
    elif widget_type == 'textedit':
        # For text, json, blobs, etc.
        val = format_value_for_display(value, column.cql_type)
        placeholder = type_info.get('placeholder', '')
        return st.text_area(label, value=val, placeholder=placeholder, disabled=disabled, key=key)

    elif widget_type == 'datetime':
        # Streamlit splits date and time. 
        # We'll use a text input for simplicity to handle full ISO strings or custom formats,
        # OR we could use date_input + time_input. 
        # Given Cassandra timestamps can be complex, text input with validation is often safer,
        # but let's try to be user-friendly.

        val = value
        if isinstance(val, str):
            # noinspection PyBroadException
            try:
                val = datetime.fromisoformat(val)
            except:
                pass

        # If we have a datetime object
        if isinstance(val, datetime):
            d_val = val.date()
            t_val = val.time()
        else:
            d_val = datetime.now().date()
            t_val = datetime.now().time()

        c1, c2 = st.columns(2)
        with c1:
            d_input = st.date_input(f"{label} (Date)", value=d_val, disabled=disabled, key=f"{key}_date")
        with c2:
            t_input = st.time_input(f"{label} (Time)", value=t_val, disabled=disabled, key=f"{key}_time")

        # Combine back to datetime
        return datetime.combine(d_input, t_input)

    elif widget_type == 'date':
        val = value
        if isinstance(val, str):
            # noinspection PyBroadException
            try:
                val = date.fromisoformat(val)
            except:
                pass

        if not isinstance(val, date):
            val = datetime.now().date()

        return st.date_input(label, value=val, disabled=disabled, key=key)

    elif widget_type == 'time':
        val = value
        if isinstance(val, str):
            # noinspection PyBroadException
            try:
                val = time.fromisoformat(val)
            except:
                pass

        if not isinstance(val, time):
            val = datetime.now().time()

        return st.time_input(label, value=val, disabled=disabled, key=key)

    else:  # Default: lineedit (text_input)
        val = format_value_for_display(value, column.cql_type)
        placeholder = type_info.get('placeholder', '')
        return st.text_input(label, value=val, placeholder=placeholder, disabled=disabled, key=key)

# ---------------------------
# Recursive Renderer
# ---------------------------
def render_json_editor(data, path="root", label=None):
    label = label if label else path
    if isinstance(data, dict):

        keys_to_delete = []
        updated_dict = {}

        for key in list(data.keys()):
            value = data[key]

            # Recursive rendering
            updated_value = render_json_editor(value, f"{path}_{key}", label=key)
            updated_dict[key] = updated_value

        return updated_dict

    # ---------------------------
    # LIST
    # ---------------------------
    elif isinstance(data, list):

        updated_list = []

        for i, item in enumerate(data):
            col1, col2 = st.columns([5, 1])

            with col1:
                updated_item = render_json_editor(item, f"{path}_{i}")

            # with col2:
            #     if st.button("❌", key=f"del_{path}_{i}"):
            #         data.pop(i)
            #         st.rerun()

            updated_list.append(updated_item)

        # if st.button(f"➕ Add item to {path}", key=f"additem_{path}"):
        #     data.append("")
        #     st.rerun()

        return updated_list

    # ---------------------------
    # PRIMITIVES
    # ---------------------------
    elif isinstance(data, str):
        return st.text_input(label, value=data, key=path)

    elif isinstance(data, int):
        return st.number_input(label, value=data, step=1, key=path)

    elif isinstance(data, float):
        return st.number_input(label, value=data, key=path)

    elif isinstance(data, bool):
        return st.checkbox(label, value=data, key=path)

    else:
        return data
