import path from "node:path";
import { createLocalManResultCollector, recordLocalManLoadTime } from "./localman-results";

export const QA_RESULTS_REPORT_PATH = path.resolve(process.cwd(), "reports", "localman-results.json");

export type QaStructuredResult = {
  duration: number;
  errors: string[];
  feature: string;
  route: string;
  status: "fail" | "pass" | "slow";
};

export const createQaResultCollector = createLocalManResultCollector;
export const recordQaLoadTime = recordLocalManLoadTime;
