import type { FC } from "hono/jsx";
import { StatusBadge } from "views/components/StatusBadge";
import { UserAvatar } from "views/components/UserAvatar";
import type { TenetSummary } from "domains/tenet/service";
import styles from "./index.module.css";

interface Props {
  tenet: TenetSummary;
}

export const TenetCard: FC<Props> = ({ tenet }) => (
  <article>
    <header>
      <StatusBadge status={tenet.status} />
      <small>{new Date(tenet.createdAt).toLocaleDateString()}</small>
    </header>
    <a href={`/tenets/${tenet.slug}`} class={styles.titleLink}>
      <h3>{tenet.title}</h3>
    </a>
    <footer>
      <div class={styles.footerMeta}>
        <UserAvatar
          login={tenet.proposedBy.login}
          avatarUrl={tenet.proposedBy.avatarUrl}
        />
        {tenet.proposedBy.login}
      </div>
    </footer>
  </article>
);
