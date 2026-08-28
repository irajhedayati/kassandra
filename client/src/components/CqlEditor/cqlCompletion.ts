/**
 * CQL autocomplete: keywords, keyspaces, tables (for the selected/referenced
 * keyspace), and columns (for the selected/referenced table).
 *
 * Registered once against Monaco's built-in "sql" language (see
 * CqlEditor.tsx, which uses language="sql" rather than a custom CQL
 * grammar). Schema lookups are cached in-memory per session since
 * keyspace/table/column shape rarely changes while the editor is open.
 */
import type { editor, languages, Position } from 'monaco-editor';
import type { Monaco } from '@monaco-editor/react';
import { listKeyspaces, listTables, getSchema } from '../../api/schema.js';
import { useSelection } from '../../state/selection.js';

const CQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'KEYSPACE', 'INDEX',
  'MATERIALIZED', 'VIEW', 'TYPE', 'IF', 'NOT', 'EXISTS', 'PRIMARY', 'KEY',
  'PARTITION', 'CLUSTERING', 'ORDER', 'BY', 'ASC', 'DESC', 'LIMIT',
  'ALLOW', 'FILTERING', 'AND', 'OR', 'IN', 'CONTAINS', 'USING', 'TTL',
  'TIMESTAMP', 'CONSISTENCY', 'TRUNCATE', 'BATCH', 'APPLY', 'BEGIN',
  'COUNTER', 'STATIC', 'FROZEN', 'LIST', 'MAP', 'TUPLE', 'WITH',
  'REPLICATION', 'DURABLE_WRITES', 'GRANT', 'REVOKE', 'TO', 'ON', 'OF',
  'AS', 'DISTINCT', 'JSON', 'NULL', 'TRUE', 'FALSE',
];

let keyspacesCache: Promise<string[]> | null = null;
const tablesCache = new Map<string, Promise<string[]>>();
const columnsCache = new Map<string, Promise<string[]>>();

function getKeyspaces(): Promise<string[]> {
  if (!keyspacesCache) {
    keyspacesCache = listKeyspaces()
      .then((r) => r.keyspaces)
      .catch(() => {
        keyspacesCache = null;
        return [];
      });
  }
  return keyspacesCache;
}

function getTables(keyspace: string): Promise<string[]> {
  let cached = tablesCache.get(keyspace);
  if (!cached) {
    cached = listTables(keyspace)
      .then((r) => r.tables)
      .catch(() => {
        tablesCache.delete(keyspace);
        return [];
      });
    tablesCache.set(keyspace, cached);
  }
  return cached;
}

function getColumns(keyspace: string, table: string): Promise<string[]> {
  const key = `${keyspace}.${table}`;
  let cached = columnsCache.get(key);
  if (!cached) {
    cached = getSchema(keyspace, table)
      .then((r) => r.columns.map((c) => c.name))
      .catch(() => {
        columnsCache.delete(key);
        return [];
      });
    columnsCache.set(key, cached);
  }
  return cached;
}

/** Finds the most recent `FROM <ks>.<table>` / `FROM <table>` reference before the cursor. */
function resolveTableContext(textBeforeCursor: string): { keyspace: string | null; table: string | null } {
  const matches = [...textBeforeCursor.matchAll(/\bFROM\s+([a-zA-Z_][\w]*)(?:\.([a-zA-Z_][\w]*))?/gi)];
  const last = matches[matches.length - 1];
  if (!last) return { keyspace: null, table: null };
  if (last[2]) return { keyspace: last[1] ?? null, table: last[2] };
  return { keyspace: null, table: last[1] ?? null };
}

export function registerCqlCompletionProvider(monaco: Monaco): { dispose: () => void } {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' '],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const selection = useSelection.getState();
      const referenced = resolveTableContext(textBeforeCursor);
      const keyspace = referenced.keyspace ?? selection.keyspace;
      const table = referenced.table ?? selection.table;

      const keywordSuggestions: languages.CompletionItem[] = CQL_KEYWORDS.map((kw) => ({
        label: kw,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: kw,
        range,
      }));

      const keyspacesPromise = getKeyspaces().then((keyspaces) =>
        keyspaces.map(
          (ks): languages.CompletionItem => ({
            label: ks,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: ks,
            range,
          }),
        ),
      );

      const tablesPromise = keyspace
        ? getTables(keyspace).then((tables) =>
            tables.map(
              (t): languages.CompletionItem => ({
                label: t,
                kind: monaco.languages.CompletionItemKind.Class,
                insertText: t,
                range,
              }),
            ),
          )
        : Promise.resolve<languages.CompletionItem[]>([]);

      const columnsPromise = keyspace && table
        ? getColumns(keyspace, table).then((columns) =>
            columns.map(
              (c): languages.CompletionItem => ({
                label: c,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: c,
                range,
              }),
            ),
          )
        : Promise.resolve<languages.CompletionItem[]>([]);

      return Promise.all([keyspacesPromise, tablesPromise, columnsPromise]).then(
        ([keyspaceSuggestions, tableSuggestions, columnSuggestions]) => ({
          suggestions: [
            ...keywordSuggestions,
            ...keyspaceSuggestions,
            ...tableSuggestions,
            ...columnSuggestions,
          ],
        }),
      );
    },
  });
}

/** Clears cached schema lookups; call when the connection/session changes. */
export function resetCqlCompletionCache(): void {
  keyspacesCache = null;
  tablesCache.clear();
  columnsCache.clear();
}
