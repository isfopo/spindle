import { describe, it, expect } from "vitest";
import { ProposeTenetRequest } from "./ProposeTenetRequest";
import { VoteRequest } from "./VoteRequest";

describe("ProposeTenetRequest", () => {
  it("accepts valid input", () => {
    const req = new ProposeTenetRequest({
      title: "Use React",
      context: "We need to choose a UI framework",
      options: [
        { title: "React", pros: "Popular", cons: "Large bundle" },
        { title: "Vue", pros: "Lightweight", cons: "Smaller ecosystem" },
      ],
    });
    const result = req.validate();
    expect(result.valid).toBe(true);
  });

  it("rejects empty title", () => {
    const req = new ProposeTenetRequest({
      title: "",
      context: "Some context",
      options: [{ title: "Option A" }],
    });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.title).toBeDefined();
  });

  it("rejects empty context", () => {
    const req = new ProposeTenetRequest({
      title: "Title",
      context: "",
      options: [{ title: "Option A" }],
    });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.context).toBeDefined();
  });

  it("rejects no options", () => {
    const req = new ProposeTenetRequest({
      title: "Title",
      context: "Context",
      options: [],
    });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.options).toBeDefined();
  });

  it("rejects option without title", () => {
    const req = new ProposeTenetRequest({
      title: "Title",
      context: "Context",
      options: [{ title: "" }],
    });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.["options.0.title"]).toBeDefined();
  });
});

describe("VoteRequest", () => {
  it("accepts valid approve", () => {
    const req = new VoteRequest({ choice: "approve" });
    expect(req.validate().valid).toBe(true);
  });

  it("accepts valid abstain", () => {
    const req = new VoteRequest({ choice: "abstain" });
    expect(req.validate().valid).toBe(true);
  });

  it("accepts block with reason", () => {
    const req = new VoteRequest({ choice: "block", reason: "Security concern" });
    expect(req.validate().valid).toBe(true);
  });

  it("rejects block without reason", () => {
    const req = new VoteRequest({ choice: "block", reason: "" });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.reason).toBeDefined();
  });

  it("rejects invalid choice", () => {
    const req = new VoteRequest({ choice: "maybe" });
    const result = req.validate();
    expect(result.valid).toBe(false);
    expect(result.errors?.choice).toBeDefined();
  });
});
