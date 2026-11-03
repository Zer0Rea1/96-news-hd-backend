import app from "./runtime.js";
const server = app.listen(Number(process.env.PORT || 3001), "0.0.0.0", () => console.log("96 News HD unified API ready"));
server.requestTimeout = 30000;
server.headersTimeout = 10000;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => server.close());
