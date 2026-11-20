import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

async function inspect() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "banglaqr",
  });

  const [tables] = await connection.query("SHOW TABLES");
  const tableNames = tables.map((t) => Object.values(t)[0]);
  console.log("=== ALL TABLES IN DATABASE ===");
  console.log(tableNames.join(", "));

  for (const t of tableNames) {
    const isRelevant = /gate|serv|addon|app|catalog|product|item|tier|plan/i.test(t);
    if (isRelevant) {
      console.log(`\n==============================================`);
      console.log(`TABLE: ${t}`);
      console.log(`==============================================`);
      const [cols] = await connection.query(`DESCRIBE \`${t}\``);
      console.log(cols.map((c) => `${c.Field} (${c.Type}) [Null:${c.Null}, Key:${c.Key}, Default:${c.Default}]`).join("\n"));
      const [countRes] = await connection.query(`SELECT COUNT(*) as cnt FROM \`${t}\``);
      console.log(`Total Rows: ${countRes[0].cnt}`);
      if (countRes[0].cnt > 0) {
        const [rows] = await connection.query(`SELECT * FROM \`${t}\` LIMIT 3`);
        console.log("Sample Rows:", JSON.stringify(rows, null, 2));
      }
    }
  }

  await connection.end();
}

inspect().catch(console.error);

