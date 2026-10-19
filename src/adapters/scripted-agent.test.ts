import { describeAdapterConformance } from "../test-support/adapter-conformance.js";
import { ScriptedAgentAdapter } from "../test-support/scripted-agent.js";

describeAdapterConformance(
  "scripted fake harness",
  (plan, options) => new ScriptedAgentAdapter(plan, options),
);
