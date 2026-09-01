import assert from "node:assert/strict";
import test from "node:test";
import { isNonContactLabel } from "../src/integrations/privacy.ts";

test("non-contact labels reject contact shapes hidden with Unicode formatting and variation controls", () => {
  const contactValues = [
    "https\u2066:\u2066/\u2066/example\u2066.\u2066invalid",
    "www\u200E.\u200Eexample\u200E.invalid",
    "discord\u00AD:venue-owner",
    "slack\uFE0F U123ABC",
    "tel\u180E:14155550101",
    "telegram\u202E:venue-owner",
    "whatsapp\u2069:venue-owner",
    "wechat\u{E0100}:venue-owner",
  ];

  for (const value of contactValues) assert.equal(isNonContactLabel(value), false, JSON.stringify(value));
});

test("non-contact labels retain ordinary operational labels", () => {
  for (const value of ["Event Operations", "Expo 2026-2027", "AV / Power", "Front-of-house team"]) {
    assert.equal(isNonContactLabel(value), true, value);
  }
});
