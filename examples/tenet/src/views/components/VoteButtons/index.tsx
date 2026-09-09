/**
 * VoteButtons — renders approve/abstain/block voting buttons.
 *
 * Uses Action("vote") to wire up VoteHandler on the client side.
 */

import type { FC } from "hono/jsx";
import { useHandler } from "@spindle/spindle/fabric";
import { VoteHandler } from "views/handlers/VoteHandler";

export type UserVoteInfo = { choice: string; reason: string | null } | null;

interface Props {
  slug: string;
  userVote: UserVoteInfo;
}

const VOTE_CHOICES = [
  { value: "approve", label: "Approve", css: "primary" },
  { value: "abstain", label: "Abstain", css: "secondary outline" },
  { value: "block", label: "Block", css: "outline" },
] as const;

export const VoteButtons: FC<Props> = ({ slug, userVote }) => {
  const Vote = useHandler(VoteHandler);

  return (
    <article>
      <h2>Vote</h2>
      {userVote ? (
        <p>
          You voted: <strong>{userVote.choice}</strong>
          {userVote.reason && <span> &mdash; {userVote.reason}</span>}
        </p>
      ) : null}
      <form method="post" action={`/tenets/${slug}/vote`}>
        <input type="hidden" name="choice" />
        <input type="hidden" name="reason" />
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {VOTE_CHOICES.map((vc) => (
            <Vote.Trigger event="click" method="submit" choice={vc.value}>
              <button type="submit" class={vc.css}>
                {vc.label}
              </button>
            </Vote.Trigger>
          ))}
        </div>
      </form>
    </article>
  );
};

