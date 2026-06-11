# Contributing to kassandra

First off, thank you for considering contributing to kassandra! It’s people like you that make open-source tools better for everyone.

As a **v0.2.0 Beta** project, we are especially grateful for help with bug fixes, documentation, and new feature implementations.

---

## 🤝 How to Contribute

### Reporting Bugs

* Check the **Issues** tab to see if the bug has already been reported.
* If not, open a new issue. Include your OS, Python version, Cassandra version, and steps to reproduce the error.

### Suggesting Enhancements

* We love new ideas! Please open an issue labeled `enhancement` to discuss the feature before starting work on it.

### Pull Requests

1. Create a new branch for your feature or fix: `git checkout -b feature/cool-new-feature`.
2. Commit your changes with clear, descriptive messages.
3. Push to your fork and submit a Pull Request.
4. **Note:** Please ensure your code follows PEP 8 standards for Python.

---

## 🧪 Development Guidelines

* **UI Consistency:** Since kassandra is a GUI, please ensure new buttons or forms match the existing layout and color scheme.
* **Driver Safety:** When adding new query logic, always use prepared statements or the driver’s built-in parameterization to prevent injection and handle data types correctly.
* **Collections:** If you are modifying how Maps, Lists, or Sets are handled, please test with various data nesting levels.

---

## 📜 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

**Questions?** Feel free to reach out via GitHub Discussions!
