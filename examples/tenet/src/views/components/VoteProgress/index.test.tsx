import { describe, it, expect } from "vitest";
import { renderToString } from "hono/jsx/dom/server";
import { VoteProgress } from "./index";
import type { VoteDetail, UserInfo } from "domains/tenet/service";

const mockUser: UserInfo = {
  id: 1,
  login: "testuser",
  avatarUrl: null,
  name: "Test User",
};

const mockVotes: VoteDetail[] = [
  { userId: 1, user: mockUser, choice: "approve", reason: null },
  {
    userId: 2,
    user: { ...mockUser, id: 2, login: "user2" },
    choice: "approve",
    reason: null,
  },
  {
    userId: 3,
    user: { ...mockUser, id: 3, login: "user3" },
    choice: "abstain",
    reason: null,
  },
  {
    userId: 4,
    user: { ...mockUser, id: 4, login: "user4" },
    choice: "block",
    reason: "Strong objection",
  },
];

describe("VoteProgress", () => {
  it("renders the vote summary heading", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    expect(html).toContain("Vote Summary");
  });

  it("renders approve count", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    expect(html).toContain("Approve: 2");
  });

  it("renders abstain count", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    expect(html).toContain("Abstain: 1");
  });

  it("renders block count", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    expect(html).toContain("Block: 1");
  });

  it("renders zero counts when no votes of that type exist", () => {
    const allApprove: VoteDetail[] = [
      { userId: 1, user: mockUser, choice: "approve", reason: null },
    ];
    const html = renderToString(<VoteProgress votes={allApprove} />);
    expect(html).toContain("Approve: 1");
    expect(html).toContain("Abstain: 0");
    expect(html).toContain("Block: 0");
  });

  it("returns null when there are no votes", () => {
    const html = renderToString(<VoteProgress votes={[]} />);
    expect(html).toBe("");
  });

  it("renders a visual bar element", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    // The bar element has a CSS module class, but the shim returns class name as string
    // So we check for expected structure
    expect(html).toContain("bar");
  });

  it("renders dot indicators in the legend", () => {
    const html = renderToString(<VoteProgress votes={mockVotes} />);
    // Each legend item has a colored dot
    expect(html).toContain("approve");
    expect(html).toContain("abstain");
    expect(html).toContain("block");
  });
});
