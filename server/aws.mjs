import * as catalog from "./aws/catalog.mjs";
import * as instances from "./aws/instances.mjs";
import * as keys from "./aws/keys.mjs";
import * as monitoring from "./aws/monitoring.mjs";
import * as networking from "./aws/networking.mjs";
import * as transport from "./aws/transport.mjs";
export { modules, usedCommands } from "./aws/sdk.mjs";
export { mapLimit, paginate, scrubError } from "./aws/shared.mjs";

// Thin facade: shared connection/cache state, explicit domain operations.
export class AwsGateway {
  constructor(store) {
    this.store = store;
    this.clients = new Map();
    this.roles = new Map();
    this.regionCache = new Map();
    this.locks = new Set();
  }
  invalidate() {
    for (const { client } of this.clients.values()) client.destroy();
    this.clients.clear();
    this.roles.clear();
    this.regionCache.clear();
  }
  options(...args) {
    return transport.options(this, ...args);
  }
  credentials(...args) {
    return transport.credentials(this, ...args);
  }
  client(...args) {
    return transport.client(this, ...args);
  }
  send(...args) {
    return transport.send(this, ...args);
  }
  identity(...args) {
    return transport.identity(this, ...args);
  }
  regions(...args) {
    return catalog.regions(this, ...args);
  }
  catalog(...args) {
    return catalog.catalog(this, ...args);
  }
  instances(...args) {
    return instances.instances(this, ...args);
  }
  scan(...args) {
    return instances.scan(this, ...args);
  }
  perform(...args) {
    return instances.perform(this, ...args);
  }
  launch(...args) {
    return instances.launch(this, ...args);
  }
  waitLightsail(...args) {
    return instances.waitLightsail(this, ...args);
  }
  rotateIp(...args) {
    return networking.rotateIp(this, ...args);
  }
  staticIps(...args) {
    return networking.staticIps(this, ...args);
  }
  staticIpOperation(...args) {
    return networking.staticIpOperation(this, ...args);
  }
  ports(...args) {
    return networking.ports(this, ...args);
  }
  updatePorts(...args) {
    return networking.updatePorts(this, ...args);
  }
  downloadDefaultKeyPair(...args) {
    return keys.downloadDefaultKeyPair(this, ...args);
  }
  traffic(...args) {
    return monitoring.traffic(this, ...args);
  }
}
