import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, "..");

const envPath = path.resolve(serverDir, "src/config/env.js");
const { env } = await import(`file://${envPath.replace(/\\/g, "/")}`);

async function runBackup() {
  const backupsDir = path.resolve(serverDir, "backups");
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(backupsDir, `backup_phase1_${timestamp}.sql`);
  const db = env.db;
  const pass = db.password ? `-p"${db.password}"` : "";
  const cmd = `mysqldump -h ${db.host} -P ${db.port} -u ${db.user} ${pass} ${db.name} > "${backupPath}"`;
  console.log("Running backup to:", backupPath);
  execSync(cmd, { shell: "cmd.exe" });
  console.log("Backup complete! Size:", fs.statSync(backupPath).size, "bytes");
}

runBackup().catch((e) => {
  console.error("Backup failed:", e);
  process.exit(1);
});
