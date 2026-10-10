const labels: Record<string, string> = {
  setup: "初始化管理员",
  refresh: "刷新资源",
  "add-account": "添加 AWS 账户",
  "delete-account": "移除 AWS 账户",
  start: "启动实例",
  stop: "停止实例",
  reboot: "重启实例",
  terminate: "删除实例",
  launch: "创建实例",
  "launch-network": "配置实例网络",
  "operation-complete": "更新资源状态",
  "enable-ipv6": "启用 IPv6",
  "disable-ipv6": "关闭 IPv6",
  "rotate-ip": "更换公网 IP",
  "rotate-ip-rollback": "恢复静态 IP 绑定",
  "rotate-ip-cleanup": "释放临时静态 IP",
  "static-ip-allocate": "分配静态 IP",
  "static-ip-attach": "绑定静态 IP",
  "static-ip-detach": "解绑静态 IP",
  "static-ip-release": "释放静态 IP",
  "open-port": "开放防火墙端口",
  "close-port": "关闭防火墙端口",
  "download-default-key": "下载默认 SSH 私钥",
  "ssh-connect": "SSH 终端",
  "traffic-limit": "设置自动关机",
  "traffic-auto-stop": "执行自动关机",
  "traffic-auto-stop-check": "检查自动关机规则",
};

export function auditActionLabel(action: string) {
  if (Object.hasOwn(labels, action)) return labels[action];
  return /\p{Script=Han}/u.test(action) ? action : `其他操作（${action}）`;
}
