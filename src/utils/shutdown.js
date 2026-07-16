// Extracted so the idempotency guard (a real signal handler could otherwise fire twice — e.g.
// a process manager sending SIGTERM followed by SIGKILL-adjacent SIGINT) is unit-testable without
// constructing a real discord.js Client.
function createShutdownHandler({ destroy, exit, logger }) {
  let shuttingDown = false;
  return function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down.`);
    destroy();
    exit(0);
  };
}

module.exports = { createShutdownHandler };
