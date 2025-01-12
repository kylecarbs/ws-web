import { WebSocket as LibWebSocket, ClientOptions as LibClientOptions } from "ws";

export type ClientOptions = LibClientOptions & {
    proxyStreams: (readable: ReadableStream, writable: WritableStream) => void;
};

export default class WebSocket extends LibWebSocket {
    constructor(url: string, protocols?: string | string[], options?: ClientOptions);
    constructor(url: string, options?: ClientOptions);
}
