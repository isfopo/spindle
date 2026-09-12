import { describe, it, expect } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { VoteButtons } from "./index";

describe("VoteButtons", () => {
  const slug = "choose-framework";

  it("renders three vote buttons", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("Approve");
    expect(html).toContain("Abstain");
    expect(html).toContain("Block");
  });

  it("renders the vote heading", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("Vote");
  });

  it("renders a form with action to the tenet vote endpoint", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain(`action="/tenets/${slug}/vote"`);
    expect(html).toContain("method=\"post\"");
  });

  it("renders hidden choice and reason inputs", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("name=\"choice\"");
    expect(html).toContain("name=\"reason\"");
  });

  it("shows existing user vote when present", () => {
    const html = renderToString(
      <VoteButtons slug={slug} userVote={{ choice: "approve", reason: null }} />,
    );
    expect(html).toContain("approve");
  });

  it("shows existing user vote with reason when present", () => {
    const html = renderToString(
      <VoteButtons slug={slug} userVote={{ choice: "block", reason: "Not a good fit" }} />,
    );
    expect(html).toContain("block");
    expect(html).toContain("Not a good fit");
  });

  it("wires up data-controller for vote handler", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("data-controller");
  });

  it("wires up data-action attributes on vote buttons", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("data-action");
    expect(html).toContain("click-&gt;vote#submit");
  });

  it("sets data-vote-choice on each trigger", () => {
    const html = renderToString(<VoteButtons slug={slug} userVote={null} />);
    expect(html).toContain("data-vote-choice=\"approve\"");
    expect(html).toContain("data-vote-choice=\"abstain\"");
    expect(html).toContain("data-vote-choice=\"block\"");
  });
});
