"use strict";
// Reuse the side-panel DOM harness, exercising only the new audio-mode branch.
process.argv[2] = "audio";
require("./live-captions-ui.test.cjs");
