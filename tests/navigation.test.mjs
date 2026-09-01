import assert from "node:assert/strict";
import test from "node:test";
import { browserNavigate, navigateInternalLink } from "../src/navigation.ts";

const clickEvent = (overrides = {}) => {
  let prevented = false;
  return {
    button: 0,
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    currentTarget: { target: "" },
    preventDefault() { prevented = true; },
    get prevented() { return prevented; },
    ...overrides,
  };
};

test("plain internal link clicks use the injected navigation seam", () => {
  const event = clickEvent();
  const destinations = [];

  navigateInternalLink(event, (href) => destinations.push(href), "/settings/organization");

  assert.equal(event.prevented, true);
  assert.deepEqual(destinations, ["/settings/organization"]);
});

test("modified and new-tab clicks retain native anchor navigation", () => {
  for (const event of [clickEvent({ metaKey: true }), clickEvent({ button: 1 }), clickEvent({ currentTarget: { target: "_blank" } })]) {
    let called = false;
    navigateInternalLink(event, () => { called = true; }, "/projects");
    assert.equal(event.prevented, false);
    assert.equal(called, false);
  }
});

test("browser navigation is the portable fallback", () => {
  const originalWindow = globalThis.window;
  const destinations = [];
  globalThis.window = { location: { assign: (href) => destinations.push(href) } };
  try {
    browserNavigate("/studio/project-01");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
  assert.deepEqual(destinations, ["/studio/project-01"]);
});
