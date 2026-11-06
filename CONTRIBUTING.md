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

Kassandra keeps its configuration (connection profiles, saved queries, per-table metadata) behind the `ConfigRepository`
interface (`server/src/config/repository.ts`). Two backends ship: JSON files in the config directory (`~/.kassandra`, or
`KASSANDRA_HOME`), and SQLite. Each has its own way to evolve, and existing users are upgraded automatically in both.

### SQLite schema changes

The relational schema is `server/src/config/sqlite/schema.ts` (Drizzle). After changing it run
`npm run db:generate -w server`, review the new SQL file in `server/drizzle/` and commit it together with the schema
change and the code that uses it. Never edit a migration that has been released; add another. The SQLite repository
applies pending migrations when the server starts, and refuses a database that has more migrations than the running
version knows. Extend `sqlite/repository.test.ts` or the contract suite when behavior changes.

### File (JSON document) format changes

The storage's version (the `VERSION` file in the directory) records the release that last wrote it. **Any change
that alters the shape of that directory needs a migration.**

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

Implement `ConfigRepository` and run `describeRepositoryContract()` from `repository.contract.ts` against it, as
`documentRepository.test.ts` and `sqlite/repository.test.ts` do. The contract covers profiles, favorites, saved queries,
table metadata, snapshots and the lock; the rest of the application then works unchanged.

If the backend is a key -> JSON-document store (Redis, a key-value service, ...), implement the smaller `ConfigStorage`
(`storage.ts`, tested with `describeStorageContract()`) and wrap it in `DocumentRepository`; the file-format migrations
above then apply to it. A relational or otherwise richer backend implements `ConfigRepository` directly and owns its
schema migrations, as `sqlite/` does. Its `migrate()` must create or upgrade the data and record the version.

Then make it selectable: call `registerStorageBackend('<name>', () => yourRepository)` (from `registry.ts`) at startup.
Users choose it with `KASSANDRA_STORAGE=<name>`; without it the `file` backend is used. The factory runs on every
`getRepository()` call, so return a shared instance. To offer a backend on the Configuration page it also needs a place
in `config/backend.ts` and `changeStorage()` in `setup.ts`.

---

## 📜 Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

**Questions?** Feel free to reach out via GitHub Discussions!
