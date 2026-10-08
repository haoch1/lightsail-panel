import type { Instance } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { CopyText, Modal, when } from "../../components/ui";
import { regionLabel } from "../../../shared/regions";
export default function Details({
  instance: i,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const { toast } = usePanel();
  const values = {
    "实例 ID": i.id,
    实例类型: i.instanceType,
    账户: i.accountName,
    区域: regionLabel(i.region),
    可用区: i.zone,
    "公网 IP": i.publicIp,
    "IPv6 地址": i.ipv6?.join("\n"),
    地址类型:
      i.ipAddressType === "dualstack"
        ? "IPv4 + IPv6"
        : i.ipAddressType === "ipv6"
          ? "仅 IPv6"
          : i.ipAddressType === "ipv4"
            ? "仅 IPv4"
            : i.ipAddressType,
    "私网 IP": i.privateIp,
    镜像: i.imageId,
    密钥对: i.keyName || "LightsailDefaultKeyPair",
    创建时间: when(i.createdAt),
  };
  return (
    <Modal title={i.name} description="实例详情" onClose={onClose}>
      <dl className="details">
        {Object.entries(values).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <CopyText text={v} toast={toast} />
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
