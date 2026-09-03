import { AdapterContractError } from "./contracts.ts";

const SECRET_REFERENCE = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/;

export function assertSecretReference(reference: unknown): string {
  if (typeof reference !== "string" || !SECRET_REFERENCE.test(reference))
    throw new AdapterContractError(
      "ADAPTER_SECRET_REFERENCE_INVALID",
      "Secret references must be opaque lowercase paths",
    );
  return reference;
}

export interface SecretReader {
  get(reference: string): Promise<string>;
}

export function createMemorySecretStore(entries: Readonly<Record<string, string>> = {}): Readonly<SecretReader> {
  const secrets = new Map<string, string>(Object.entries(entries));
  return Object.freeze({
    get(reference: string) {
      assertSecretReference(reference);
      if (!secrets.has(reference))
        throw new AdapterContractError("ADAPTER_SECRET_NOT_FOUND", "Adapter secret is unavailable", { reference });
      const secret = secrets.get(reference);
      if (secret === undefined)
        throw new AdapterContractError("ADAPTER_SECRET_NOT_FOUND", "Adapter secret is unavailable", { reference });
      return Promise.resolve(secret);
    },
  });
}

export function createScopedSecretReader(
  secretStore: SecretReader | null | undefined,
  allowedReferences: readonly string[] = [],
): Readonly<SecretReader> {
  if (!secretStore || typeof secretStore.get !== "function")
    throw new AdapterContractError("ADAPTER_SECRET_STORE_REQUIRED", "A secret store boundary is required");
  const allowed = new Set(allowedReferences.map(assertSecretReference));
  return Object.freeze({
    async get(reference: string) {
      assertSecretReference(reference);
      if (!allowed.has(reference))
        throw new AdapterContractError("ADAPTER_SECRET_SCOPE_DENIED", "Adapter cannot access this secret reference", {
          reference,
        });
      return secretStore.get(reference);
    },
  });
}
