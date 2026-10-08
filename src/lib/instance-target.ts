import type { Instance } from "../../shared/types";
export function targetOf(i: Instance) {
  return {
    accountId: i.accountId,
    region: i.region,
    service: i.service,
    id: i.id,
  };
}
