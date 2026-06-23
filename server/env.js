import fs from "node:fs";
import path from "node:path";

const ENV_FILES = [
  path.resolve(".env"),
  "/Users/shawvi/Desktop/wechat/.env"
];

function applyEnvFile(file) {
  if (!fs.existsSync(file)) return;

  const content = fs.readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] == null) process.env[key] = value;
  }
}

for (const file of ENV_FILES) applyEnvFile(file);
