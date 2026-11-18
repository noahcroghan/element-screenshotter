// Fetches the test browser once, before any test file starts. A download
// inside a test file's beforeAll counts against the hook timeout, and a slow
// one would fail every file in the run.

import { findBrowser } from '../../scripts/browser-path.ts';

export default async function setup() {
  await findBrowser();
}
