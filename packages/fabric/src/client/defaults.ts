/**
 * Framework-provided client behaviors.
 *
 * Defaults are registered here but only started when the generated client
 * entry explicitly calls startDefaults(). This keeps server-side imports of
 * spindlework/fabric free of browser side effects.
 */

export type ClientDefaults = Record<string, boolean>;

interface DefaultBehavior {
  name: string;
  start(): void;
}

const behaviors: DefaultBehavior[] = [
  {
    name: "hello",
    start() {
      console.log("[spindlework] hello world");
    },
  },
];

/** Start enabled framework-provided client behaviors. */
export function startDefaults(enabled: ClientDefaults = {}): void {
  for (const behavior of behaviors) {
    if (enabled[behavior.name] !== false) {
      behavior.start();
    }
  }
}
