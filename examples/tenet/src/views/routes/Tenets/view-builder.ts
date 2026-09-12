import type { UserRow } from "domains/user/model";
import type {
  TenetDetail,
  TenetSummary,
  UserInfo,
} from "domains/tenet/service";
import type { TenetStatus } from "domains/tenet/model";
import { ViewBuilderBase } from "@spindle/spindle/thread";
import { TenetListViewModel } from "./views";
import { TenetDetailViewModel } from "./views/show";

function toUserInfo(user: UserRow): UserInfo {
  return {
    avatarUrl: user.avatar_url,
    ...user,
  };
}

export class TenetViewBuilder extends ViewBuilderBase {
  index(tenets: TenetSummary[], currentUser: UserRow): TenetListViewModel {
    return { tenets, currentUser: toUserInfo(currentUser) };
  }

  show(tenet: TenetDetail, currentUser: UserRow): TenetDetailViewModel {
    const userVote =
      tenet.votes.find((v) => v.userId === currentUser.id) ?? null;
    const canVote = tenet.status === "voting";
    const isProposer = tenet.proposedBy.id === currentUser.id;

    const allowedTransitions = allowedTransitionsFor(tenet.status, isProposer);

    return {
      tenet,
      currentUser: toUserInfo(currentUser),
      userVote,
      canVote,
      canTransition: allowedTransitions.length > 0,
      allowedTransitions,
    };
  }
}

/** Shared singleton is provided by `ViewBuilderBase.instance()`; controllers
    reference it via `this.models` (see @Render / ControllerBase). */

const STATUS_FLOW: Record<
  TenetStatus,
  { to: TenetStatus[]; needsProposer: boolean }
> = {
  draft: { to: ["voting"], needsProposer: true },
  voting: { to: ["accepted", "rejected"], needsProposer: true },
  accepted: { to: ["implemented", "superseded"], needsProposer: false },
  rejected: { to: [], needsProposer: false },
  implemented: { to: ["superseded"], needsProposer: false },
  superseded: { to: [], needsProposer: false },
};

function allowedTransitionsFor(
  status: TenetStatus,
  isProposer: boolean,
): TenetStatus[] {
  const flow = STATUS_FLOW[status];
  if (!flow) return [];
  if (flow.needsProposer && !isProposer) return [];
  return flow.to;
}

