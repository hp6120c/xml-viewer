import assert from "node:assert/strict";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const endpoints = config?.plugins?.updater?.endpoints;
assert(Array.isArray(endpoints), "Updater endpoints must be an array");
assert(endpoints.length >= 2, "Updater must define Gitee and GitHub endpoints");
assert.match(endpoints[0], /^https:\/\/gitee\.com\/.+\/raw\/updates\/latest\.json$/, "Gitee must be checked first");
assert.match(endpoints[1], /^https:\/\/github\.com\/.+\/releases\/latest\/download\/latest\.json$/, "GitHub must be the fallback");
console.log(JSON.stringify({ ok: true, endpoints }, null, 2));
