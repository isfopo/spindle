import type { FC } from "hono/jsx";
import { TenetCard } from "views/components/TenetCard";
import styles from "./index.module.css";
import { TenetSummary, UserInfo } from "domains/tenet/service";

export interface TenetListViewModel {
  tenets: TenetSummary[];
  currentUser: UserInfo;
}

export const View: FC<TenetListViewModel> = ({ tenets }) => {
  return (
    <section>
      <header>
        <nav>
          <ul>
            <li>
              <hgroup>
                <h1>Decisions</h1>
                <p>Architecture decision records for your team.</p>
              </hgroup>
            </li>
          </ul>
          <ul>
            <li>
              <a href="/tenets/new" role="button">
                Propose
              </a>
            </li>
          </ul>
        </nav>
      </header>

      {tenets.length === 0 ? (
        <article class={styles.emptyState}>
          <p>No tenets yet.</p>
          <p>Propose the first architecture decision for your team.</p>
          <a href="/tenets/new" role="button">
            Propose a Tenet
          </a>
        </article>
      ) : (
        <div class={styles.tenetGrid}>
          {tenets.map((t) => (
            <TenetCard tenet={t} />
          ))}
        </div>
      )}
    </section>
  );
};
