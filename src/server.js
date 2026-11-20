import app from "./app.js";
import { env } from "./config/env.js";
import { db, testDatabaseConnection } from "./config/db.js";
import { smsOutboxService } from "./modules/sms/outbox.worker.js";

async function startServer() {
  try {
    await testDatabaseConnection();

    // Start background SMS Outbox Worker
    smsOutboxService.startWorker(5000);
    // Run an initial sweep immediately to recover any pending jobs queued before restart
    smsOutboxService.processOutboxBatch(10).catch((err) => {
      console.error("[SmsOutboxWorker] Initial startup sweep error:", err.message);
    });

    const server = app.listen(env.port, () => {
      console.log("=================================");
      console.log("       BanglaQR API Server       ");
      console.log("=================================");
      console.log(`Environment: ${env.nodeEnv}`);
      console.log(`Port: ${env.port}`);
      console.log(`API Base: ${env.nodeEnv === "production" ? "https://api.banglaqr.com.bd" : `http://localhost:${env.port}`}`);
      console.log(
        `Health: ${env.nodeEnv === "production" ? "https://api.banglaqr.com.bd/api/health" : `http://localhost:${env.port}/api/health`}`
      );
      console.log("=================================");
    });

    // Graceful shutdown handling for cPanel / Passenger / systemd
    const handleShutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);
      try {
        smsOutboxService.stopWorker();
        server.close(async () => {
          console.log("[Server] HTTP server closed.");
          try {
            await db.end();
            console.log("[Server] MySQL connection pool closed.");
          } catch (e) {
            console.error("[Server] Error closing MySQL pool:", e.message);
          }
          process.exit(0);
        });
      } catch (err) {
        console.error("[Server] Error during shutdown:", err);
        process.exit(1);
      }
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
  } catch (error) {
    console.error("❌ Server startup failed:");
    console.error(error);

    process.exit(1);
  }
}

startServer();
