import postgres from "postgres";

// Mutator tests run against the local Supabase stack. Fail early, and say how to fix it.
export default async function checkDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  const sql = postgres(url, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1 from applied_mutations limit 1`;
  } catch (error) {
    throw new Error(
      `The local database is not ready at ${new URL(url).host} (${(error as Error).message}). ` +
        "Run `npx supabase start`, `npm run setup:local` and `npm run db:migrate` first.",
    );
  } finally {
    await sql.end();
  }
}
