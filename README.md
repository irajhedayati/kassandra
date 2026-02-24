# py-sandra: Cassandra GUI Client

A modern, web-based graphical client for Apache Cassandra built with Python and Streamlit. It provides full schema-driven CRUD support, schema introspection, and a CQL editor.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.12%2B-blue)
![Streamlit](https://img.shields.io/badge/streamlit-1.30%2B-red)

## Features

*   **Connection Management**: Manage multiple Cassandra connection profiles with support for authentication and SSL.
*   **Schema Navigation**: Browse keyspaces and tables dynamically.
*   **Data Browser**:
    *   View table data with pagination (10, 25, 50 rows).
    *   Filter data by partition keys.
    *   Delete rows directly from the grid.
    *   Hide specific columns (e.g., large maps) via configuration.
*   **CRUD Operations**:
    *   Insert new records with auto-generated forms based on table schema.
    *   Delete records safely with confirmation.
*   **Schema Tools**:
    *   View detailed table schema (partition keys, clustering keys, types).
    *   **Map Schema Editor**: Define fixed schemas for `MAP` columns to validate and manage key-value pairs easily.
*   **CQL Editor**:
    *   Run arbitrary CQL queries.
    *   **Extended Mode**: View results in a stacked format (like `cqlsh` extended output), automatically limited to 10 records.

## Quickstart

### Prerequisites

*   Python 3.12+
*   Apache Cassandra 3.x or 4.x
*   [uv](https://github.com/astral-sh/uv) (fast Python package installer)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/py-sandra.git
    cd py-sandra
    ```

2.  **Create a virtual environment and install dependencies:**
    ```bash
    uv venv --python 3.12
    source .venv/bin/activate  # On Windows: .venv\Scripts\activate
    uv sync
    ```

3.  **Run the application:**
    ```bash
    streamlit run main_view.py
    ```

    The application will open in your default web browser at `http://localhost:8501`.

## User Manual

### 1. Connecting to a Cluster
*   On the sidebar, expand **Manage Connections**.
*   Enter a name, host IPs (comma-separated), port (default 9042), and optional credentials.
*   Click **Save Connection**.
*   Select the connection from the dropdown and click **Connect**.

### 2. Browsing Data
*   Once connected, select a **Keyspace** and **Table** from the sidebar.
*   The **Data Browser** tab shows the table data.
*   Use the **Filters** expander to filter by specific column values (supports partition keys).
*   Use the pagination controls at the bottom to navigate large datasets.
*   Click the trash icon (🗑️) to delete a row.

### 3. Inserting Data
*   Switch to the **Insert Record** tab.
*   Fill in the form fields generated from the table schema.
*   Click **Insert** to add the record.

### 4. Managing Schema & Metadata
*   Switch to the **Table Info** tab to view column details.
*   **Hide Columns**: Check the "Hide" box to prevent a column from appearing in the Data Browser.
*   **Map Schemas**: For `MAP` columns, click **Edit Schema** to define a fixed set of keys and their types. This is useful for maps that act as structured documents.

### 5. Running CQL Queries
*   Switch to the **CQL Editor** tab.
*   Type your query.
*   Check **Extended Mode** to view results in a vertical, key-value format (useful for wide rows).

## Contributing

We welcome contributions! Whether it's reporting bugs, suggesting features, or submitting pull requests, your help is appreciated.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
