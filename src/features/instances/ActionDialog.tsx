import { useState } from "react";
import type { Instance } from "../../../shared/types";
import { Checkbox, Field, Modal } from "../../components/ui";
import { actionNames } from "./actions";
export default function ActionDialog({
  instance,
  action,
  busy,
  onClose,
  onConfirm,
}: {
  instance: Instance;
  action: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (confirm: string, acceptBundleUpdate: boolean) => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [acceptBundleUpdate, setAcceptBundleUpdate] = useState(false);
  const changesBundle =
    action === "disable-ipv6" && instance.ipAddressType === "ipv6";
  return (
    <Modal
      title={actionNames[action]}
      description={instance.id}
      busy={busy}
      onClose={onClose}
    >
      <div
        className={"notice " + (action === "terminate" ? "danger-notice" : "")}
      >
        {action === "terminate"
          ? "此操作不可撤销，将删除实例；请先备份需要保留的数据。"
          : action === "enable-ipv6"
            ? "启用后由 AWS 分配公网 IPv6 地址，保留现有 IPv4。IPv6 防火墙规则需要单独设置。"
            : action === "disable-ipv6"
              ? changesBundle
                ? "此实例使用仅 IPv6 套餐。关闭 IPv6 会切换为含公网 IPv4 的套餐，AWS 将调整套餐并立即按新价格计费；IPv6 地址会释放，现有 IPv6 连接会中断，请更新 DNS。"
                : "关闭后公网 IPv6 地址会释放，原地址无法找回，IPv6 连接会中断；IPv4 继续保留。再次启用时将由 AWS 分配新地址。"
              : action === "rotate-ip"
                ? "将分配新的 Lightsail 静态 IP 并替换当前公网 IP。IPv4 地址可能产生费用；已有非面板管理的 IP 会保留。"
                : action === "stop"
                  ? "停止后服务将中断。Lightsail 套餐仍会继续计费。"
                  : "实例将重新启动，服务会短暂中断。"}
      </div>
      {changesBundle && (
        <Checkbox
          checked={acceptBundleUpdate}
          onChange={(e) => setAcceptBundleUpdate(e.target.checked)}
        >
          我确认切换为含 IPv4 的套餐，并接受 AWS 调整套餐和费用
        </Checkbox>
      )}
      {action === "terminate" && (
        <Field label="输入实例 ID 确认">
          <input
            autoComplete="off"
            placeholder={instance.id}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
      )}
      <div className="modal-actions">
        <button className="button" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button
          className={
            "button " + (action === "terminate" ? "danger" : "primary")
          }
          disabled={
            busy ||
            (action === "terminate" && confirm !== instance.id) ||
            (changesBundle && !acceptBundleUpdate)
          }
          onClick={() => onConfirm(confirm, acceptBundleUpdate)}
        >
          {busy ? "正在提交…" : "确认" + actionNames[action]}
        </button>
      </div>
    </Modal>
  );
}
