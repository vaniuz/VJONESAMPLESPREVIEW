const childProcess = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

if (process.platform === "win32") {
  const originalExec = childProcess.exec;
  childProcess.exec = function patchedExec(command, ...args) {
    if (command === "net use") {
      const callback = args.find((arg) => typeof arg === "function");
      if (callback) process.nextTick(() => callback(null, "", ""));
      return undefined;
    }
    return originalExec.call(this, command, ...args);
  };
  syncBuiltinESMExports();
}
