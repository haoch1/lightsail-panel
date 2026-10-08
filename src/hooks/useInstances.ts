import { instanceSource } from "../lib/instance-scan";
import type { InstanceScope } from "../lib/instance-scan";
import { useResourceScan } from "./useResourceScan";

export const useInstances = (scope: InstanceScope) =>
  useResourceScan(scope, instanceSource);
