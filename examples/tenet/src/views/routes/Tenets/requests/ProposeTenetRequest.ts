import { RequestGuard, type ValidationResult } from "@spindle/spindle/thread"

export interface OptionInput {
  title: string;
  description?: string;
  pros?: string;
  cons?: string;
}

export class ProposeTenetRequest extends RequestGuard {
  readonly title: string;
  readonly context: string;
  readonly options: OptionInput[];

  constructor(body: Record<string, unknown>) {
    super(body);
    this.title = (body.title as string) ?? "";
    this.context = (body.context as string) ?? "";

    const raw = body.options;
    this.options = Array.isArray(raw)
      ? raw.map((o: Record<string, unknown>) => ({
          title: String(o.title ?? ""),
          description:
            o.description != null ? String(o.description) : undefined,
          pros: o.pros != null ? String(o.pros) : undefined,
          cons: o.cons != null ? String(o.cons) : undefined,
        }))
      : [];
  }

  validate(): ValidationResult {
    if (!this.title.trim()) this.addError("title", "Title is required");
    if (!this.context.trim()) this.addError("context", "Context is required");
    if (this.options.length === 0) {
      this.addError("options", "At least one option is required");
    }
    for (let i = 0; i < this.options.length; i++) {
      if (!this.options[i].title.trim()) {
        this.addError(
          `options.${i}.title`,
          `Option ${i + 1} title is required`,
        );
      }
    }

    return { valid: this.isValid, errors: this.errors };
  }
}

