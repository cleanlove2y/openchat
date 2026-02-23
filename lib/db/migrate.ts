import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getAppLogger } from "../logging";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    getAppLogger().info(
      {
        event: "db.migrate.skipped",
      },
      "POSTGRES_URL not defined, skipping migrations"
    );
    process.exit(0);
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  getAppLogger().info(
    {
      event: "db.migrate.start",
    },
    "Running migrations"
  );

  const start = Date.now();
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });
  const end = Date.now();

  getAppLogger().info(
    {
      event: "db.migrate.completed",
      durationMs: end - start,
    },
    "Migrations completed"
  );
  process.exit(0);
};

runMigrate().catch((err) => {
  getAppLogger().error(
    {
      event: "db.migrate.failed",
      error: err,
    },
    "Migration failed"
  );
  process.exit(1);
});
