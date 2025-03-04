import { Buffer } from "buffer";
import { EventEmitter } from "events";
import type { Socket } from "net";

// request shims `http.request` through readable
//  and writable streams so it can be used in the browser.
export function request(options: {
  proxyStreams: (readable: ReadableStream, writable: WritableStream) => void;
  host: string;
  path: string;
  port: number;
  headers: Record<string, string>;
}) {
  if (!options.proxyStreams) {
    throw new Error("proxyStreams must be supplied via options!");
  }
  const requestEmitter = new EventEmitter();

  // toProxy is a writable we keep that sends data to the proxy.
  const toProxy = new TransformStream();
  // fromProxy is a readable we keep that gets data from the proxy.
  const fromProxy = new TransformStream();
  const reader = fromProxy.readable.getReader();
  const writer = toProxy.writable.getWriter();

  const socket = createStreamSocket(reader, writer);
  let upgraded = false;
  socket.on("data", (data) => {
    if (upgraded) {
      // At this point, the other handler already
      // took this over.
      return;
    }
    const upgradeResponse = parseUpgradeResponse(new Uint8Array(data));
    if (upgradeResponse instanceof Error) {
      requestEmitter.emit("error", upgradeResponse);
      return;
    }
    if (upgradeResponse.status !== 101) {
      requestEmitter.emit("response", {
        headers: upgradeResponse.headers,
        statusCode: upgradeResponse.status,
      });
      return;
    }
    // Upgrade!
    requestEmitter.emit(
      "upgrade",
      {
        headers: upgradeResponse.headers,
      },
      socket,
      upgradeResponse.head
    );
    upgraded = true;
  });

  options.proxyStreams(toProxy.readable, fromProxy.writable);

  // This is a shimmed HTTP request.
  return {
    on: requestEmitter.on.bind(requestEmitter),
    once: requestEmitter.once.bind(requestEmitter),
    end: () => {
      writer.write(createUpgradeRequest(options)).catch((err) => {
        if (err === undefined) {
          err = new Error("Readable was closed");
        }
        requestEmitter.emit("error", err);
      });
    },
    // Calls if the server responds with a non-101 or redirect code.
    // e.g. 200
    destroy: (err?: Error) => {
      requestEmitter.emit("error", err);
    },
  };
}

function createUpgradeRequest(options: {
  host: string;
  port: string | number;
  path: string;
  headers: Record<string, string>;
}): Uint8Array {
  const lines = [
    `GET ${options.path} HTTP/1.1`,
    `Host: ${options.host}:${options.port}`,
  ];

  Object.entries(options.headers).forEach(([key, value]) => {
    lines.push(`${key}: ${value}`);
  });

  // Empty line to indicate end of headers.
  // Final newline
  lines.push("", "");

  return new TextEncoder().encode(lines.join("\r\n"));
}

function parseUpgradeResponse(data: Uint8Array):
  | {
      status: number;
      headers: Record<string, string>;
      head?: Uint8Array;
    }
  | Error {
  const text = new TextDecoder().decode(data);

  // Split head from body using double CRLF
  const headEnd = text.indexOf("\r\n\r\n");
  if (headEnd === -1) {
    return new Error("Invalid HTTP response - no header terminator found");
  }

  const headerText = text.substring(0, headEnd);
  const lines = headerText.split("\r\n");

  // Parse status line
  const statusLine = lines[0];
  const statusMatch = statusLine.match(/^HTTP\/1\.1 (\d+)/);
  if (!statusMatch) {
    return new Error("Status line didn't match");
  }

  const status = parseInt(statusMatch[1], 10);
  const headers: Record<string, string> = {};

  // Parse headers
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [key, ...valueParts] = line.split(":");
    if (!key || !valueParts.length) continue;

    headers[key.trim().toLowerCase()] = valueParts.join(":").trim();
  }

  // If there's data after the headers, return it
  let head: Uint8Array | undefined;
  if (headEnd + 4 < data.byteLength) {
    head = data.slice(headEnd + 4);
  }

  return { status, headers, head: head ?? new Uint8Array() };
}

interface SocketState {
  _readableState: {
    endEmitted: boolean;
    destroyed: boolean;
  };
  _writableState: {
    finished: boolean;
    errorEmitted: boolean;
    destroyed: boolean;
    closed: boolean;
  };
}

// createStreamSocket returns a socket that pipes to
// readable and writable streams.
export function createStreamSocket(
  reader: ReadableStreamDefaultReader,
  writer: WritableStreamDefaultWriter
): Socket & SocketState {
  const fakeSocket: EventEmitter & Partial<Socket> & SocketState =
    new EventEmitter() as any;
  fakeSocket._readableState = {
    endEmitted: false,
    destroyed: false,
  };
  fakeSocket._writableState = {
    finished: false,
    errorEmitted: false,
    destroyed: false,
    closed: false,
  };
  // Instantly destroy all the streams.
  fakeSocket.destroy = (err?: Error): Socket => {
    if (fakeSocket._readableState.destroyed) return fakeSocket as Socket;

    fakeSocket._readableState.destroyed = true;
    fakeSocket._writableState.destroyed = true;

    // Close writer and reader
    writer.close().catch(() => {});
    reader.cancel(err || "Destroyed");

    // Ensure error comes before close
    if (err) {
      fakeSocket.emit("error", err);
    }

    if (!fakeSocket._writableState.closed) {
      fakeSocket._writableState.closed = true;
      queueMicrotask(() => {
        fakeSocket.emit("close", !!err);
      });
    }

    return fakeSocket as Socket;
  };
  let corked = false;
  let corkedQueue: Uint8Array[] = [];
  let corkedLastCallback: any;
  fakeSocket.cork = () => {
    corked = true;
  };
  fakeSocket.uncork = () => {
    corked = false;
    if (corkedQueue.length > 0) {
      const merged = new Uint8Array(corkedQueue.reduce((p, c) => p + c.length, 0));
      let offset = 0;
      for (const chunk of corkedQueue) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      corkedQueue = [];
      doWrite(merged, corkedLastCallback);
    }
  };
  fakeSocket.resume = (): Socket => {
    // noop - there are no pauses on readable streams.
    return fakeSocket as Socket;
  };

  const doWrite = (data: Uint8Array, cb?: any) => {
    writer
      .write(data)
      .then(() => {
        cb?.();
      })
      .catch((err) => {
        if (cb) {
          cb(err);
        } else {
          fakeSocket.emit("error", err);
        }
      });
  }

  // @ts-ignore
  fakeSocket.write = (data: Uint8Array, cb: any) => {
    if (corked) {
      corkedQueue.push(data);
      corkedLastCallback = cb;
      return;
    }
    doWrite(data, cb);
  };
  // @ts-ignore - Let our tests ensure this works.
  fakeSocket.end = function (data?: Uint8Array, cb?: () => void) {
    if (fakeSocket._writableState.finished) return;

    const writeAndFinish = () => {
      fakeSocket._writableState.finished = true;

      // Close the writer to trigger the reader's done state
      writer.close().catch((err) => {
        if (err) fakeSocket.emit("error", err);
      });

      if (cb) queueMicrotask(cb);
      queueMicrotask(() => {
        fakeSocket.emit("finish");
        // Only emit end if we haven't already
        if (!fakeSocket._readableState.endEmitted) {
          fakeSocket._readableState.endEmitted = true;
          fakeSocket.emit("end");
        }
      });
    };

    if (data) {
      fakeSocket.write!(data, () => writeAndFinish());
    } else {
      writeAndFinish();
    }
  };
  fakeSocket.read = () => {
    // In our stream implementation, we're pushing data directly via 'data' events
    // so read() should always return null as data is already consumed
    return null;
  };
  fakeSocket.unshift = (data: Uint8Array) => {
    setTimeout(() => {
      fakeSocket.emit("data", data);
    }, 0);
  };

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          fakeSocket._readableState.destroyed = true;
          if (!fakeSocket._writableState.closed) {
            fakeSocket._writableState.closed = true;
            queueMicrotask(() => {
              fakeSocket.emit("close");
            });
          }
          break;
        }
        fakeSocket.emit("data", Buffer.from(value));
      }
    } catch (err) {
      if (!fakeSocket._readableState.destroyed) {
        fakeSocket.destroy!(
          err instanceof Error ? err : new Error(String(err))
        );
      }
    }
  })();

  return fakeSocket as Socket & SocketState;
}
