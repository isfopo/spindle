/**
 * VoteProgress — shows a visual breakdown of voting results.
 *
 * Displays a colored summary bar and text counts for approve/abstain/block.
 */

import type { FC } from "hono/jsx";
import type { VoteDetail } from "domains/tenet/service";
import styles from "./index.module.css";

interface Props {
  votes: VoteDetail[];
}

function countByChoice(
  votes: VoteDetail[],
  choice: "approve" | "abstain" | "block",
): number {
  return votes.filter((v) => v.choice === choice).length;
}

export const VoteProgress: FC<Props> = ({ votes }) => {
  if (votes.length === 0) return null;

  const approveCount = countByChoice(votes, "approve");
  const abstainCount = countByChoice(votes, "abstain");
  const blockCount = countByChoice(votes, "block");
  const total = votes.length;

  const approvePct = (approveCount / total) * 100;
  const abstainPct = (abstainCount / total) * 100;
  const blockPct = (blockCount / total) * 100;

  return (
    <article>
      <h3>Vote Summary</h3>

      <div class={styles.bar}>
        {approveCount > 0 && (
          <div
            class={styles.approve}
            style={{ width: `${approvePct}%` }}
            title={`${approveCount} approve`}
          />
        )}
        {abstainCount > 0 && (
          <div
            class={styles.abstain}
            style={{ width: `${abstainPct}%` }}
            title={`${abstainCount} abstain`}
          />
        )}
        {blockCount > 0 && (
          <div
            class={styles.block}
            style={{ width: `${blockPct}%` }}
            title={`${blockCount} block`}
          />
        )}
      </div>

      <div class={styles.legend}>
        <span class={styles.count}>
          <span
            class={styles.dot}
            style={{ backgroundColor: "var(--pico-primary)" }}
          />
          Approve: {approveCount}
        </span>
        <span class={styles.count}>
          <span
            class={styles.dot}
            style={{ backgroundColor: "var(--pico-muted-color)" }}
          />
          Abstain: {abstainCount}
        </span>
        <span class={styles.count}>
          <span
            class={styles.dot}
            style={{ backgroundColor: "var(--pico-del-color)" }}
          />
          Block: {blockCount}
        </span>
      </div>
    </article>
  );
};
