import Anthropic from "@anthropic-ai/sdk";

type ClientFactory = (apiKey: string) => Pick<Anthropic, "messages">;
const defaultClientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });
let clientFactory: ClientFactory = defaultClientFactory;

export function createAssistantClient(apiKey: string): Pick<Anthropic, "messages"> {
  return clientFactory(apiKey);
}

export function __setClientFactoryForTests(factory: ClientFactory): void {
  clientFactory = factory;
}

export function __resetClientFactoryForTests(): void {
  clientFactory = defaultClientFactory;
}
