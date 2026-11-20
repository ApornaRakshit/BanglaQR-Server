/**
 * BanglaQR API — Production Entrypoint for cPanel / Phusion Passenger
 *
 * In cPanel Node.js Selector, the default application startup file is often `app.js`.
 * This wrapper imports the actual server startup routine from `./src/server.js`.
 */
import "./src/server.js";

