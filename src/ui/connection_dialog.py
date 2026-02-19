"""
Connection Management Dialog

Provides a dialog for creating, editing, and testing Cassandra connections.
Supports multiple hosts, authentication, and SSL configuration.
"""

from PySide6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QLineEdit, QSpinBox, QCheckBox, QPushButton,
    QLabel, QMessageBox, QTextEdit, QGroupBox
)
from PySide6.QtCore import Qt

from src.config.settings import ConnectionProfile
from src.database.connection import CassandraConnectionManager


class ConnectionDialog(QDialog):
    """
    Dialog for managing Cassandra connection profiles.

    Allows users to create, edit, and test connection configurations
    including hosts, port, credentials, and SSL settings.
    """

    def __init__(self, parent=None, profile: ConnectionProfile = None):
        """
        Initialize the connection dialog.

        Args:
            parent: Parent widget.
            profile: Existing profile to edit, or None for new connection.
        """
        super().__init__(parent)
        self._profile = profile
        self._connection_manager = CassandraConnectionManager()

        self._setup_ui()
        self._load_profile()

    def _setup_ui(self):
        """Set up the dialog UI."""
        self.setWindowTitle("Connection Settings")
        self.setMinimumWidth(500)
        self.setModal(True)

        layout = QVBoxLayout(self)
        layout.setSpacing(16)

        # Connection name
        name_layout = QFormLayout()
        self.name_input = QLineEdit()
        self.name_input.setPlaceholderText("My Cassandra Cluster")
        name_layout.addRow("Connection Name:", self.name_input)
        layout.addLayout(name_layout)

        # Host configuration
        host_group = QGroupBox("Host Configuration")
        host_layout = QVBoxLayout(host_group)

        host_form = QFormLayout()

        self.hosts_input = QTextEdit()
        self.hosts_input.setPlaceholderText("Enter hosts, one per line:\n127.0.0.1\n192.168.1.100")
        self.hosts_input.setMaximumHeight(80)
        host_form.addRow("Hosts:", self.hosts_input)

        self.port_input = QSpinBox()
        self.port_input.setRange(1, 65535)
        self.port_input.setValue(9042)
        host_form.addRow("Port:", self.port_input)

        self.keyspace_input = QLineEdit()
        self.keyspace_input.setPlaceholderText("Optional default keyspace")
        host_form.addRow("Default Keyspace:", self.keyspace_input)

        host_layout.addLayout(host_form)
        layout.addWidget(host_group)

        # Authentication
        auth_group = QGroupBox("Authentication")
        auth_layout = QFormLayout(auth_group)

        self.username_input = QLineEdit()
        self.username_input.setPlaceholderText("Optional")
        auth_layout.addRow("Username:", self.username_input)

        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.Password)
        self.password_input.setPlaceholderText("Optional")
        auth_layout.addRow("Password:", self.password_input)

        layout.addWidget(auth_group)

        # SSL Configuration
        ssl_group = QGroupBox("Security")
        ssl_layout = QVBoxLayout(ssl_group)

        self.ssl_checkbox = QCheckBox("Enable SSL/TLS")
        ssl_layout.addWidget(self.ssl_checkbox)

        ssl_note = QLabel("Note: SSL uses system default certificates")
        ssl_note.setProperty("type", "subheading")
        ssl_layout.addWidget(ssl_note)

        layout.addWidget(ssl_group)

        # Buttons
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.test_button = QPushButton("Test Connection")
        self.test_button.setProperty("type", "secondary")
        self.test_button.clicked.connect(self._test_connection)
        button_layout.addWidget(self.test_button)

        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.setProperty("type", "secondary")
        self.cancel_button.clicked.connect(self.reject)
        button_layout.addWidget(self.cancel_button)

        self.save_button = QPushButton("Save")
        self.save_button.clicked.connect(self._save)
        button_layout.addWidget(self.save_button)

        layout.addLayout(button_layout)

    def _load_profile(self):
        """Load existing profile data into form fields."""
        if self._profile:
            self.name_input.setText(self._profile.name)
            self.hosts_input.setPlainText("\n".join(self._profile.hosts))
            self.port_input.setValue(self._profile.port)
            self.username_input.setText(self._profile.username)
            self.password_input.setText(self._profile.password)
            self.ssl_checkbox.setChecked(self._profile.ssl_enabled)
            self.keyspace_input.setText(self._profile.default_keyspace)

    def _get_profile_from_form(self) -> ConnectionProfile:
        """Create a ConnectionProfile from form data."""
        hosts_text = self.hosts_input.toPlainText().strip()
        hosts = [h.strip() for h in hosts_text.split("\n") if h.strip()]

        if not hosts:
            hosts = ["127.0.0.1"]

        return ConnectionProfile(
            name=self.name_input.text().strip() or "Unnamed Connection",
            hosts=hosts,
            port=self.port_input.value(),
            username=self.username_input.text(),
            password=self.password_input.text(),
            ssl_enabled=self.ssl_checkbox.isChecked(),
            default_keyspace=self.keyspace_input.text().strip()
        )

    def _test_connection(self):
        """Test the connection with current settings."""
        profile = self._get_profile_from_form()

        self.test_button.setText("Testing...")
        self.test_button.setEnabled(False)

        # Force UI update
        from PySide6.QtWidgets import QApplication
        QApplication.processEvents()

        result = test_connection(profile)

        self.test_button.setText("Test Connection")
        self.test_button.setEnabled(True)

        if result.success:
            QMessageBox.information(
                self,
                "Connection Test",
                result.message
            )
        else:
            QMessageBox.warning(
                self,
                "Connection Test Failed",
                result.message
            )

    def _save(self):
        """Validate and save the connection profile."""
        name = self.name_input.text().strip()
        if not name:
            QMessageBox.warning(
                self,
                "Validation Error",
                "Please enter a connection name."
            )
            self.name_input.setFocus()
            return

        hosts_text = self.hosts_input.toPlainText().strip()
        if not hosts_text:
            QMessageBox.warning(
                self,
                "Validation Error",
                "Please enter at least one host."
            )
            self.hosts_input.setFocus()
            return

        self.accept()

    def get_profile(self) -> ConnectionProfile:
        """Get the configured connection profile."""
        return self._get_profile_from_form()