import { WebWorkerMLCEngineHandler } from "./vendor/web-llm.js";

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
