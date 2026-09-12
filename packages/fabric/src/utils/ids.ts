export function genId(): string {
  return `e-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
