import assert from "node:assert/strict"
import test from "node:test"
import plugin from "../src/server.js"

test("allows all permissions for built-in and custom agents", async () => {
  const hooks = await plugin.server()
  const config = {
    agent: {
      custom: { permission: "deny", model: "openai/gpt-5" },
    },
  }

  hooks.config(config)

  assert.equal(config.permission, "allow")
  assert.equal(config.agent.custom.permission, "allow")
  assert.equal(config.agent.custom.model, "openai/gpt-5")
  for (const name of ["build", "plan", "general", "explore"]) {
    assert.equal(config.agent[name].permission, "allow")
  }
})

test("automatically approves permission prompts", async () => {
  const hooks = await plugin.server()
  const output = { status: "ask" }

  hooks["permission.ask"]({}, output)

  assert.equal(output.status, "allow")
})
