import { AdapterContractError } from "./contracts.ts";

const SECRET_REFERENCE = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/;

export function assertSecretReference(reference: any) {
  if (typeof reference !== "string" || !SECRET_REFERENCE.test(reference)) throw new AdapterContractError("ADAPTER_SECRET_REFERENCE_INVALID", "Secret references must be opaque lowercase paths");
  return reference;
}

export function createMemorySecretStore(entries: any = {}) {
  const secrets: any = new Map(Object.entries(entries));
  return Object.freeze({
    async get(reference: any) {
      assertSecretReference(reference);
      if (!secrets.has(reference)) throw new AdapterContractError("ADAPTER_SECRET_NOT_FOUND", "Adapter secret is unavailable", { reference });
      return secrets.get(reference);
    },
  });
}

export function createScopedSecretReader(secretStore: any, allowedReferences: any = []) {
  if (!secretStore || typeof secretStore.get !== "function") throw new AdapterContractError("ADAPTER_SECRET_STORE_REQUIRED", "A secret store boundary is required");
  const allowed: any = new Set(allowedReferences.map(assertSecretReference));
  return Object.freeze({
    async get(reference: any) {
      assertSecretReference(reference);
      if (!allowed.has(reference)) throw new AdapterContractError("ADAPTER_SECRET_SCOPE_DENIED", "Adapter cannot access this secret reference", { reference });
      return secretStore.get(reference);
    },
  });
}
