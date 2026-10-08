import { compareImages } from "../../../shared/images";
import { regionLabel } from "../../../shared/regions";
import { ArrowLeft, Rocket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Catalog } from "../../../shared/types";
import { useApi, usePanel } from "../../app/context";
import {
  Busy,
  Empty,
  ErrorBox,
  Field,
  Modal,
  RefreshButton,
} from "../../components/ui";
import Select from "../../components/ui/Select";
import { api, query } from "../../lib/api";
import { bundleLabel, isGeneralBundle } from "../../lib/bundle";
import BundlePicker from "./BundlePicker";
import { creationRegionError } from "../../lib/region-access";
import { DefaultKeyDownload } from "../ssh/SshKey";
import { defaultStartupScript } from "./default-script";
export default function Launch() {
  const panel = usePanel();
  const [accountId, setAccount] = useState(
    panel.accountId === "all" ? panel.accounts[0]?.id || "" : panel.accountId,
  );
  const [region, setRegion] = useState(panel.regions[0]?.id || "ap-east-1");
  const catalog = useApi<Catalog>(
    accountId
      ? "/catalog?" + query({ accountId, region, service: "lightsail" })
      : null,
  );
  const [imageId, setImage] = useState(""),
    [instanceType, setType] = useState("");
  const [name, setName] = useState("my-lightsail"),
    [count, setCount] = useState(1),
    [userData, setUserData] = useState(defaultStartupScript);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [network, setNetwork] = useState("dualstack");
  const [chosenZone, setZone] = useState("");
  const zones = catalog.data?.zones || [];
  const zone = zones.includes(chosenZone) ? chosenZone : zones[0] || "";
  const submission = useRef({ fingerprint: "", token: crypto.randomUUID() });
  useEffect(() => {
    if (panel.accountId !== "all") setAccount(panel.accountId);
    else if (!accountId && panel.accounts[0]) {
      setAccount(panel.accounts[0].id);
    }
  }, [panel.accountId, panel.accounts.length]);
  const platform = catalog.data?.images.find((x) => x.id === imageId)?.platform;
  const selectedImage = catalog.data?.images.find((x) => x.id === imageId);
  const images = [...(catalog.data?.images || [])].sort(compareImages);
  const types =
    catalog.data?.types.filter(
      (x) =>
        isGeneralBundle(x) &&
        (!platform || !x.platforms?.length || x.platforms.includes(platform)) &&
        (!selectedImage?.minPower ||
          !x.power ||
          x.power >= selectedImage.minPower) &&
        (network === "ipv6" ? x.ipv4 === false : x.ipv4 !== false),
    ) || [];
  useEffect(() => {
    const c = catalog.data;
    if (!c) return;
    if (!images.some((x) => x.id === imageId)) setImage(images[0]?.id || "");
    if (!types.some((x) => x.id === instanceType)) setType(types[0]?.id || "");
  }, [catalog.data, imageId, instanceType, network]);
  const body = {
    accountId,
    region,
    service: "lightsail",
    imageId,
    instanceType,
    name,
    count,
    userData,
    ipAddressType: network,
    zone,
  };
  async function create() {
    setBusy(true);
    setError("");
    const fingerprint = JSON.stringify(body);
    if (submission.current.fingerprint !== fingerprint)
      submission.current = { fingerprint, token: crypto.randomUUID() };
    try {
      await api("/launch", { ...body, token: submission.current.token });
      panel.toast(panel.demo ? "演示实例已添加" : "Lightsail 创建请求已提交");
      panel.setScope(accountId, region);
      panel.navigate("/lightsail");
    } catch (e) {
      setError(creationRegionError(region, (e as Error).message));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="launch-page">
      <div className="page-heading">
        <div>
          <button
            className="back-link"
            onClick={() => panel.navigate("/lightsail")}
          >
            <ArrowLeft size={13} />
            返回实例列表
          </button>
          <h1>
            <Rocket size={23} />
            创建 Lightsail 实例
          </h1>
          <p>选择 Debian、Ubuntu 或 CentOS，配置网络、套餐与启动脚本</p>
        </div>
        <RefreshButton
          loading={catalog.loading}
          onClick={catalog.refresh}
          text="刷新目录"
        />
      </div>
      {!panel.accounts.length ? (
        <Empty
          title="先添加 AWS 账户"
          description="验证账户后，加载 Lightsail 镜像与套餐。"
          action={
            <button className="button primary" onClick={panel.openAccounts}>
              添加账户
            </button>
          }
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (userData.includes("root:你的密码")) {
              setError(
                "请将启动脚本中的“你的密码”替换为自己的密码，或清空脚本。",
              );
              return;
            }
            setError("");
            setConfirm(true);
          }}
        >
          <section className="form-panel">
            <h2>账户与区域</h2>
            <div className="form-grid">
              <Field label="AWS 账户">
                <Select
                  aria-label="创建账户"
                  value={accountId}
                  required
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setZone("");
                  }}
                >
                  {panel.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.awsAccountId}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="区域">
                <Select
                  aria-label="创建区域"
                  openFromStart
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    setZone("");
                  }}
                >
                  {panel.regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {regionLabel(r.id)}
                    </option>
                  ))}
                  {!panel.regions.some((r) => r.id === region) && (
                    <option value={region}>{regionLabel(region)}</option>
                  )}
                </Select>
              </Field>
              <Field
                label="可用区"
                help="可选项来自当前账户在此区域的实际可用区。"
              >
                <Select
                  aria-label="可用区"
                  required
                  value={zone}
                  disabled={!zones.length || catalog.loading}
                  onChange={(e) => setZone(e.target.value)}
                >
                  {!zones.length && (
                    <option value="">
                      {catalog.loading ? "加载可用区…" : "暂无可用区"}
                    </option>
                  )}
                  {zones.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>
          {catalog.error && (
            <ErrorBox
              message={creationRegionError(region, catalog.error)}
              retry={catalog.refresh}
            />
          )}{" "}
          {catalog.loading && !catalog.data && (
            <Busy text="加载 Lightsail 创建目录…" />
          )}
          {catalog.data?.warnings?.map((w) => (
            <div className="notice" key={w}>
              {w}
            </div>
          ))}
          <section className="form-panel">
            <h2>系统与套餐</h2>
            <fieldset className="network-options">
              <legend>选择网络类型</legend>
              <label className="network-option">
                <input
                  type="radio"
                  name="network-type"
                  value="dualstack"
                  checked={network === "dualstack"}
                  onChange={() => setNetwork("dualstack")}
                />
                <span>
                  <span className="network-title">
                    双堆栈 <span className="recommended">推荐</span>
                  </span>
                  <span className="network-description">
                    适用于需要完整网络兼容性的工作负载。包括一个公有 IPv4
                    地址和一个公有 IPv6 地址。
                  </span>
                </span>
              </label>
              <label className="network-option">
                <input
                  type="radio"
                  name="network-type"
                  value="ipv6"
                  checked={network === "ipv6"}
                  onChange={() => setNetwork("ipv6")}
                />
                <span>
                  <span className="network-title">仅限 IPv6</span>
                  <span className="network-description">
                    适用于不需要公有 IPv4 地址的工作负载。包括一个公有 IPv6
                    地址。
                  </span>
                </span>
              </label>
            </fieldset>
            <Field
              label="系统镜像"
              help={`当前区域 ${catalog.data?.images.length || 0} 个可用 Debian / Ubuntu / CentOS 镜像；名称、版本与蓝图 ID 均来自 AWS。`}
            >
              <Select
                aria-label="系统镜像"
                required
                value={imageId}
                onChange={(e) => setImage(e.target.value)}
              >
                <option value="" disabled>
                  选择系统镜像
                </option>
                {images.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.version && !i.name.includes(i.version)
                      ? " · " + i.version
                      : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {selectedImage && (
              <div className="image-blueprint">
                <span>AWS 蓝图 ID</span>
                <code>{selectedImage.id}</code>
              </div>
            )}
            <Field
              label="实例套餐"
              help={`通用型 · ${types.length} 个可选套餐 · ${network === "ipv6" ? "仅 IPv6" : "含公网 IPv4"}。按所选系统和 IP 类型筛选。`}
            >
              <BundlePicker
                bundles={types}
                value={instanceType}
                onChange={setType}
              />
            </Field>
          </section>
          <section className="form-panel">
            <h2>基本配置</h2>
            <div className="form-grid">
              <Field
                label="实例名称"
                help="2–63 位字母、数字、下划线或短横线。"
              >
                <input
                  aria-label="实例名称"
                  required
                  minLength={2}
                  maxLength={63}
                  pattern={"[a-zA-Z0-9_][a-zA-Z0-9_\\-]*[a-zA-Z0-9_]"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label="实例数量"
                help="多台实例自动添加 -1、-2 等名称后缀。"
              >
                <input
                  aria-label="实例数量"
                  type="number"
                  required
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </Field>
            </div>
          </section>
          <section className="form-panel">
            <h2>SSH 密钥</h2>
            <p>默认 SSH 密钥</p>
            <DefaultKeyDownload
              key={accountId + region}
              accountId={accountId}
              region={region}
            />
          </section>
          <section className="form-panel">
            <div className="section-heading">
              <h2>启动脚本</h2>
              <button
                type="button"
                className="text-link"
                onClick={() => setUserData(defaultStartupScript)}
              >
                恢复默认模板
              </button>
            </div>
            <Field
              label="首次启动时执行（可选）"
              help="先替换“你的密码”；不需要脚本时可清空。模板开启 root 密码登录。"
            >
              <textarea
                aria-label="启动脚本"
                className="code-input startup-script"
                value={userData}
                maxLength={16000}
                rows={7}
                placeholder={"#!/bin/bash\n"}
                onChange={(e) => setUserData(e.target.value)}
              />
            </Field>
            {/centos/i.test(imageId) && (
              <div className="notice script-note">
                <span>
                  CentOS 通常使用 sshd 服务，请把最后一行的 restart ssh 改为
                  restart sshd。
                </span>
                <button
                  type="button"
                  className="button small"
                  onClick={() =>
                    setUserData((s) =>
                      s.replace(
                        /systemctl restart ssh\b/g,
                        "systemctl restart sshd",
                      ),
                    )
                  }
                >
                  适配 CentOS
                </button>
              </div>
            )}
          </section>
          {error && <ErrorBox message={error} />}
          <div className="launch-footer">
            <span className="muted">创建实例将按 Lightsail 套餐计费。</span>
            <button
              className="button primary"
              disabled={
                busy ||
                catalog.loading ||
                !!catalog.error ||
                !selectedImage ||
                !zone ||
                !types.some((type) => type.id === instanceType)
              }
            >
              检查并创建
            </button>
          </div>
        </form>
      )}
      {confirm && (
        <Modal
          title="确认创建 Lightsail 实例"
          busy={busy}
          onClose={() => setConfirm(false)}
        >
          <dl className="details">
            <div>
              <dt>名称 / 数量</dt>
              <dd>
                {name} · {count} 台
              </dd>
            </div>
            <div>
              <dt>区域</dt>
              <dd>{regionLabel(region)}</dd>
            </div>
            <div>
              <dt>系统</dt>
              <dd>
                {catalog.data?.images.find((i) => i.id === imageId)?.name}
              </dd>
            </div>
            <div>
              <dt>可用区</dt>
              <dd>{zone}</dd>
            </div>
            <div>
              <dt>套餐</dt>
              <dd>
                {types.find((t) => t.id === instanceType)
                  ? bundleLabel(types.find((t) => t.id === instanceType)!)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>网络</dt>
              <dd>
                {network === "dualstack"
                  ? "IPv4 + IPv6"
                  : network === "ipv6"
                    ? "仅 IPv6"
                    : "仅 IPv4"}
              </dd>
            </div>
            <div>
              <dt>SSH 密钥</dt>
              <dd>Lightsail 默认密钥</dd>
            </div>
            <div>
              <dt>启动脚本</dt>
              <dd>{userData.trim() ? "已配置，首次启动时执行" : "未配置"}</dd>
            </div>
          </dl>
          <div className="modal-actions">
            <button
              className="button"
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              取消
            </button>
            <button className="button primary" disabled={busy} onClick={create}>
              {busy ? "正在创建…" : "确认创建"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
