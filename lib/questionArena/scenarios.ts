import emptyCartScenario from "@/data/scenarios/forkly-empty-cart.json";
import orderHistoryScenario from "@/data/scenarios/forkly-order-history.json";
import type { ScenarioConfig } from "./types";

export const scenarioTemplates: ScenarioConfig[] = [
  orderHistoryScenario as ScenarioConfig,
  emptyCartScenario as ScenarioConfig,
];
