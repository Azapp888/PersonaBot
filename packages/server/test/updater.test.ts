import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDeployMode, isRunningInContainer, currentVersion } from "../src/updater/service";

test("部署方式：可通过环境变量强制指定", () => {
  const prev = process.env.PERSONABOT_FORCE_DEPLOY_MODE;
  try {
    process.env.PERSONABOT_FORCE_DEPLOY_MODE = "docker";
    assert.equal(detectDeployMode(), "docker");
    process.env.PERSONABOT_FORCE_DEPLOY_MODE = "unknown";
    assert.equal(detectDeployMode(), "unknown");
    process.env.PERSONABOT_FORCE_DEPLOY_MODE = "git";
    assert.equal(detectDeployMode(), "git");
  } finally {
    if (prev === undefined) delete process.env.PERSONABOT_FORCE_DEPLOY_MODE;
    else process.env.PERSONABOT_FORCE_DEPLOY_MODE = prev;
  }
});

test("容器检测：PERSONABOT_DEPLOY=docker 时视为容器环境", () => {
  const prev = process.env.PERSONABOT_DEPLOY;
  try {
    process.env.PERSONABOT_DEPLOY = "docker";
    assert.equal(isRunningInContainer(), true);
  } finally {
    if (prev === undefined) delete process.env.PERSONABOT_DEPLOY;
    else process.env.PERSONABOT_DEPLOY = prev;
  }
});

test("版本标识：优先取 GIT_COMMIT", () => {
  const prevCommit = process.env.GIT_COMMIT;
  const prevVersion = process.env.APP_VERSION;
  try {
    delete process.env.APP_VERSION;
    process.env.GIT_COMMIT = "deadbee";
    assert.equal(currentVersion(), "deadbee");
    delete process.env.GIT_COMMIT;
    process.env.APP_VERSION = "1.2.3";
    assert.equal(currentVersion(), "1.2.3");
  } finally {
    if (prevCommit === undefined) delete process.env.GIT_COMMIT;
    else process.env.GIT_COMMIT = prevCommit;
    if (prevVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = prevVersion;
  }
});
