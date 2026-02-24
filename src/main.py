"""
Cassandra GUI Client - Streamlit Entry Point

A web-based graphical client for Apache Cassandra with full schema-driven CRUD support.
"""

import streamlit as st
from app import CassandraGUIApp

def main():
    """Initialize and run the Streamlit application."""
    st.set_page_config(
        page_title="Cassandra GUI Client",
        page_icon="🗄️",
        layout="wide",
        initial_sidebar_state="expanded"
    )
    st.write(
        '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.2.0/css/all.min.css"/>',
        unsafe_allow_html=True)
    app = CassandraGUIApp()
    app.run()

if __name__ == "__main__":
    main()
