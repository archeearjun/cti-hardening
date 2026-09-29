// Per-host bindings keep byte/XML adapters isolated between engine instances.
const hosts = new WeakMap();
export function bindServices(factory, services) {
  let bindings = hosts.get(services);
  if (!bindings) hosts.set(services, bindings = new Map());
  if (!bindings.has(factory)) bindings.set(factory, factory(services));
  return bindings.get(factory);
}
