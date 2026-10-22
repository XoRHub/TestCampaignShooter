import type { FastifyReply } from 'fastify';

export interface SseChannel {
  send: (event: string, data: unknown) => void;
  close: () => void;
  signal: AbortSignal;
}

/** Turns a reply into a Server-Sent-Events channel with heartbeats. */
export function openSse(reply: FastifyReply): SseChannel {
  // Take the response over from Fastify: we write the stream ourselves.
  reply.hijack();
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  reply.raw.write(': connected\n\n');

  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  const controller = new AbortController();
  const close = () => {
    clearInterval(heartbeat);
    controller.abort();
    reply.raw.end();
  };
  reply.raw.on('close', () => {
    clearInterval(heartbeat);
    controller.abort();
  });

  return {
    send: (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close,
    signal: controller.signal,
  };
}
