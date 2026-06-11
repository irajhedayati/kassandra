from typing import List

import streamlit as st

from config.settings import ConnectionProfile
from database.connection import CassandraConsistencyLevel
from utils.ssl import supported_ssl_protocols


def render_connection_form(connections: List[ConnectionProfile]):
    """Render form for adding/editing connections."""
    config_manager = st.session_state.config_manager
    defaults = {
        "name": "",
        "hosts": "127.0.0.1",
        "port": 9042,
        "username": "",
        "password": "",
        "default_keyspace": "system_cluster_metadata",
        "ssl_enabled": False,
        "ssl_protocol": supported_ssl_protocols[0] if supported_ssl_protocols else "PROTOCOL_TLS",
        "ssl_cert_path": "",
        "consistency_level": CassandraConsistencyLevel.LOCAL_ONE.name,
        "connection_timeout": 5,
        "protocol_version": 5,
    }

    selected_conn_name = st.session_state.get("selected_connection")
    if selected_conn_name and selected_conn_name != "Select...":
        profile = next((c for c in connections if c.name == selected_conn_name), None)
        if profile:
            defaults.update(profile.to_dict())
            defaults["hosts"] = ",".join(profile.hosts)

    key_suffix = selected_conn_name if selected_conn_name else "new"

    with st.form("connection_form"):
        st.caption(f"Editing: {selected_conn_name}" if selected_conn_name and selected_conn_name != "Select..." else "New Connection")

        name = st.text_input("Name", value=defaults["name"], key=f"conn_name_{key_suffix}")
        hosts = st.text_input("Hosts (comma-separated)", value=defaults["hosts"], key=f"conn_hosts_{key_suffix}")
        port = st.number_input("Port", value=defaults["port"], key=f"conn_port_{key_suffix}")
        username = st.text_input("Username", value=defaults["username"], key=f"conn_user_{key_suffix}")
        password = st.text_input("Password", value=defaults["password"], type="password", key=f"conn_pass_{key_suffix}")
        default_keyspace = st.text_input("Default Keyspace", value=defaults["default_keyspace"],
                                         key=f"conn_ks_{key_suffix}")
        # Consistency Level
        consistency_levels = list([level.name for level in CassandraConsistencyLevel])
        try:
            cl_index = consistency_levels.index(defaults["consistency_level"])
        except ValueError:
            cl_index = consistency_levels.index("LOCAL_ONE")

        consistency_level = st.selectbox("Consistency Level", consistency_levels, index=cl_index, key=f"conn_cl_{key_suffix}")

        # SSL
        ssl_enabled = st.checkbox("SSL Enabled", value=defaults["ssl_enabled"], key=f"conn_ssl_{key_suffix}")
        if defaults["ssl_protocol"] in supported_ssl_protocols:
            proto_index = supported_ssl_protocols.index(defaults["ssl_protocol"])
        else:
            proto_index = 0
        ssl_protocol = st.selectbox("SSL Protocol", supported_ssl_protocols, index=proto_index,
                                    key=f"conn_proto_{key_suffix}")
        ssl_cert_path = st.text_input("SSL certificate file if required", value=defaults["ssl_cert_path"],
                                      key=f"conn_cert_{key_suffix}")

        # Connection Timeout
        connection_timeout = st.number_input("Connection Timeout (seconds)",
                                            value=int(defaults["connection_timeout"]),
                                            min_value=1,
                                            max_value=300,
                                            step=1,
                                            key=f"conn_timeout_{key_suffix}")

        # Protocol Version
        protocol_version = st.selectbox("Native Protocol Version",
                                        options=[3, 4, 5],
                                        index=[3, 4, 5].index(int(defaults["protocol_version"])),
                                        key=f"conn_proto_ver_{key_suffix}")

        if st.form_submit_button("Save Connection"):
            new_profile = ConnectionProfile(
                name=name,
                hosts=[h.strip() for h in hosts.split(",")],
                port=port,
                username=username or None,
                password=password or None,
                ssl_enabled=ssl_enabled,
                ssl_protocol=ssl_protocol or None,
                ssl_cert_path=ssl_cert_path or None,
                default_keyspace=default_keyspace,
                consistency_level=consistency_level,
                connection_timeout=connection_timeout,
                protocol_version=protocol_version,
            )
            config_manager.add_connection(new_profile)
            st.success(f"Saved connection '{name}'")
            st.rerun()