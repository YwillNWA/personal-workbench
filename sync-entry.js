import { Account, Client, ID, Permission, Role, TablesDB } from "appwrite";

const ENDPOINT = "https://sgp.cloud.appwrite.io/v1";
const PROJECT_ID = "6a6a21710012ca9ad9e9";
const DATABASE_ID = "6a6a7d5200042beebe4f";
const TABLE_ID = "snapshots";

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
const account = new Account(client);
const tables = new TablesDB(client);
const workbench = window.workbench;

const $ = (selector) => document.querySelector(selector);
const ui = {
  modal: $("#syncModal"),
  open: $("#syncOpen"),
  close: $("#syncClose"),
  form: $("#syncLoginForm"),
  email: $("#syncEmail"),
  send: $("#syncSendCode"),
  otpArea: $("#syncOtpArea"),
  otp: $("#syncOtp"),
  verify: $("#syncVerify"),
  message: $("#syncMessage"),
  signedIn: $("#syncSignedIn"),
  userEmail: $("#syncUserEmail"),
  logout: $("#syncLogout"),
  syncNow: $("#syncNow"),
  sidebarTitle: $("#syncSidebarTitle"),
  sidebarText: $("#syncSidebarText")
};

let currentUser = null;
let pendingUserId = sessionStorage.getItem("desk.otp-user") || "";
let applyingRemote = false;
let saveTimer = null;
let syncInFlight = null;

const errorMessage = (error) => {
  if (!navigator.onLine) return "当前网络不可用，本机记录不受影响。";
  if (error?.code === 429) return "操作有些频繁，请稍后再试。";
  if (error?.code === 401) return "验证码不正确或已过期，请重新获取。";
  return error?.message || "同步暂时没有成功，请稍后再试。";
};

const setMessage = (message, isError = false) => {
  ui.message.textContent = message;
  ui.message.style.color = isError ? "#bd6f72" : "var(--mint)";
};

const setBusy = (busy, button, busyText) => {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
  button.disabled = busy;
};

const renderSession = () => {
  const loggedIn = Boolean(currentUser);
  ui.form.hidden = loggedIn;
  ui.signedIn.hidden = !loggedIn;
  ui.userEmail.textContent = currentUser?.email || "";
  ui.sidebarTitle.textContent = loggedIn ? "云同步已开启" : "开启云同步";
  ui.sidebarText.textContent = loggedIn
    ? `${currentUser.email} · 自动同步`
    : "无需密码，同一邮箱即可跨设备使用。";
};

const isMeaningful = (state) => {
  if ((state.workouts?.length || 0) > 0 || (state.ideas?.length || 0) > 0) return true;
  return Object.values(state.tasks || {}).some((items) =>
    Array.isArray(items) && items.some((task) => !task.fixed || task.done)
  );
};

const permissionsFor = (userId) => [
  Permission.read(Role.user(userId)),
  Permission.update(Role.user(userId)),
  Permission.delete(Role.user(userId))
];

const saveToCloud = async ({ silent = false } = {}) => {
  if (!currentUser || applyingRemote || !navigator.onLine) return;
  if (syncInFlight) await syncInFlight;

  const operation = async () => {
    if (!silent) setMessage("正在同步…");
    const state = workbench.exportData();
    await tables.upsertRow({
      databaseId: DATABASE_ID,
      tableId: TABLE_ID,
      rowId: currentUser.$id,
      data: { payload: JSON.stringify(state) },
      permissions: permissionsFor(currentUser.$id)
    });
    if (!silent) setMessage("已同步到云端");
    ui.sidebarTitle.textContent = "云同步已开启";
  };

  syncInFlight = operation();
  try {
    await syncInFlight;
  } catch (error) {
    setMessage(errorMessage(error), true);
    ui.sidebarTitle.textContent = "等待下次同步";
    if (!silent) throw error;
  } finally {
    syncInFlight = null;
  }
};

const importRemote = (state) => {
  applyingRemote = true;
  try {
    workbench.importData(state);
  } finally {
    applyingRemote = false;
  }
};

const loadFromCloud = async ({ initial = false, notify = false } = {}) => {
  if (!currentUser || !navigator.onLine) return;
  try {
    const row = await tables.getRow({
      databaseId: DATABASE_ID,
      tableId: TABLE_ID,
      rowId: currentUser.$id
    });
    const remote = JSON.parse(row.payload);
    const local = workbench.exportData();
    const remoteTime = Date.parse(remote.updatedAt || 0);
    const localTime = Date.parse(local.updatedAt || 0);

    if (initial && isMeaningful(local) && localTime > remoteTime) {
      await saveToCloud({ silent: !notify });
    } else if (initial || remoteTime > localTime) {
      importRemote(remote);
      if (notify) workbench.toast("已从云端更新");
    } else if (notify) {
      workbench.toast("当前已是最新");
    }
    setMessage("已同步到云端");
  } catch (error) {
    if (error?.code === 404) {
      await saveToCloud({ silent: !notify });
      if (notify) workbench.toast("本机记录已上传");
      return;
    }
    setMessage(errorMessage(error), true);
    if (notify) throw error;
  }
};

const startSession = async () => {
  try {
    currentUser = await account.get();
    renderSession();
    await loadFromCloud({ initial: true });
  } catch {
    currentUser = null;
    renderSession();
  }
};

ui.open.addEventListener("click", () => {
  ui.modal.classList.add("show");
  if (!currentUser) ui.email.focus();
});
ui.close.addEventListener("click", () => ui.modal.classList.remove("show"));
ui.modal.addEventListener("click", (event) => {
  if (event.target === ui.modal) ui.modal.classList.remove("show");
});

ui.send.addEventListener("click", async () => {
  const email = ui.email.value.trim();
  if (!ui.email.reportValidity() || !email) return;
  setBusy(true, ui.send, "正在发送…");
  setMessage("");
  try {
    const token = await account.createEmailToken({
      userId: ID.unique(),
      email,
      phrase: false
    });
    pendingUserId = token.userId;
    sessionStorage.setItem("desk.otp-user", pendingUserId);
    ui.otpArea.hidden = false;
    ui.email.disabled = true;
    setMessage("验证码已发送，15 分钟内有效。");
    ui.otp.focus();
  } catch (error) {
    setMessage(errorMessage(error), true);
  } finally {
    setBusy(false, ui.send);
  }
});

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const secret = ui.otp.value.trim();
  if (!pendingUserId || !secret) return;
  setBusy(true, ui.verify, "正在登录…");
  try {
    await account.createSession({ userId: pendingUserId, secret });
    sessionStorage.removeItem("desk.otp-user");
    pendingUserId = "";
    currentUser = await account.get();
    renderSession();
    setMessage("登录成功，正在合并数据…");
    await loadFromCloud({ initial: true });
    workbench.toast("云同步已开启");
  } catch (error) {
    setMessage(errorMessage(error), true);
  } finally {
    setBusy(false, ui.verify);
  }
});

ui.logout.addEventListener("click", async () => {
  setBusy(true, ui.logout, "正在退出…");
  try {
    await account.deleteSession({ sessionId: "current" });
  } catch {
    // Session may already be expired; local mode should still be restored.
  }
  currentUser = null;
  ui.email.disabled = false;
  ui.email.value = "";
  ui.otp.value = "";
  ui.otpArea.hidden = true;
  setMessage("");
  renderSession();
  setBusy(false, ui.logout);
  workbench.toast("已退出云同步，本机数据仍保留");
});

ui.syncNow.addEventListener("click", async () => {
  setBusy(true, ui.syncNow, "同步中…");
  try {
    await loadFromCloud({ notify: true });
  } catch {
    workbench.toast("同步暂时失败");
  } finally {
    setBusy(false, ui.syncNow);
  }
});

window.addEventListener("workbench:data-changed", () => {
  if (!currentUser || applyingRemote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveToCloud({ silent: true }), 800);
});

window.addEventListener("online", () => {
  if (currentUser) loadFromCloud();
});
window.addEventListener("focus", () => {
  if (currentUser) loadFromCloud();
});
setInterval(() => {
  if (currentUser && document.visibilityState === "visible") loadFromCloud();
}, 60000);

renderSession();
startSession();
