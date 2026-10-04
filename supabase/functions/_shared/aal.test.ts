import { describe, expect, it } from "vitest";
import { aalFromJwt, countVerifiedFactors, mfaRequired, needsSecondFactor, passkeySignInFromJwt } from "./aal.ts";

// SEC-004 (etapa B): a decisão do segundo fator nas functions de admin. A
// sessão aberta com passkey de login (amr `passkey`) vale no lugar do código.

const jwt = (payload: Record<string, unknown>) => {
  const b64 = (s: string) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64('{"alg":"HS256"}')}.${b64(JSON.stringify(payload))}.assinatura`;
};

describe("aalFromJwt", () => {
  it("lê aal1 e aal2 do payload", () => {
    expect(aalFromJwt(jwt({ aal: "aal1" }))).toBe("aal1");
    expect(aalFromJwt(jwt({ aal: "aal2" }))).toBe("aal2");
  });
  it("sem claim, token inválido ou vazio: nulo, sem quebrar", () => {
    expect(aalFromJwt(jwt({ sub: "x" }))).toBeNull();
    expect(aalFromJwt("abc")).toBeNull();
    expect(aalFromJwt("a.%%%.c")).toBeNull();
    expect(aalFromJwt(null)).toBeNull();
    expect(aalFromJwt(undefined)).toBeNull();
  });
});

describe("passkeySignInFromJwt", () => {
  it("reconhece o amr da passkey de login", () => {
    expect(passkeySignInFromJwt(jwt({ aal: "aal1", amr: [{ method: "passkey", timestamp: 1 }] }))).toBe(true);
  });
  it("senha, código, amr estranho ou token inválido: não é passkey", () => {
    expect(passkeySignInFromJwt(jwt({ aal: "aal2", amr: [{ method: "totp" }, { method: "password" }] }))).toBe(false);
    expect(passkeySignInFromJwt(jwt({ aal: "aal1", amr: "passkey" }))).toBe(false);
    expect(passkeySignInFromJwt(jwt({ aal: "aal1", amr: [null, "passkey"] }))).toBe(false);
    expect(passkeySignInFromJwt("abc")).toBe(false);
    expect(passkeySignInFromJwt(null)).toBe(false);
  });
});

describe("needsSecondFactor", () => {
  it("AAL1 com fator verificado exige o código", () => {
    expect(needsSecondFactor("aal1", 1)).toBe(true);
    expect(needsSecondFactor(null, 2)).toBe(true);
  });
  it("AAL2 não exige", () => {
    expect(needsSecondFactor("aal2", 1)).toBe(false);
  });
  it("sessão aberta com passkey de login não exige", () => {
    expect(needsSecondFactor("aal1", 1, true)).toBe(false);
  });
  it("sem fator verificado não exige (o admin não fica trancado antes de ativar o MFA)", () => {
    expect(needsSecondFactor("aal1", 0)).toBe(false);
    expect(needsSecondFactor(null, 0)).toBe(false);
  });
});

describe("countVerifiedFactors", () => {
  it("conta só os verificados", () => {
    expect(countVerifiedFactors([{ status: "verified" }, { status: "unverified" }, {}])).toBe(1);
    expect(countVerifiedFactors(null)).toBe(0);
  });
});

describe("mfaRequired", () => {
  const client = (factors: Array<{ status: string }> | null) => ({
    auth: { admin: { mfa: { listFactors: async () => ({ data: factors ? { factors } : null }) } } },
  });
  it("AAL1 com fator verificado: recusa", async () => {
    expect(await mfaRequired(client([{ status: "verified" }]), "u1", jwt({ aal: "aal1" }))).toBe(true);
  });
  it("passkey de login com fator verificado: deixa passar", async () => {
    expect(await mfaRequired(client([{ status: "verified" }]), "u1", jwt({ aal: "aal1", amr: [{ method: "passkey" }] }))).toBe(false);
  });
  it("AAL2, sem fator, ou resposta vazia: deixa passar", async () => {
    expect(await mfaRequired(client([{ status: "verified" }]), "u1", jwt({ aal: "aal2" }))).toBe(false);
    expect(await mfaRequired(client([{ status: "unverified" }]), "u1", jwt({ aal: "aal1" }))).toBe(false);
    expect(await mfaRequired(client(null), "u1", jwt({ aal: "aal1" }))).toBe(false);
  });
});
