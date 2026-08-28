import { AdapterContractError } from "./contracts.js";

const SECRET_REFERENCE = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/;

export function assertSecretReference(reference) {
  if (typeof reference !== "string" || !SECRET_REFERENCE.test(reference)) throw new AdapterContractError("ADAPTER_SECRET_REFERENCE_INVALID", "Secret references must be opaque lowercase paths");
  return reference;
}

export function createMemorySecretStore(entries = {}) {
  const secrets = new Map(Object.entries(entries));
  return Object.freeze({
    async get(reference) {
      assertSecretReference(reference);
      if (!secrets.has(reference)) throw new AdapterContractError("ADAPTER_SECRET_NOT_FOUND", "Adapter secret is unavailable", { reference });
      return secrets.get(reference);
    },
  });
}

export function createScopedSecretReader(secretStore, allowedReferences = []) {
  if (!secretStore || typeof secretStore.get !== "function") throw new AdapterContractError("ADAPTER_SECRET_STORE_REQUIRED", "A secret store boundary is required");
  const allowed = new Set(allowedReferences.map(assertSecretReference));
  return Object.freeze({
    async get(reference) {
      assertSecretReference(reference);
      if (!allowed.has(reference)) throw new AdapterContractError("ADAPTER_SECRET_SCOPE_DENIED", "Adapter cannot access this secret reference", { reference });
      return secretStore.get(reference);
    },
  });
}
