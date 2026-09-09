import type { FC } from "hono/jsx";
import { useHandler } from "@spindle/spindle/fabric";
import { StatusBadge } from "views/components/StatusBadge";
import { VoteButtons } from "views/components/VoteButtons";
import { VoteProgress } from "views/components/VoteProgress";
import styles from "./show.module.css";
import { TenetStatus } from "domains/tenet/model";
import { TenetDetail, UserInfo } from "domains/tenet/service";
import { StatusHandler } from "views/handlers/StatusHandler";

export interface TenetDetailViewModel {
  tenet: TenetDetail;
  currentUser: UserInfo;
  userVote: { choice: string; reason: string | null } | null;
  canVote: boolean;
  canTransition: boolean;
  allowedTransitions: TenetStatus[];
}

const STATUS_TRANSITIONS: Record<
  string,
  { label: string; target: string; message: string }[]
> = {
  draft: [
    {
      label: "Start Voting",
      target: "voting",
      message: "Start voting on this tenet?",
    },
  ],
  voting: [
    { label: "Accept", target: "accepted", message: "Accept this tenet?" },
    { label: "Reject", target: "rejected", message: "Reject this tenet?" },
  ],
  accepted: [
    {
      label: "Mark Implemented",
      target: "implemented",
      message: "Mark as implemented?",
    },
    {
      label: "Supersede",
      target: "superseded",
      message: "Supersede this tenet?",
    },
  ],
  implemented: [
    {
      label: "Supersede",
      target: "superseded",
      message: "Supersede this tenet?",
    },
  ],
};

export const View: FC<TenetDetailViewModel> = ({
  tenet,
  userVote,
  canVote,
  canTransition,
  allowedTransitions,
}) => {
  const Status = useHandler(StatusHandler);

  return (
    <section>
      <header>
        <StatusBadge status={tenet.status} />
        <small>
          Proposed by {tenet.proposedBy.login} on{" "}
          {new Date(tenet.createdAt).toLocaleDateString()}
        </small>
      </header>

      <h1>{tenet.title}</h1>

      {tenet.decision && (
        <article class={styles.decisionBox}>
          <strong>Decision:</strong> {tenet.decision}
          {tenet.rationale && (
            <p>
              <strong>Rationale:</strong> {tenet.rationale}
            </p>
          )}
        </article>
      )}

      <hgroup>
        <h2>Context</h2>
        <p>{tenet.context}</p>
      </hgroup>

      <h2>Options</h2>
      {tenet.options.map((opt) => (
        <article key={opt.id}>
          <h3>{opt.title}</h3>
          {opt.description && <p>{opt.description}</p>}
          {opt.pros && (
            <details>
              <summary>Pros</summary>
              <p>{opt.pros}</p>
            </details>
          )}
          {opt.cons && (
            <details>
              <summary>Cons</summary>
              <p>{opt.cons}</p>
            </details>
          )}
        </article>
      ))}

      {canVote && <VoteButtons slug={tenet.slug} userVote={userVote} />}

      <VoteProgress votes={tenet.votes} />

      <h2>Votes</h2>
      {tenet.votes.length === 0 ? (
        <p>
          <small>No votes yet.</small>
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Choice</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {tenet.votes.map((v) => (
              <tr key={v.userId}>
                <td>{v.user.login}</td>
                <td>
                  <strong>{v.choice}</strong>
                </td>
                <td>{v.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canTransition && (
        <div class={styles.transitionGroup}>
          {STATUS_TRANSITIONS[tenet.status]
            ?.filter((t) => allowedTransitions.includes(t.target as any))
            .map((t) => (
              <form
                method="post"
                action={`/tenets/${tenet.slug}/status`}
                class={styles.inlineForm}
              >
                <input type="hidden" name="status" value={t.target} />
                <Status.Trigger
                  event="click"
                  method="transition"
                  status={t.target}
                  message={t.message}
                >
                  <button type="submit">{t.label}</button>
                </Status.Trigger>
              </form>
            ))}
        </div>
      )}
    </section>
  );
};

