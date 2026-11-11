// One address in front of the app and the API reference, for dev/local.sh: the same two routes as
// deploy/Caddyfile.local, without a container.
//
//   /reference/        the API reference (its own small site), with the prefix taken off
//   everything else    the app, with its documentation
//
//   FRONT_PORT=8787 APP_URL=http://127.0.0.1:8785 REFERENCE_URL=http://127.0.0.1:8788 node dev/front.mjs
import { createServer, request } from "node:http";

const port = Number(process.env.FRONT_PORT ?? 8787);
const app = new URL(process.env.APP_URL ?? "http://127.0.0.1:8785");
const reference = new URL(process.env.REFERENCE_URL ?? "http://127.0.0.1:8788");

createServer((req, res) => {
  const url = req.url ?? "/";
  // The reference is found with or without the slash.
  if (url === "/reference" || url.startsWith("/reference?")) {
    res.writeHead(308, { location: `/reference/${url.slice("/reference".length)}` });
    return res.end();
  }
  const toReference = url.startsWith("/reference/");
  const target = toReference ? reference : app;
  const path = toReference ? url.slice("/reference".length) : url;
  // The Host and Origin the browser sent are passed on as they are, so the app sees its own address.
  const upstream = request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path,
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`${toReference ? "The API reference" : "The app"} is not answering.`);
  });
  req.pipe(upstream);
}).listen(port, () => console.log(JSON.stringify({ msg: "front listening", port })));
