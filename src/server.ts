import { createApp } from "./app";
import { resolveConfig } from "./config";

const config = resolveConfig();
const app = createApp(config);

app.listen(config.port, config.host, () => {
  process.stdout.write(`omni-connector running at http://${config.host}:${config.port}\n`);
});
