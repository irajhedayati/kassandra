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

## 🔄 Changing the configuration format

Kassandra keeps its configuration (connection profiles, saved queries, per-table metadata) behind the `ConfigStorage`
interface (`server/src/config/storage.ts`); by default that is the config directory (`~/.kassandra`, or `KASSANDRA_HOME`).
The storage's version (the `VERSION` file in the directory) records the release that last wrote it. **Any change
that alters the shape of that directory needs a migration**, so existing users are upgraded automatically.

1. Add `server/src/config/migrations/vX_Y_Z.ts`, where `X.Y.Z` is the release that ships the change, exporting a
   `migration` with `version`, `description` and an async `up({ storage })`. Use only the `ConfigStorage` methods
   (`get`, `put`, `delete`, `list`) so the migration works with every backend. See `v1_6_0.ts` for an example.
2. Register it in `MIGRATIONS` in `server/src/config/migrations/index.ts`.
3. Add tests next to `migrations.test.ts`: the upgrade itself, and that it is a no-op on an already-migrated config.

How it runs: on startup the server applies, oldest first, every migration newer than `VERSION`, updating `VERSION` after
each one. Before the first it copies every document to `backups/<old version>/`, and the storage lock (a `.migrate.lock` file for
the directory backend) stops two processes sharing a storage from migrating at once. If a migration throws, the server
exits and `VERSION` stays at the last step that completed. Keep migrations idempotent and never overwrite data the user
may have changed since the old format was written.

### Adding a storage backend

Implement `ConfigStorage` and run `describeStorageContract()` from `storage.contract.ts` against it, as
`fileStorage.test.ts` does. The contract covers documents, key listing, the version and the lock; the rest of the
application and the migrations then work unchanged.

Then make it selectable: call `registerStorageBackend('<name>', () => new YourStorage(...))` (from `storage.ts`) at
startup. Users choose it with `KASSANDRA_STORAGE=<name>`; without it the `file` backend is used. The factory runs on
every `getStorage()` call, so return a shared instance.

---

## 📜 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

**Questions?** Feel free to reach out via GitHub Discussions!
