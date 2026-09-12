import type { Tenet, TenetOption } from "domains/db-types";

/** Status union type derived from the generated schema. */
export type TenetStatus = Tenet["status"];

/** Row type for the `tenets` D1 table. */
export type TenetRow = Tenet;

/** Row type for the `tenet_options` D1 table. */
export type TenetOptionRow = TenetOption;
