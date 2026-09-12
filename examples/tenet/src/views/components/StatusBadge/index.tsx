import type { FC } from "hono/jsx";
import type { TenetStatus } from "domains/tenet/model";

const LABELS: Record<TenetStatus, string> = {
  draft: "Draft",
  voting: "Voting",
  accepted: "Accepted",
  rejected: "Rejected",
  implemented: "Implemented",
  superseded: "Superseded",
};

const COLORS: Record<TenetStatus, string> = {
  draft: "var(--pico-secondary)",
  voting: "var(--pico-primary)",
  accepted: "var(--pico-success-color)",
  rejected: "var(--pico-error-color)",
  implemented: "var(--pico-success-color)",
  superseded: "var(--pico-muted-color)",
};

interface Props {
  status: TenetStatus;
}

export const StatusBadge: FC<Props> = ({ status }) => (
  <span
    style={`display: inline-block; padding: 0.15rem 0.5rem; border-radius: var(--pico-border-radius); font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: ${COLORS[status]}; background: color-mix(in srgb, ${COLORS[status]} 15%, transparent);`}
  >
    {LABELS[status]}
  </span>
);
