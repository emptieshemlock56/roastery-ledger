// Server-sent events: tells every open browser "something changed" so it can
// refetch. Fine for a handful of users on a single server instance.
export function createEventHub() {
  const clients = new Set();

  return {
    handler(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write('retry: 3000\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
    },
    emit(entity, user) {
      const msg = `data: ${JSON.stringify({ entity, by: user?.name ?? null, at: Date.now() })}\n\n`;
      for (const c of clients) c.write(msg);
    },
    closeAll() {
      for (const c of clients) c.end();
      clients.clear();
    },
  };
}
