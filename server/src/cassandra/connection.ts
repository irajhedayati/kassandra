/**
 * Cassandra connection lifecycle.
 * Implemented by the connection lane; mirrors legacy/src/database/connection.py.
 *
 * Responsibilities:
 *   - connect(profile): build SSL options, auth, ExecutionProfile, return Client
 *   - disconnect(): shutdown active client, clear state
 *
 * On connect, call `setActive({ client, profile, keyspace })` from
 * ./state.ts so other lanes can pick up the session.
 */

export {};
