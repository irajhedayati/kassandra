import { defineConfig } from 'drizzle-kit';

// `npm run db:generate -w server` writes the SQL migration for a schema change to ./drizzle.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/config/sqlite/schema.ts',
  out: './drizzle',
});
