import { WebSocketHandler } from "bun";
import { describe, expect, test } from "bun:test";
import { Socket, createConnection } from "net";
import WebSocket from "../lib/websocket.js";
import { createStreamSocket } from "./http";

describe("WebSocket", () => {
  test("throws without proxyStreams", () => {
    expect(() => {
      new WebSocket("ws://localhost:8080");
    }).toThrow("proxyStreams must be supplied");
  });

  test("throws if stream is instantly closed", async () => {
    const ws = new WebSocket("ws://localhost:8080", [], {
      proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        readable.cancel();
      },
    });
    const err = await new Promise<Error>((resolve) => {
      ws.on("error", (err) => {
        resolve(err);
      });
    });
    expect(err.message).toBe("Readable was closed");
  });

  test("http: connects and echos", async () => {
    const port = createServer();
    const ws = new WebSocket(`ws://localhost:3000`, [], {
      proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        const socket = createConnection(port, "127.0.0.1");
        pipeSocket(socket, readable, writable);
      },
    });
    const message = await new Promise<Uint8Array>((resolve) => {
      ws.on("open", () => {
        ws.send("ping");
      });
      ws.on("message", (message) => {
        resolve(message);
      });
    });
    expect(message.toString()).toEqual("ping");
  });

  test("https: connects and echos", async () => {
    const port = createServer();
    const ws = new WebSocket(`wss://localhost:3000`, [], {
      proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        const socket = createConnection(port, "127.0.0.1");
        pipeSocket(socket, readable, writable);
      },
    });
    const message = await new Promise<Uint8Array>((resolve) => {
      ws.on("open", () => {
        ws.send("ping");
      });
      ws.on("message", (message) => {
        resolve(message);
      });
    });
    expect(message.toString()).toEqual("ping");
  });

  test("http: closes", async () => {
    const port = createServer();
    const ws = new WebSocket(`ws://localhost:3000`, [], {
      proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        const socket = createConnection(port, "127.0.0.1");
        pipeSocket(socket, readable, writable);
      },
    });
    const closed = new Promise((resolve) => {
      ws.on("close", resolve);
    });
    ws.on("open", () => {
      ws.close();
    });
    await closed;
  });

  test("http: errors if readable closes after connection", async () => {
    const port = createServer();
    let closeReadable: () => void;
    const ws = new WebSocket(`ws://localhost:3000`, [], {
      proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        const socket = createConnection(port, "127.0.0.1");
        closeReadable = pipeSocket(socket, readable, writable).closeReadable;
      },
    });
    const exitCode = new Promise<number>((resolve) => {
      ws.on("close", (code) => {
        resolve(code);
      });
    });
    ws.on("open", () => {
      closeReadable();
      ws.send("ping");
    });
    // Expect an abnormal closure
    expect(await exitCode).toBe(1006);
  });
});

describe("createStreamSocket", () => {
  test("should emit data events", async () => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = readable.getReader();

    const socket = createStreamSocket(reader, writer);
    const received: Uint8Array[] = [];

    socket.on("data", (data: Uint8Array) => {
      received.push(data);
    });

    await writer.write(new Uint8Array([1, 2, 3]));
    await writer.close();

    // Wait for microtasks to process
    await Promise.resolve();

    expect(received.length).toBe(1);
    expect(received[0]).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("should handle end sequence correctly", async () => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = readable.getReader();

    const socket = createStreamSocket(reader, writer);
    const events: string[] = [];

    socket.on("end", () => events.push("end"));
    socket.on("finish", () => events.push("finish"));
    socket.on("close", () => events.push("close"));

    socket.end();

    // Wait for all events to be emitted
    await new Promise<void>((resolve) => {
      const checkEvents = () => {
        if (events.length === 3) {
          resolve();
        } else {
          queueMicrotask(checkEvents);
        }
      };
      checkEvents();
    });

    expect(events).toEqual(["finish", "end", "close"]);
  });

  test("should handle destroy correctly", async () => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = readable.getReader();

    const socket = createStreamSocket(reader, writer);
    const events: string[] = [];

    socket.on("error", () => events.push("error"));
    socket.on("close", () => events.push("close"));

    socket.destroy(new Error("test error"));

    // Wait for microtasks to process
    await Promise.resolve();

    expect(events).toEqual(["error", "close"]);
    expect(socket._readableState.destroyed).toBe(true);
    expect(socket._writableState.destroyed).toBe(true);
  });

  test("should handle write with callback", async () => {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const reader = readable.getReader();

    const socket = createStreamSocket(reader, writer);

    await new Promise<void>((resolve, reject) => {
      socket.write(new Uint8Array([1, 2, 3]), () => {
        resolve();
      });
    });
  });

  test("should handle reader errors correctly", async () => {
    const events: string[] = [];

    // Create a mock reader that errors on read
    const mockReader = {
      read: () => Promise.reject(new Error("Stream error")),
      cancel: () => Promise.resolve(),
      releaseLock: () => {},
    };

    const writer = new WritableStream().getWriter();
    const socket = createStreamSocket(mockReader as any, writer);

    socket.on("error", () => events.push("error"));
    socket.on("close", () => events.push("close"));

    // Wait for all events to be emitted
    await new Promise<void>((resolve) => {
      const checkEvents = () => {
        if (events.length === 2) {
          resolve();
        } else {
          queueMicrotask(checkEvents);
        }
      };
      checkEvents();
    });

    expect(events).toEqual(["error", "close"]);
    expect(socket._readableState.destroyed).toBe(true);
    expect(socket._writableState.destroyed).toBe(true);
  });
});

// pipeSocket pipes a socket to a readable stream and a writable stream.
const pipeSocket = (
  socket: Socket,
  readable: ReadableStream,
  writable: WritableStream
): {
  closeReadable: () => void;
} => {
  let closeReadable: undefined | (() => void);
  socket.on("connect", async () => {
    const reader = readable.getReader();
    closeReadable = () => {
      reader.cancel();
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      socket.write(value);
    }
  });
  socket.on("error", (err) => {
    readable.cancel(err);
  });
  const writer = writable.getWriter();
  socket.on("data", (data) => {
    writer.write(data);
  });
  socket.on("close", () => {
    writer.close();
  });
  return {
    closeReadable: () => {
      if (closeReadable) {
        closeReadable();
      }
    },
  };
};

const createServer = (handler?: WebSocketHandler): number => {
  const server = Bun.serve({
    port: 0,
    fetch: (req, server) => {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed!", { status: 500 });
    },
    websocket: handler || {
      message(ws, message) {
        // Echo by default.
        ws.send(message);
      },
    },
  });
  return server.port;
};
