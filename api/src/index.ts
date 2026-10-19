import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { loadCatalogueSettings } from "./services/catalogue.js";
import { loadMatrices } from "./services/scoring.js";

const config = loadConfig();
const app = createApp(
  createPool(config.DATABASE_URL),
  loadMatrices(config.SCORING_CONFIG_PATH),
  loadCatalogueSettings(config.SCORING_CONFIG_PATH),
);

app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
});
