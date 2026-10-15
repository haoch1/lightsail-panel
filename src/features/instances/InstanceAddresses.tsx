import type { Instance, ToastFn } from "../../../shared/types";
import { CopyText } from "../../components/ui";
export default function InstanceAddresses({
  instance,
  toast,
}: {
  instance: Instance;
  toast: ToastFn;
}) {
  return (
    <div className="instance-addresses">
      <div>
        <span>IPv4</span>
        <CopyText text={instance.publicIp} toast={toast} />
      </div>
      <div className="instance-ipv6">
        <span>IPv6</span>
        <CopyText text={instance.ipv6?.[0]} toast={toast} wrapAt=":" />
      </div>
      <div className="private-address">
        <span>私网</span>
        {instance.privateIp || "—"}
      </div>
    </div>
  );
}
