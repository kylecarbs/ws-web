# ws-web

![NPM Version](https://img.shields.io/npm/v/ws-web)

Use [ws](https://github.com/websockets/ws) in the browser over Web Streams.

- No polyfills or dependencies.
- 144KB gzipped.
- Tested with Bun. 

## Installation

```
pnpm i ws-web
```

## Usage

```ts
import { WebSocket } from "ws-web";

const ws = new WebSocket("ws://fake.com", [], {
    proxyStreams: (readable: ReadableStream, writable: WritableStream) => {
        // TLS should be handled by the user. Raw data is exchanged here.
    },
})
```

Only the client is supported.

## Development

```sh
bun i
bun demo
# Navigate to http://localhost:3000
```

## Building

```sh
bun i
bun package
```
