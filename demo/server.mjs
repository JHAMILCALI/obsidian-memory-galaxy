import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/demo.js", ["demo.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["../styles.css", "text/css; charset=utf-8"]]
]);

createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const entry = files.get(pathname);
  if (!entry) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(join(root, entry[0]));
    response.writeHead(200, { "Content-Type": entry[1] }).end(content);
  } catch {
    response.writeHead(500).end();
  }
}).listen(4173, "127.0.0.1", () => {
  process.stdout.write("Vista previa: http://127.0.0.1:4173\n");
});
