import app from "./app.js";
import { env } from "./config/env.js";
import { testDatabaseConnection } from "./config/db.js";

async function startServer() {
  try {
    await testDatabaseConnection();

    app.listen(env.port, () => {
      console.log("=================================");
      console.log("       BanglaQR API Server       ");
      console.log("=================================");
      console.log(`Environment: ${env.nodeEnv}`);
      console.log(`Port: ${env.port}`);
      console.log(`API: http://localhost:${env.port}`);
      console.log(
        `Health: http://localhost:${env.port}/api/health`
      );
      console.log("=================================");
    });
  } catch (error) {
    console.error("❌ Server startup failed:");
    console.error(error);

    process.exit(1);
  }
}

startServer();