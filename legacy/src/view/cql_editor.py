import re

import pandas as pd
import streamlit as st


def render_cql_editor(execute_callback):
    """Render CQL Editor tab."""
    st.subheader("CQL Editor")
    query = st.text_area("Enter CQL Query", height=150)
    extended_mode = st.checkbox("Extended Mode", help="Show results in extended format. Limits results to 10.")

    if st.button("Execute", type="primary"):
        if not query.strip():
            st.warning("Please enter a query.")
            return

        final_query = query
        if extended_mode:
            if not re.search(r'\bLIMIT\s+\d+', final_query, re.IGNORECASE):
                final_query += " LIMIT 10"

        try:
            results = execute_callback(final_query)
            if not results:
                st.info("Query executed successfully. No results returned.")
            else:
                st.success(f"Query executed successfully. Returned {len(results)} rows.")
                if extended_mode:
                    for i, row in enumerate(results):
                        st.markdown(f"**Row {i + 1}**")
                        st.table([{"Column": k, "Value": str(v)} for k, v in row.items()])
                else:
                    st.dataframe(pd.DataFrame(results), use_container_width=True)
        except Exception as e:
            st.error(f"Error executing query: {e}")