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