import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Base jetable : les tests n'écrivent jamais dans var/tracker.db.
    env: { DATABASE_PATH: path.join(os.tmpdir(), `tracker-test-${process.pid}.db`), APP_URL: "https://tracker.example" },
    fileParallelism: false,
  },
});
