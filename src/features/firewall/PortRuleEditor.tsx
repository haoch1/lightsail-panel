import { regionLabel } from "../../../shared/regions";
import { useState } from "react";
import type { Instance, PortInfo } from "../../../shared/types";
import { Checkbox, ErrorBox, Field, Modal } from "../../components/ui";
import Select from "../../components/ui/Select";
import { buildPortRule, sourceTokens, toggleSource } from "./model";
import { firewallPresets } from "./presets";
export default function PortRuleEditor({
  instance,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  instance: Instance;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (rule: PortInfo) => void;
}) {
  const [preset, setPreset] = useState("custom"),
    [protocol, setProtocol] = useState("tcp");
  const [from, setFrom] = useState(22),
    [to, setTo] = useState(22);
  const [sources, setSources] = useState(
    instance.ipAddressType === "ipv6" ? "::/0" : "0.0.0.0/0",
  );
  const [localError, setLocalError] = useState("");
  const all = preset === "all",
    icmp = protocol === "icmp" || protocol === "icmpv6";
  const v4 =
    instance.ipAddressType !== "ipv6" &&
    (preset !== "custom" || protocol !== "icmpv6");
  const v6 =
    (instance.ipAddressType !== "ipv4" || !!instance.ipv6?.length) &&
    (preset !== "custom" || protocol !== "icmp");
  const selectedSources = sourceTokens(sources);
  return (
    <Modal
      title="开放端口"
      description={instance.name + " · " + regionLabel(instance.region)}
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setLocalError("");
          try {
            onSubmit(
              buildPortRule({ preset, protocol, from, to, sources }, instance),
            );
          } catch (e) {
            setLocalError((e as Error).message);
          }
        }}
      >
        <Field label="规则类型">
          <Select
            aria-label="规则类型"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setLocalError("");
            }}
          >
            <option value="custom">自定义</option>
            {firewallPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {preset === "custom" && (
          <>
            <Field label="协议">
              <Select
                aria-label="协议"
                value={protocol}
                onChange={(e) => {
                  const next = e.target.value;
                  setProtocol(next);
                  setFrom(next.startsWith("icmp") ? -1 : 22);
                  setTo(next.startsWith("icmp") ? -1 : 22);
                  if (next === "icmpv6") setSources("::/0");
                  else if (next === "icmp") setSources("0.0.0.0/0");
                }}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                {instance.ipAddressType !== "ipv6" && (
                  <option value="icmp">ICMP（IPv4）</option>
                )}
                {(instance.ipAddressType !== "ipv4" ||
                  instance.ipv6?.length) && (
                  <option value="icmpv6">ICMPv6</option>
                )}
              </Select>
            </Field>
            <div className="form-grid">
              <Field label={icmp ? "类型" : "起始端口"}>
                <input
                  type="number"
                  required
                  aria-label={icmp ? "ICMP 类型" : "起始端口"}
                  min={icmp ? -1 : 0}
                  max={icmp ? 255 : 65535}
                  value={Number.isNaN(from) ? "" : from}
                  onChange={(e) => setFrom(e.target.valueAsNumber)}
                />
              </Field>
              <Field label={icmp ? "代码" : "结束端口"}>
                <input
                  type="number"
                  required
                  aria-label={icmp ? "ICMP 代码" : "结束端口"}
                  min={icmp ? -1 : 0}
                  max={icmp ? 255 : 65535}
                  value={Number.isNaN(to) ? "" : to}
                  onChange={(e) => setTo(e.target.valueAsNumber)}
                />
              </Field>
            </div>
            <p className="field-help">
              {icmp
                ? "-1 表示全部类型或代码。"
                : "单个端口将起始、结束填为同一数值；范围例如 8000–8100。"}
            </p>
          </>
        )}
        {all ? (
          <div className="notice">
            允许所有协议和端口，自动使用实例支持的全部公网 IPv4 / IPv6 来源。
          </div>
        ) : (
          <>
            <Field
              label="来源 IP 地址或 CIDR"
              help="多个地址用逗号分隔；双栈实例可同时勾选 IPv4 和 IPv6。"
            >
              <input
                required
                aria-label="来源 IP 地址或 CIDR"
                value={sources}
                onChange={(e) => setSources(e.target.value)}
              />
            </Field>
            <div className="source-options">
              <Checkbox
                disabled={!v4}
                checked={v4 && selectedSources.includes("0.0.0.0/0")}
                onChange={(e) =>
                  setSources((s) =>
                    toggleSource(s, "0.0.0.0/0", e.target.checked),
                  )
                }
              >
                所有 IPv4
              </Checkbox>
              <Checkbox
                disabled={!v6}
                checked={v6 && selectedSources.includes("::/0")}
                onChange={(e) =>
                  setSources((s) => toggleSource(s, "::/0", e.target.checked))
                }
              >
                所有 IPv6
              </Checkbox>
            </div>
          </>
        )}
        {(localError || error) && <ErrorBox message={localError || error} />}
        <div className="modal-actions">
          <button className="button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "正在提交…" : "确认开放"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
