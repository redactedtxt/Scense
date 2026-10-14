import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";

const config = loadConfig();
const app = createApp(createPool(config.DATABASE_URL));

app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});
