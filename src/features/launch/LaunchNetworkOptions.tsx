import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Instance, PortInfo } from "../../../shared/types";
import { Checkbox } from "../../components/ui";
import PortRuleEditor from "../firewall/PortRuleEditor";
import { portLabel } from "../firewall/presets";
import { addLaunchFirewallRule, defaultLaunchFirewall } from "./firewall-rules";

export default function LaunchNetworkOptions({
  network,
  firewall,
  setFirewall,
  allocateStaticIp,
  setAllocateStaticIp,
}: {
  network: string;
  firewall: PortInfo[] | undefined;
  setFirewall: (rules: PortInfo[] | undefined) => void;
  allocateStaticIp: boolean;
  setAllocateStaticIp: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const instance: Instance = {
    id: "new-instance",
    name: "新实例",
    service: "lightsail",
    accountId: "",
    accountName: "",
    region: "",
    state: "pending",
    instanceType: "",
    platform: "",
    ipAddressType: network,
  };
  return (
    <section className="form-panel launch-network-options">
      <h2>防火墙与静态 IP（可选）</h2>
      <Checkbox
        checked={firewall !== undefined}
        onChange={(e) =>
          setFirewall(
            e.target.checked ? defaultLaunchFirewall(network) : undefined,
          )
        }
      >
        创建后设置防火墙
      </Checkbox>
      <p className="field-help">
        未勾选时使用 AWS 默认规则；勾选后默认开放所有协议，可按需调整下列规则。
      </p>
      {firewall !== undefined && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>协议</th>
                  <th>端口</th>
                  <th>允许来源</th>
                  <th className="actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {firewall.map((rule, index) => (
                  <tr key={index}>
                    <td>{rule.protocol.toUpperCase()}</td>
                    <td>
                      {portLabel(rule.protocol, rule.fromPort, rule.toPort)}
                    </td>
                    <td>
                      {[...(rule.cidrs || []), ...(rule.ipv6Cidrs || [])].join(
                        ", ",
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`移除创建规则 ${index + 1}`}
                        onClick={() =>
                          setFirewall(firewall.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!firewall.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      请添加至少一条规则后创建实例。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="button small"
            disabled={firewall.length >= 60}
            onClick={() => setEditing(true)}
          >
            <Plus size={14} />
            添加规则
          </button>
        </>
      )}
      <div className="launch-static-ip">
        <Checkbox
          checked={allocateStaticIp}
          disabled={network === "ipv6"}
          onChange={(e) => setAllocateStaticIp(e.target.checked)}
        >
          自动分配并绑定静态 IPv4
        </Checkbox>
        <p className="field-help">
          {network === "ipv6"
            ? "仅 IPv6 实例不支持静态 IPv4。"
            : "每台实例分配一个静态 IP，并在创建就绪后绑定。"}
        </p>
      </div>
      {editing && (
        <PortRuleEditor
          instance={instance}
          busy={false}
          error=""
          onClose={() => setEditing(false)}
          onSubmit={(rule) => {
            setFirewall(addLaunchFirewallRule(firewall || [], rule));
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}
