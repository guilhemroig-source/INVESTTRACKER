import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DATABASE_PATH: path.join(os.tmpdir(), `tracker-core-test-${process.pid}.db`) },
    fileParallelism: false,
  },
});
