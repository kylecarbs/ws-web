// Import this file directly, otherwise it cannot be
// found since ws doesn't actually export this file.
const NodeWebSocket =
  require("../node_modules/ws/lib/websocket.js") as typeof import("ws").WebSocket;

const ws = new NodeWebSocket("ws://127.0.0.1:3000/echo", [], {
  proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
    const proxy = new WebSocket("ws://127.0.0.1:3000/proxy");
    proxy.binaryType = "arraybuffer";
    const writer = writable.getWriter();
    proxy.onmessage = (event) => {
      writer.write(event.data);
    };
    proxy.onopen = async () => {
      const reader = readable.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        proxy.send(value);
      }
    };
    return null;
  },
} as any);

ws.on("open", () => {
  ws.send(Buffer.from("hello"));
});

ws.on("message", (data: Uint8Array) => {
  console.log("got data back", new TextDecoder().decode(data));
});

// @ts-ignore - This is just for playing with the socket!
globalThis.ws = ws;
