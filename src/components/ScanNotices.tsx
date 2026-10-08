import type { ResourceScan } from "../../shared/types";
import { regionLabel } from "../../shared/regions";
import { ErrorBox } from "./ui";
import { isRegionalAccessError } from "../lib/region-access";

export default function ScanNotices({
  scan,
}: {
  scan?: ResourceScan<unknown>;
}) {
  return (
    <>
      {scan?.errors
        .filter((error) => !isRegionalAccessError(error.region, error.message))
        .map((error, index) => (
          <ErrorBox
            key={index}
            message={`${error.account} · ${regionLabel(error.region)}：${error.message}`}
          />
        ))}
    </>
  );
}
