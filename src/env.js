// Load .env without a dependency (Node ≥ 20.12). Missing file is fine: hosted platforms inject env vars.
try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
