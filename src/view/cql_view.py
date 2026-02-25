import streamlit as st
import pandas as pd
from streamlit_monaco import st_monaco

def render(execute_callback):
    """
    Renders the CQL Editor component in an expandable section.
    
    Args:
        execute_callback: Function to execute CQL queries.
    """
    with st.expander("CQL Editor", expanded=False):
        st.caption("Execute custom CQL queries against the connected cluster.")
        
        query = st_monaco(value="", language="sql", theme="vs-light")

        if st.button("Execute Query", key="cql_editor_btn"):
            if not query.strip():
                st.warning("Please enter a query.")
                return

            # noinspection PyTypeChecker
            with st.spinner("Executing..."):
                result = execute_callback(query)
            
            if result.success:
                st.success("Query executed successfully")
                if result.data:
                    # Convert to DataFrame for better display
                    st.dataframe(pd.DataFrame(result.data), use_container_width=True)
                else:
                    st.info("No rows returned.")
            else:
                st.error(f"Error: {result.message}")