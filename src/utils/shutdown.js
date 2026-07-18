const DEFAULT_TIMEOUT_MS = 5000;

// Extracted so the idempotency guard (a real signal handler could otherwise fire twice — e.g.
// a process manager sending SIGTERM followed by SIGKILL-adjacent SIGINT) is unit-testable without
// constructing a real discord.js Client.
function createShutdownHandler({ destroy, exit, logger, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let shuttingDown = false;
  return async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down.`);

    // destroy() (client.destroy()) is async — await it so the gateway connection gets a chance
    // to close gracefully before the process exits, but race it against a timeout so a hung
    // destroy() can't block shutdown forever.
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => destroy()),
        new Promise((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } catch (err) {
      logger.error('Error while destroying client during shutdown:', err.message);
    } finally {
      clearTimeout(timer);
    }

    exit(0);
  };
}

module.exports = { createShutdownHandler };
