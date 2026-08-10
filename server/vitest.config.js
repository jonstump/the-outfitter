import { defineConfig } from "vitest/config";

// The server suites deliberately exercise the real lowdb JSONFile store rather than a
// mock (see server/src/routes/loadouts.test.js). That means every suite shares one data
// file, and lowdb's read-modify-write cycle is not safe against concurrent writers:
// vitest's default file-level parallelism interleaves writes and corrupts the JSON.
//
// This was latent while the server had a single test file. It surfaced the moment
// SPEC-0003 added a second and third suite.
//
// Serialising the files is the honest fix — the constraint is real (one shared store),
// so the test runner should respect it rather than the suites pretending otherwise.
// Tests within a file still run in order, and the whole server suite is well under a
// second, so there is nothing to gain from parallelism here.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
