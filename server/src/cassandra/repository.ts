/**
 * Row-level CRUD using prepared statements.
 * Implemented by the data lane; mirrors legacy/src/database/repository.py.
 *
 * Notes from the legacy contract (must preserve):
 *   - INSERT: skip null/empty, coerce list/set values from arrays
 *   - UPDATE: SET clause uses regular columns; WHERE uses ALL primary keys.
 *             Use parameter binding (NOT string interpolation — fixes a
 *             SQL-injection bug present in the legacy Python code).
 *   - DELETE: WHERE uses all primary keys, parameter-bound.
 *   - Reads: paging is server-side opaque bytes; expose to the client as
 *            base64-encoded strings via QueryResult.pagingState.
 */

export {};
