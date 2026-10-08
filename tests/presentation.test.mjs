import assert from "node:assert/strict";
import test from "node:test";
import { nextSnapshot } from "../src/lib/api-snapshot.ts";
import {
  bundleLabel,
  bundlePrice,
  bundleSpecs,
  bundleDetails,
  isGeneralBundle,
  memoryLabel,
} from "../src/lib/bundle.ts";
import {
  creationRegionError,
  isRegionalAccessError,
} from "../src/lib/region-access.ts";
import { money, moneyAxis, number, percent } from "../src/lib/format.ts";

const current = () => ({
  path: "/metrics?instance=a&hours=3",
  retainKey: "metrics:account:a:instance:a",
  dataPath: "/metrics?instance=a&hours=3",
  data: { items: [{ at: "2026-10-08T00:00:00Z", CPUUtilization: 12 }] },
  error: "",
  loading: false,
});

test("time-range transitions retain results only for the same account and instance", () => {
  const previous = current();
  const range = nextSnapshot(
    previous,
    "/metrics?instance=a&hours=168",
    previous.retainKey,
  );
  assert.strictEqual(range.data, previous.data);
  assert.equal(range.dataPath, previous.path);
  assert.equal(range.loading, true);
  assert.equal(range.error, "");
  const other = nextSnapshot(
    previous,
    "/metrics?instance=b&hours=168",
    "metrics:account:b:instance:b",
  );
  assert.equal(other.data, undefined);
  assert.equal(other.dataPath, undefined);
  assert.equal(nextSnapshot(previous, "/unrelated", undefined).data, undefined);
});

test("range caches replace retained data immediately and clearing a target removes old results", () => {
  const previous = current();
  const path = "/metrics?instance=a&hours=168";
  const cached = { items: [] };
  const result = nextSnapshot(previous, path, previous.retainKey, cached);
  assert.strictEqual(result.data, cached);
  assert.equal(result.dataPath, path);
  assert.equal(result.loading, false);
  const cleared = nextSnapshot(previous, null, previous.retainKey);
  assert.equal(cleared.data, undefined);
  assert.equal(cleared.loading, false);
  const refreshed = nextSnapshot(previous, previous.path, previous.retainKey);
  assert.strictEqual(refreshed.data, previous.data);
  assert.equal(refreshed.loading, true);
});

test("traffic keeps fixed decimals while whole bundle parameters have no trailing decimals", () => {
  assert.equal(money(0.308), "US$0.3080");
  assert.equal(money(2), "US$2.0000");
  assert.equal(money(-0.25), "-US$0.2500");
  assert.equal(moneyAxis(2), "$2.0000");
  assert.equal(number(2), "2.00");
  assert.equal(percent(50), "50.00%");
  const label = bundleLabel({
    id: "x",
    name: "AWS name",
    cpu: 2,
    memory: 0.5,
    disk: 20,
    price: 5,
    transfer: 1024,
    ipv4: true,
  });
  assert.match(label, /2 vCPU \/ 512 MB \/ 20 GB SSD/);
  assert.match(label, /US\$5\/月/);
  assert.match(label, /1,024 GB 流量/);
  assert.equal(memoryLabel(1), "1 GB");
  assert.equal(memoryLabel(1.5), "1.5 GB");
});

test("bundle filtering excludes memory, compute and research families for both IP types", () => {
  for (const id of ["nano_3_0", "micro_ipv6_3_0", "16xlarge_3_0", "small_2_0"])
    assert.equal(isGeneralBundle({ id }), true, id);
  for (const id of [
    "m_large_1_0",
    "m_large_ipv6_1_0",
    "c_large_1_0",
    "c_large_ipv6_1_0",
    "gpu_xlarge",
    "standard_2xl",
    "large_unknown",
  ])
    assert.equal(isGeneralBundle({ id }), false, id);
  const bundle = {
    id: "nano_3_0",
    name: "Nano",
    cpu: 2,
    memory: 0.5,
    disk: 20,
    price: 5,
    transfer: 1024,
  };
  assert.equal(bundleSpecs(bundle), "512 MB 内存 · 2 vCPU");
  assert.equal(bundlePrice(bundle), "US$5/月");
  assert.equal(bundleDetails(bundle), "20 GB SSD · 1 TB 流量/月");
  assert.equal(bundlePrice({ ...bundle, price: 3.5 }), "US$3.5/月");
});

test("regional access warnings are deferred to creation while account and network errors remain visible", () => {
  const message =
    "UnrecognizedClientException: The security token included in the request is invalid.";
  assert.equal(isRegionalAccessError("ap-southeast-3", message), true);
  assert.match(
    creationRegionError("ap-southeast-3", message),
    /Jakarta.*创建实例.*AWS 启用/,
  );
  for (const error of [
    message,
    "AccessDeniedException: permission missing",
    "连接超时",
  ])
    assert.equal(creationRegionError("ap-southeast-1", error), error);
  assert.equal(isRegionalAccessError("ap-southeast-3", "连接超时"), false);
});
