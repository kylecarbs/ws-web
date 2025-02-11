const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const WebSocket = require("ws");
const { createConnection } = require("net");
const webpack = require("webpack");

/** @type {import('webpack').Configuration} */
const base = {
  resolve: {
    extensions: [".js"],
    fallback: {
      crypto: require.resolve("./polyfill/crypto.ts"),
      http: require.resolve("./polyfill/http.ts"),
      // Use the same polyfill. The user can handle TLS shenanigans.
      https: require.resolve("./polyfill/http.ts"),
      process: require.resolve("./polyfill/process.ts"),
      url: require.resolve("./polyfill/url.ts"),

      assert: require.resolve("assert"),
      buffer: require.resolve("buffer"),
      stream: require.resolve("stream-browserify"),
      path: require.resolve("path"),
      zlib: require.resolve("browserify-zlib"),

      bufferutil: false,
      "utf-8-validate": false,
      os: false,
      util: false,
      net: false,
      tls: false,
      fs: false,
      vm: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
          },
        },
      },
    ],
  },
  plugins: [
    // Provide Buffer globally.
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
    // Provide process globally.
    new webpack.ProvidePlugin({
      process: path.resolve(__dirname, "polyfill/process.ts"),
    }),
    new webpack.DefinePlugin({
      "process.env.WS_NO_UTF_8_VALIDATE": "true",
      "process.env.WS_NO_BUFFER_UTIL": "true",
    }),
  ],
  optimization: {
    minimize: false,
  },
};

module.exports = [
  {
    ...base,
    name: "ws",
    entry: {
      main: "./node_modules/ws/lib/websocket.js",
    },
    output: {
      path: path.resolve(process.cwd(), "lib"),
      filename: "websocket.js",
      libraryTarget: "commonjs2",
    },
    target: "web",
    mode: "production",
    externals: {
      // Add this to prevent webpack from bundling native modules
      bufferutil: "bufferutil",
    }
  },
  {
    ...base,
    name: "demo",
    entry: {
      main: "./demo/main.ts",
    },
    plugins: [
      ...base.plugins,
      new HtmlWebpackPlugin({
        templateContent: `
        <!DOCTYPE html>
        <html>
        <body>
            <div id="root"></div>
        </body>
        </html>
        `,
      }),
    ],
    devServer: {
      port: 3000,
      setupMiddlewares: function (middlewares, devServer) {
        if (!devServer.server) {
          throw new Error("webpack-dev-server is not initialized properly");
        }

        // This is just for development. Go in the console:
        // > ws.send("this is working")
        const wsServer = new WebSocket.Server({ noServer: true });
        wsServer.on("connection", (ws, req) => {
          if (req.url === "/proxy") {
            const netSocket = createConnection(3000, "127.0.0.1");
            ws.on("message", (message) => {
              console.log("got message", message.toString());
              netSocket.write(message);
            });
            netSocket.on("data", (data) => {
              ws.send(data);
            });
          } else {
            ws.on("message", (message) => {
              console.log("echo message", message.toString());
              ws.send(message);
            });
          }
        });

        devServer.server.on("upgrade", (request, socket, head) => {
          // Only handle WebSocket connections to /ws
          if (request.url === "/proxy" || request.url === "/echo") {
            wsServer.handleUpgrade(request, socket, head, (ws) => {
              wsServer.emit("connection", ws, request);
            });
          }
        });

        return middlewares;
      },
    },
    mode: "development",
  },
];
