"use strict";
const assert = require("node:assert/strict"), { fixture, turn } = require("./cc-session-fixture.cjs");
(async () => {
  const values = {}, storage = { local: { get: async (defaults) => ({ ...defaults, ...values }), set: async (data) => Object.assign(values, data) } };
  const f = fixture({ storage }), p = f.connect(); await turn();
  p.command({ type: "arm-start", player: { mode: "bilingual", size: 28, ratio: 1, hold: 6000, fullscreen: true } }); await turn();
  const fresh = fixture({ storage }), next = fresh.connect(); await turn();
  const options = next.messages.findLast((m) => m.snapshot).snapshot.options;
  assert.equal(options.size, 28); assert.equal(options.hold, 6000); assert.equal(options.ratio, 1); assert.equal(options.mode, "bilingual");
  assert.equal(fresh.activations, 0, "Restoring preferences never starts a model or subtitles");
  next.command({ type: "toggle-captions", enabled: true }); await turn();
  const session = next.messages.findLast((m) => m.snapshot).snapshot.session;
  next.command({ type: "player-settings", session, options: { ...options, size: 18 } }); await turn();
  assert.equal(values["captionPlayerPreferencesV1:youtube"].size, 18);
  assert.equal(values["captionPlayerPreferencesV1:bilibili"], undefined);
  console.log("CC preferences persist across page contexts, platform isolation and no automatic start passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
