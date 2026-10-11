import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedCommandReason, isUserAllowedForShell, parseAllowedUsers, runShellCommand } from "../src/agent/shell";

test("拦截递归删除根目录", () => {
  assert.ok(blockedCommandReason("rm -rf /"));
  assert.ok(blockedCommandReason("rm -rf ~"));
  assert.ok(blockedCommandReason("rm -rf /*"));
});

test("拦截格式化与块设备写入", () => {
  assert.ok(blockedCommandReason("mkfs.ext4 /dev/sda1"));
  assert.ok(blockedCommandReason("dd if=/dev/zero of=/dev/sda"));
});

test("拦截关机与清空防火墙", () => {
  assert.ok(blockedCommandReason("shutdown -h now"));
  assert.ok(blockedCommandReason("reboot"));
  assert.ok(blockedCommandReason("iptables -F"));
});

test("放行普通命令", () => {
  assert.equal(blockedCommandReason("ls -la"), null);
  assert.equal(blockedCommandReason("echo hello"), null);
  assert.equal(blockedCommandReason("cat README.md"), null);
  assert.equal(blockedCommandReason("rm -rf ./dist"), null);
});

test("runShellCommand 对危险命令直接拒绝且不执行", async () => {
  const r = await runShellCommand("rm -rf /");
  assert.equal(r.ok, false);
  assert.ok(r.output.includes("安全策略"));
});

test("命令用户白名单解析", () => {
  assert.deepEqual(parseAllowedUsers("10001\n10002,10003；10004"), ["10001", "10002", "10003", "10004"]);
  assert.deepEqual(parseAllowedUsers(""), []);
});

test("白名单为空时允许所有用户", () => {
  assert.equal(isUserAllowedForShell("", "anyone"), true);
  assert.equal(isUserAllowedForShell(undefined, "anyone"), true);
});

test("白名单非空时仅允许名单内用户", () => {
  assert.equal(isUserAllowedForShell("10001,10002", "10001"), true);
  assert.equal(isUserAllowedForShell("10001,10002", "10003"), false);
});
