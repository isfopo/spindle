import type { Vote } from "domains/db-types";

/** Choice union type derived from the generated schema. */
export type VoteChoice = Vote["choice"];

/** Row type for the `votes` D1 table. */
export type VoteRow = Vote;
