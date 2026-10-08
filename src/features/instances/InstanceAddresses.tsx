import type { Instance, ToastFn } from "../../../shared/types";
import { CopyText } from "../../components/ui";
export default function InstanceAddresses({
  instance,
  toast,
}: {
  instance: Instance;
  toast: ToastFn;
}) {
  const stopped = instance.state === "stopped" || instance.state === "stopping";
  return (
    <div className="instance-addresses">
      <div>
        <span>IPv4</span>
        <CopyText text={instance.publicIp} toast={toast} />
      </div>
      <div>
        <span>IPv6</span>
        <CopyText text={instance.ipv6?.[0]} toast={toast} />
      </div>
      <div className="private-address">
        <span>私网</span>
        {instance.privateIp || "—"}
      </div>
      {stopped && !instance.publicIp && !instance.ipv6?.length && (
        <small>实例已停止</small>
      )}
    </div>
  );
}
