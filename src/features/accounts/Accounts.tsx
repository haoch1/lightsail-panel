import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Account } from "../../../shared/types";
import { usePanel } from "../../app/context";
import { Empty, Modal, RefreshButton } from "../../components/ui";
import { api } from "../../lib/api";
import AddAccount from "./AddAccount";

export default function Accounts({ onClose }: { onClose: () => void }) {
  const { accounts, toast, refreshAccounts, demo } = usePanel();
  const [add, setAdd] = useState(false);
  const [remove, setRemove] = useState<Account | null>(null);
  const [busy, setBusy] = useState("");
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 160);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const view = add ? "add" : remove ? "remove" : "list";
  function closeView() {
    if (busy || closing) return;
    if (add) setAdd(false);
    else if (remove) setRemove(null);
    else setClosing(true);
  }
  let content;
  if (add)
    content = (
      <AddAccount
        busy={busy === "add"}
        onBusyChange={(value) => setBusy(value ? "add" : "")}
        onClose={closeView}
        onDone={() => {
          setAdd(false);
          refreshAccounts();
        }}
      />
    );
  else if (remove)
    content = (
      <>
        <p>移除面板保存的账户凭证。AWS 上的资源不会被删除。</p>
        <div className="modal-actions">
          <button className="button" disabled={!!busy} onClick={closeView}>
            取消
          </button>
          <button
            className="button danger"
            disabled={!!busy}
            onClick={async () => {
              setBusy("remove");
              try {
                await api("/accounts/" + remove.id, undefined, "DELETE");
                toast("账户已移除");
                setRemove(null);
                refreshAccounts();
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBusy("");
              }
            }}
          >
            确认移除
          </button>
        </div>
      </>
    );
  else
    content = (
      <>
        <div className="account-manager-toolbar">
          <span className="muted">共 {accounts.length} 个账户</span>
          <button
            className="button primary"
            onClick={() => setAdd(true)}
            disabled={!!busy}
          >
            <Plus size={15} /> 添加 AWS 账户
          </button>
        </div>
        <div className="table-wrap account-table">
          <table>
            <thead>
              <tr>
                <th>账户</th>
                <th>AWS Account ID</th>
                <th>凭证</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <strong>{account.name}</strong>
                  </td>
                  <td className="numeric">{account.awsAccountId}</td>
                  <td>
                    <KeyRound size={12} className="inline-icon" />
                    {account.authType === "default"
                      ? "旧凭证配置"
                      : account.keyHint}
                  </td>
                  <td>
                    <div className="row-actions">
                      <RefreshButton
                        text="验证"
                        className="small"
                        loading={busy === account.id}
                        onClick={async () => {
                          if (busy) return;
                          setBusy(account.id);
                          try {
                            await api(
                              "/accounts/" + account.id + "/verify",
                              {},
                            );
                            toast(demo ? "演示验证完成" : "AWS 身份验证通过");
                          } catch (e) {
                            toast((e as Error).message, "error");
                          } finally {
                            setBusy("");
                          }
                        }}
                      />
                      <button
                        className="icon-button danger-text"
                        disabled={!!busy}
                        aria-label={"移除账户 " + account.name}
                        onClick={() => setRemove(account)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!accounts.length && (
            <Empty
              title="尚未添加 AWS 账户"
              description="使用 Access Key ID 与 Secret Access Key 添加账户。"
            />
          )}
        </div>
        <p className="account-manager-note">
          凭证加密保存在服务器，AWS API 使用服务器直连。
        </p>
      </>
    );
  return (
    <Modal
      title={add ? "添加 AWS 账户" : remove ? "移除 AWS 账户" : "AWS 账户"}
      description={
        add
          ? demo
            ? "演示模式只添加示例账户，请勿输入真实密钥。"
            : "验证 AWS 身份后保存加密凭证。"
          : remove
            ? remove.name
            : "添加、验证和管理面板保存的 AWS 账户。"
      }
      className="account-manager-modal"
      backdropClassName={
        "account-manager-backdrop" + (closing ? " closing" : "")
      }
      viewKey={view}
      onClose={closeView}
      busy={!!busy || closing}
    >
      {content}
    </Modal>
  );
}
