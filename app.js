import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCFWueR_eNOjqd6e-Z7CPPXQ9xiksjyz1M",
  authDomain: "mercado-local-371cd.firebaseapp.com",
  projectId: "mercado-local-371cd",
  storageBucket: "mercado-local-371cd.firebasestorage.app",
  messagingSenderId: "249353528384",
  appId: "1:249353528384:web:3d4e840c2d328d01012ba5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  user: undefined,
  profile: undefined,
  tab: "overview",
  unsubscribers: [],
  realtimeReady: {
    promotions: false,
    rewards: false
  },
  seenPendingRequests: {
    promotions: new Set(),
    rewards: new Set()
  },
  data: {
    users: [],
    businesses: [],
    orders: [],
    applications: [],
    accountDeletionRequests: [],
    businessDeletionRequests: [],
    promotions: [],
    rewards: [],
    redemptions: [],
    promotionCodes: [],
    rewardCodes: []
  }
};

const labels = {
  sent: "Nuevo",
  received: "En coordinación",
  completed: "Entregado",
  cancelled: "Cancelado",
  pending: "Pendiente",
  code_generated: "Código generado",
  rejected: "Rechazado",
  approved: "Aprobado",
  active: "Activo",
  expired: "Expirado"
};

const authView = document.querySelector("#auth-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const statusMessage = document.querySelector("#status-message");
const pageTitle = document.querySelector("#page-title");
const notificationButton = document.querySelector("#notification-button");
const toastStack = document.querySelector("#toast-stack");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch {
    loginError.textContent = "No pudimos iniciar sesión. Revisa el correo y la contraseña.";
  }
});

document.querySelector("#logout-button").addEventListener("click", () => signOut(auth));
document.querySelector("#refresh-button").addEventListener("click", () => loadAll());
notificationButton?.addEventListener("click", () => requestBrowserNotifications());
document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    render();
  });
});

onAuthStateChanged(auth, async (user) => {
  state.user = user ?? undefined;
  if (!user) {
    stopRealtime();
    state.profile = undefined;
    showAuth();
    return;
  }
  const profileSnapshot = await getDoc(doc(db, "users", user.uid));
  const profile = profileSnapshot.exists() ? normalizeDoc(profileSnapshot) : undefined;
  if (profile?.role !== "admin") {
    await signOut(auth);
    loginError.textContent = "Esta cuenta no tiene permisos de administrador.";
    return;
  }
  state.profile = profile;
  showDashboard();
  statusMessage.textContent = "Conectando datos en vivo...";
  await loadAll();
  startRealtime();
});

function showAuth() {
  authView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
}

function showDashboard() {
  authView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
  updateNotificationButton();
}

async function loadCollection(name, sorted = true) {
  const ref = collection(db, name);
  const snapshot = await getDocs(sorted ? query(ref, orderBy("createdAt", "desc"), limit(100)) : query(ref, limit(100)));
  return snapshot.docs.map(normalizeDoc);
}

async function loadAll() {
  statusMessage.textContent = "Cargando datos...";
  try {
    const [
      users,
      businesses,
      orders,
      applications,
      accountDeletionRequests,
      businessDeletionRequests,
      promotions,
      rewards,
      redemptions,
      promotionCodes,
      rewardCodes
    ] = await Promise.all([
      loadCollection("users"),
      loadCollection("businesses"),
      loadCollection("orders"),
      loadCollection("businessApplications"),
      loadCollection("accountDeletionRequests"),
      loadCollection("businessDeletionRequests"),
      loadCollection("promotions"),
      loadCollection("rewards"),
      loadCollection("redemptions"),
      loadCollection("promotionCodes"),
      loadCollection("rewardCodes")
    ]);
    state.data = {
      users,
      businesses,
      orders,
      applications,
      accountDeletionRequests,
      businessDeletionRequests,
      promotions,
      rewards,
      redemptions,
      promotionCodes,
      rewardCodes
    };
    statusMessage.textContent = `Actualizado ${new Date().toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })}`;
    render();
  } catch (error) {
    statusMessage.textContent = readableError(error);
  }
}

function startRealtime() {
  stopRealtime();
  statusMessage.textContent = "Escuchando cambios en vivo...";
  state.realtimeReady = { promotions: false, rewards: false };
  state.seenPendingRequests = { promotions: new Set(), rewards: new Set() };
  const collections = [
    ["users", "users"],
    ["businesses", "businesses"],
    ["orders", "orders"],
    ["businessApplications", "applications"],
    ["accountDeletionRequests", "accountDeletionRequests"],
    ["businessDeletionRequests", "businessDeletionRequests"],
    ["promotions", "promotions"],
    ["rewards", "rewards"],
    ["redemptions", "redemptions"],
    ["promotionCodes", "promotionCodes"],
    ["rewardCodes", "rewardCodes"]
  ];
  state.unsubscribers = collections.map(([name, key]) =>
    onSnapshot(
      query(collection(db, name), orderBy("createdAt", "desc"), limit(100)),
      (snapshot) => {
        const items = snapshot.docs.map(normalizeDoc);
        trackPendingRequestNotifications(key, items);
        state.data[key] = items;
        statusMessage.textContent = `En vivo · último cambio ${new Date().toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
        render();
      },
      (error) => {
        statusMessage.textContent = readableError(error);
      }
    )
  );
}

function stopRealtime() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}

function trackPendingRequestNotifications(key, items) {
  if (!["promotions", "rewards"].includes(key)) return;
  const pending = items.filter((item) => item.status === "pending");
  const seen = state.seenPendingRequests[key];
  if (!state.realtimeReady[key]) {
    pending.forEach((item) => seen.add(item.id));
    state.realtimeReady[key] = true;
    return;
  }
  const fresh = pending.filter((item) => !seen.has(item.id));
  pending.forEach((item) => seen.add(item.id));
  fresh.forEach((item) => notifyPendingRequest(key, item));
}

function notifyPendingRequest(key, item) {
  const isReward = key === "rewards";
  const type = isReward ? "recompensa" : "promoción";
  const title = `Nueva solicitud de ${type}`;
  const businessName = item.businessName ?? item.businessId ?? "Negocio";
  const message = `${businessName}: ${item.title ?? "Solicitud pendiente"}`;
  showToast({
    title,
    message,
    variant: isReward ? "reward" : "promotion",
    onAction: () => openRequestsSection()
  });
  showBrowserNotification(title, message);
}

function showToast({ title, message, variant, onAction }) {
  if (!toastStack) return;
  const toast = document.createElement("article");
  toast.className = `toast ${variant ?? ""}`.trim();

  const titleNode = document.createElement("p");
  titleNode.className = "toast-title";
  titleNode.textContent = title;

  const messageNode = document.createElement("p");
  messageNode.className = "toast-message";
  messageNode.textContent = message;

  const actions = document.createElement("div");
  actions.className = "toast-actions";

  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.textContent = "Ver solicitudes";
  viewButton.addEventListener("click", () => {
    onAction?.();
    toast.remove();
  });

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "secondary";
  closeButton.textContent = "Cerrar";
  closeButton.addEventListener("click", () => toast.remove());

  actions.append(viewButton, closeButton);
  toast.append(titleNode, messageNode, actions);
  toastStack.prepend(toast);

  while (toastStack.children.length > 4) {
    toastStack.lastElementChild?.remove();
  }
  window.setTimeout(() => toast.remove(), 12000);
}

function openRequestsSection() {
  state.tab = "requests";
  render();
  document.querySelector("#requests")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function requestBrowserNotifications() {
  if (!("Notification" in window)) return;
  const permission = await Notification.requestPermission();
  updateNotificationButton();
  if (permission === "granted") {
    showToast({
      title: "Avisos activados",
      message: "Te avisaré cuando lleguen promociones o recompensas nuevas.",
      onAction: () => openRequestsSection()
    });
  }
}

function updateNotificationButton() {
  if (!notificationButton || !("Notification" in window)) return;
  notificationButton.classList.toggle("hidden", Notification.permission === "granted");
  notificationButton.disabled = Notification.permission === "denied";
  notificationButton.textContent = Notification.permission === "denied" ? "Avisos bloqueados" : "Activar avisos";
}

function showBrowserNotification(title, message) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const notification = new Notification(title, {
    body: message,
    tag: "pedidos-locales-solicitudes"
  });
  notification.onclick = () => {
    window.focus();
    openRequestsSection();
    notification.close();
  };
}

function normalizeDoc(snapshot) {
  const data = snapshot.data();
  return {
    ...data,
    id: snapshot.id,
    createdAt: dateText(data.createdAt),
    updatedAt: dateText(data.updatedAt),
    activatedAt: dateText(data.activatedAt),
    expiresAt: dateText(data.expiresAt)
  };
}

function dateText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value.toDate) return value.toDate().toISOString();
  return "";
}

function shortDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-EC", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function render() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
    if (button.dataset.tab === "requests") {
      const count = pendingPromoRewardCount();
      button.textContent = count ? `Solicitudes (${count})` : "Solicitudes";
    }
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== state.tab);
  });
  pageTitle.textContent = {
    overview: "Resumen",
    orders: "Pedidos",
    businesses: "Negocios",
    clients: "Clientes",
    requests: "Solicitudes"
  }[state.tab];
  renderOverview();
  renderOrders();
  renderBusinesses();
  renderClients();
  renderRequests();
}

function pendingPromoRewardCount() {
  return state.data.promotions.filter((item) => item.status === "pending").length
    + state.data.rewards.filter((item) => item.status === "pending").length;
}

function renderOverview() {
  const { users, businesses, orders, applications, promotions, rewards } = state.data;
  const activeBusinesses = businesses.filter((item) => item.isActive && !item.isDeleted);
  const pendingOrders = orders.filter((item) => item.status === "sent");
  const pendingRequests = applications.filter((item) => item.status === "pending");
  document.querySelector("#overview").innerHTML = `
    <div class="cards">
      ${metric("Clientes", users.filter((item) => item.role === "client").length)}
      ${metric("Negocios activos", activeBusinesses.length)}
      ${metric("Pedidos nuevos", pendingOrders.length)}
      ${metric("Solicitudes negocio", pendingRequests.length)}
    </div>
    <div class="cards">
      ${metric("Pedidos entregados", orders.filter((item) => item.status === "completed").length)}
      ${metric("Promociones", promotions.length)}
      ${metric("Recompensas", rewards.length)}
      ${metric("Total pedidos", orders.length)}
    </div>
  `;
}

function metric(label, value) {
  return `<article class="metric"><strong>${value}</strong><span class="muted">${escapeHtml(label)}</span></article>`;
}

function renderOrders() {
  const orders = state.data.orders;
  const newOrders = orders.filter((item) => item.status === "sent").length;
  document.querySelector("#orders").innerHTML = `
    <div class="toolbar">
      <p class="muted">Pedidos en vivo. Nuevos pendientes: <strong>${newOrders}</strong>.</p>
    </div>
    <div class="list">
      ${orders.length ? orders.map(orderCard).join("") : empty("No hay pedidos registrados.")}
    </div>
  `;
  document.querySelectorAll("[data-coordinate-order]").forEach((button) => {
    button.addEventListener("click", () => coordinateOrder(button.dataset.coordinateOrder));
  });
  document.querySelectorAll("[data-whatsapp-order]").forEach((button) => {
    button.addEventListener("click", () => openOrderWhatsApp(button.dataset.whatsappOrder));
  });
  document.querySelectorAll("[data-cancel-order]").forEach((button) => {
    button.addEventListener("click", () => cancelOrder(button.dataset.cancelOrder));
  });
  document.querySelectorAll("[data-complete-order]").forEach((button) => {
    button.addEventListener("click", () => completeOrder(button.dataset.completeOrder));
  });
}

function orderCard(order) {
  const promotions = orderPromotions(order);
  const redemptions = state.data.redemptions.filter((item) => item.orderId === order.id && item.status === "pending");
  const canComplete = order.status === "received";
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">Pedido #${order.orderNumber ?? order.id.slice(0, 6)}</p>
          <p class="muted">${escapeHtml(order.businessName ?? "Negocio")} · ${escapeHtml(order.clientName ?? "Cliente")}</p>
        </div>
        ${statusPill(order.status)}
      </div>
      <p>${escapeHtml(order.message ?? "")}</p>
      <div class="meta">
        <span>${escapeHtml(order.clientPhone ?? "")}</span>
        <span>${escapeHtml(order.fulfillmentType === "pickup" ? "Retiro en tienda" : "Domicilio")}</span>
        <span>${escapeHtml(order.paymentMethod === "transfer" ? "Transferencia" : "Efectivo")}</span>
        <span>${shortDate(order.createdAt)}</span>
      </div>
      <div class="actions">
        <button data-coordinate-order="${order.id}" ${order.status !== "sent" ? "disabled" : ""}>Coordinar y enviar WhatsApp</button>
        <button class="secondary" data-whatsapp-order="${order.id}">Enviar por WhatsApp</button>
        <button class="danger" data-cancel-order="${order.id}" ${!["sent", "received"].includes(order.status) ? "disabled" : ""}>Cancelar</button>
      </div>
      ${promotions.length || redemptions.length || canComplete ? `
        <div class="delivery-box">
          ${promotions.length ? `
            <strong>Promociones del pedido</strong>
            ${promotions.map((item) => `
              <label class="check-row">
                <input type="checkbox" data-promotion-check="${order.id}:${item.id}" checked ${!canComplete ? "disabled" : ""} />
                <span>Entregada · ${escapeHtml(item.title)}</span>
              </label>
            `).join("")}
          ` : ""}
          ${redemptions.length ? `
            <strong>Recompensas/canjes</strong>
            ${redemptions.map((item) => `
              <label class="check-row">
                <input type="checkbox" data-reward-check="${order.id}:${item.id}" checked ${!canComplete ? "disabled" : ""} />
                <span>Entregada · ${escapeHtml(item.rewardTitle)} (${Number(item.pointsRequired ?? 0)} puntos)</span>
              </label>
            `).join("")}
          ` : ""}
          ${canComplete ? `
            <div class="complete-row">
              <input type="number" min="1" step="1" placeholder="Puntos a asignar" data-points-input="${order.id}" />
              <button data-complete-order="${order.id}">Marcar entregado</button>
            </div>
          ` : ""}
        </div>
      ` : ""}
    </article>
  `;
}

function orderPromotions(order) {
  if (!order) return [];
  const ids = order.promotionIds?.length
    ? order.promotionIds
    : order.promotionId
      ? [order.promotionId]
      : [];
  const titles = order.promotionTitles?.length
    ? order.promotionTitles
    : order.promotionTitle
      ? [order.promotionTitle]
      : [];
  return ids.map((id, index) => ({
    id,
    title: titles[index] ?? `Promoción ${index + 1}`
  }));
}

function renderBusinesses() {
  const ownerById = Object.fromEntries(state.data.users.map((item) => [item.id, item]));
  const businesses = state.data.businesses.filter((item) => !item.isDeleted);
  document.querySelector("#businesses").innerHTML = `
    <div class="list">
      ${businesses.length ? businesses.map((business) => businessCard(business, ownerById[business.ownerId])).join("") : empty("No hay negocios registrados.")}
    </div>
  `;
}

function businessCard(business, owner) {
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(business.name)}</p>
          <p class="muted">${escapeHtml(business.category ?? "")} · ${escapeHtml(business.address ?? "")}</p>
        </div>
        ${business.isActive ? statusPill("active") : statusPill("pending")}
      </div>
      <p>${escapeHtml(business.description ?? "")}</p>
      <div class="meta">
        <span>Dueño: ${escapeHtml(owner?.fullName ?? "No encontrado")}</span>
        <span>WhatsApp: ${escapeHtml(business.contactPhone ?? owner?.phone ?? "")}</span>
        <span>${escapeHtml(business.openingHours ?? "")}</span>
      </div>
    </article>
  `;
}

function renderClients() {
  const clients = state.data.users.filter((item) => item.role === "client");
  const businessByOwner = Object.fromEntries(state.data.businesses.map((item) => [item.ownerId, item]));
  document.querySelector("#clients").innerHTML = `
    <div class="list">
      ${clients.length ? clients.map((client) => clientCard(client, businessByOwner[client.id])).join("") : empty("No hay clientes registrados.")}
    </div>
  `;
}

function clientCard(client, business) {
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(client.fullName)}</p>
          <p class="muted">${escapeHtml(client.email)} · ${escapeHtml(client.phone)}</p>
        </div>
        ${business && !business.isDeleted ? statusPill("business") : ""}
      </div>
      <div class="meta">
        <span>Puntos: ${Number(client.points ?? 0)}</span>
        <span>Pedidos completados: ${Number(client.completedOrderCount ?? 0)}</span>
        <span>Registro: ${shortDate(client.createdAt)}</span>
      </div>
      ${business && !business.isDeleted ? `<p>Negocio: <strong>${escapeHtml(business.name)}</strong></p>` : ""}
    </article>
  `;
}

function renderRequests() {
  const applications = state.data.applications;
  const accountRequests = state.data.accountDeletionRequests;
  const businessRequests = state.data.businessDeletionRequests;
  const promotions = state.data.promotions.filter((item) => ["pending", "active"].includes(item.status));
  const rewards = state.data.rewards.filter((item) => ["pending", "active"].includes(item.status));
  document.querySelector("#requests").innerHTML = `
    <h3>Solicitudes de negocio</h3>
    <div class="list">${applications.length ? applications.map(applicationCard).join("") : empty("No hay solicitudes de negocio.")}</div>
    <h3>Promociones</h3>
    <div class="list">${promotions.length ? promotions.map(promotionCard).join("") : empty("No hay promociones pendientes o activas.")}</div>
    <h3>Recompensas</h3>
    <div class="list">${rewards.length ? rewards.map(rewardCard).join("") : empty("No hay recompensas pendientes o activas.")}</div>
    <h3>Eliminación de cuentas</h3>
    <div class="list">${accountRequests.length ? accountRequests.map(accountDeletionCard).join("") : empty("No hay solicitudes de eliminación de cuenta.")}</div>
    <h3>Eliminación de negocios</h3>
    <div class="list">${businessRequests.length ? businessRequests.map(businessDeletionCard).join("") : empty("No hay solicitudes de eliminación de negocio.")}</div>
  `;
  document.querySelectorAll("[data-application-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.applicationAction === "code") issueApplicationCode(button.dataset.id);
      if (button.dataset.applicationAction === "reject") rejectApplication(button.dataset.id);
    });
  });
  document.querySelectorAll("[data-deletion-code]").forEach((button) => {
    button.addEventListener("click", () => generateDeletionCode(button.dataset.deletionCode, button.dataset.id));
  });
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => navigator.clipboard.writeText(button.dataset.copy));
  });
  document.querySelectorAll("[data-promotion-action]").forEach((button) => {
    button.addEventListener("click", () => runPromotionAction(button.dataset.promotionAction, button.dataset.id));
  });
  document.querySelectorAll("[data-reward-action]").forEach((button) => {
    button.addEventListener("click", () => runRewardAction(button.dataset.rewardAction, button.dataset.id));
  });
}

function applicationCard(application) {
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(application.businessName)}</p>
          <p class="muted">${escapeHtml(application.ownerName ?? "")} · ${escapeHtml(application.phone ?? "")}</p>
        </div>
        ${statusPill(application.status)}
      </div>
      <p>${escapeHtml(application.comment ?? "")}</p>
      ${application.activationCode ? `<p><strong>Código:</strong> ${escapeHtml(application.activationCode)}</p>` : ""}
      <div class="actions">
        <button data-id="${application.id}" data-application-action="code" ${application.status !== "pending" ? "disabled" : ""}>Generar código</button>
        <button class="danger" data-id="${application.id}" data-application-action="reject" ${application.status !== "pending" ? "disabled" : ""}>Rechazar</button>
        ${application.activationCode ? `<button class="secondary" data-copy="${escapeHtml(application.activationCode)}">Copiar código</button>` : ""}
      </div>
    </article>
  `;
}

function accountDeletionCard(request) {
  return deletionCard(request, "account");
}

function businessDeletionCard(request) {
  return deletionCard(request, "business");
}

function deletionCard(request, type) {
  const title = type === "business" ? request.businessName : request.fullName;
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(title ?? request.id)}</p>
          <p class="muted">${escapeHtml(request.phone ?? request.email ?? "")}</p>
        </div>
        ${statusPill(request.status)}
      </div>
      ${request.deletionCode ? `<p><strong>Código:</strong> ${escapeHtml(request.deletionCode)}</p>` : ""}
      <div class="actions">
        <button data-id="${request.id}" data-deletion-code="${type}" ${request.status !== "pending" ? "disabled" : ""}>Generar código</button>
        ${request.deletionCode ? `<button class="secondary" data-copy="${escapeHtml(request.deletionCode)}">Copiar código</button>` : ""}
      </div>
    </article>
  `;
}

function promotionCard(promotion) {
  const code = state.data.promotionCodes.find((item) => item.targetId === promotion.id && !item.used);
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(promotion.title)}</p>
          <p class="muted">${escapeHtml(promotion.businessName ?? promotion.businessId)} · ${Number(promotion.durationDays ?? 0)} días</p>
        </div>
        ${statusPill(promotion.status)}
      </div>
      <p>${escapeHtml(promotion.description ?? "")}</p>
      <div class="meta">
        <span>Stock: ${stockText(promotion)}</span>
        <span>Creada: ${shortDate(promotion.createdAt)}</span>
      </div>
      ${code ? `<p><strong>Código generado:</strong> ${escapeHtml(code.id)}</p>` : ""}
      <div class="actions">
        <button data-id="${promotion.id}" data-promotion-action="code" ${promotion.status !== "pending" || code ? "disabled" : ""}>Generar código</button>
        <button class="danger" data-id="${promotion.id}" data-promotion-action="reject" ${promotion.status !== "pending" ? "disabled" : ""}>Rechazar</button>
        <button class="danger" data-id="${promotion.id}" data-promotion-action="cancel" ${promotion.status !== "active" ? "disabled" : ""}>Cancelar</button>
        ${code ? `<button class="secondary" data-copy="${escapeHtml(code.id)}">Copiar código</button>` : ""}
      </div>
    </article>
  `;
}

function rewardCard(reward) {
  const code = state.data.rewardCodes.find((item) => item.targetId === reward.id && !item.used);
  const redemptions = state.data.redemptions.filter((item) => item.rewardId === reward.id);
  return `
    <article class="item">
      <div class="item-head">
        <div>
          <p class="item-title">${escapeHtml(reward.title)}</p>
          <p class="muted">${Number(reward.pointsRequired ?? 0)} puntos · ${Number(reward.durationDays ?? 0)} días</p>
        </div>
        ${statusPill(reward.status)}
      </div>
      <p>${escapeHtml(reward.description ?? "")}</p>
      <div class="meta">
        <span>Stock: ${stockText(reward)}</span>
        <span>Canjes: ${redemptions.length}</span>
        <span>Creada: ${shortDate(reward.createdAt)}</span>
      </div>
      ${code ? `<p><strong>Código generado:</strong> ${escapeHtml(code.id)}</p>` : ""}
      <div class="actions">
        <button data-id="${reward.id}" data-reward-action="code" ${reward.status !== "pending" || code ? "disabled" : ""}>Generar código</button>
        <button class="danger" data-id="${reward.id}" data-reward-action="reject" ${reward.status !== "pending" ? "disabled" : ""}>Rechazar</button>
        <button class="danger" data-id="${reward.id}" data-reward-action="cancel" ${reward.status !== "active" ? "disabled" : ""}>Cancelar</button>
        ${code ? `<button class="secondary" data-copy="${escapeHtml(code.id)}">Copiar código</button>` : ""}
      </div>
    </article>
  `;
}

function stockText(item) {
  if (item.quantityAvailable === undefined || item.quantityAvailable === null) return "Sin límite";
  return `${Number(item.quantityClaimed ?? 0)} / ${Number(item.quantityAvailable)}`;
}

async function issueApplicationCode(applicationId) {
  const application = state.data.applications.find((item) => item.id === applicationId);
  if (!application || application.status !== "pending") return;
  const code = await createActivationCode(application.businessName, application.phone);
  await updateDoc(doc(db, "businessApplications", application.id), {
    status: "code_generated",
    activationCode: code,
    updatedAt: serverTimestamp()
  });
  await navigator.clipboard.writeText(code).catch(() => undefined);
  await loadAll();
  alert(`Código generado y copiado: ${code}`);
}

async function rejectApplication(applicationId) {
  if (!confirm("¿Rechazar esta solicitud de negocio?")) return;
  await updateDoc(doc(db, "businessApplications", applicationId), {
    status: "rejected",
    updatedAt: serverTimestamp()
  });
  await updateDoc(doc(db, "businesses", applicationId), {
    isActive: false,
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }).catch(() => undefined);
  await loadAll();
}

async function createActivationCode(label, contactPhone) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    const ref = doc(db, "activationCodes", code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, {
      label: label?.trim() || "Negocio",
      ...(contactPhone?.trim() ? { contactPhone: contactPhone.trim() } : {}),
      used: false,
      createdAt: serverTimestamp()
    });
    return code;
  }
  throw new Error("No se pudo generar un código único.");
}

async function generateDeletionCode(type, requestId) {
  const isBusiness = type === "business";
  const code = `${isBusiness ? "NEGOCIO" : "BORRAR"}-${randomCode()}`;
  await updateDoc(doc(db, isBusiness ? "businessDeletionRequests" : "accountDeletionRequests", requestId), {
    status: "code_generated",
    deletionCode: code,
    updatedAt: serverTimestamp()
  });
  await navigator.clipboard.writeText(code).catch(() => undefined);
  await loadAll();
  alert(`Código generado y copiado: ${code}`);
}

async function runPromotionAction(action, id) {
  const promotion = state.data.promotions.find((item) => item.id === id);
  if (!promotion) return;
  try {
    if (action === "code") {
      const code = await createEventCode("promotion", promotion);
      await navigator.clipboard.writeText(code).catch(() => undefined);
      alert(`Código generado y copiado: ${code}`);
    }
    if (action === "reject") {
      if (!confirm("¿Rechazar esta promoción?")) return;
      await updateDoc(doc(db, "promotions", id), {
        status: "rejected",
        resolvedBy: state.user.uid
      });
    }
    if (action === "cancel") {
      if (!confirm("¿Cancelar esta promoción activa?")) return;
      await updateDoc(doc(db, "promotions", id), {
        status: "cancelled",
        resolvedBy: state.user.uid
      });
    }
    await loadAll();
  } catch (error) {
    alert(readableError(error));
  }
}

async function runRewardAction(action, id) {
  const reward = state.data.rewards.find((item) => item.id === id);
  if (!reward) return;
  try {
    if (action === "code") {
      const code = await createEventCode("reward", reward);
      await navigator.clipboard.writeText(code).catch(() => undefined);
      alert(`Código generado y copiado: ${code}`);
    }
    if (action === "reject") {
      if (!confirm("¿Rechazar esta recompensa?")) return;
      await updateDoc(doc(db, "rewards", id), {
        status: "rejected",
        isActive: false,
        resolvedBy: state.user.uid
      });
    }
    if (action === "cancel") {
      if (!confirm("¿Cancelar esta recompensa activa?")) return;
      await updateDoc(doc(db, "rewards", id), {
        status: "cancelled",
        isActive: false,
        resolvedBy: state.user.uid
      });
    }
    await loadAll();
  } catch (error) {
    alert(readableError(error));
  }
}

async function createEventCode(kind, item) {
  const isPromotion = kind === "promotion";
  const prefix = isPromotion ? "PROMO" : "PREMIO";
  const codeCollection = isPromotion ? "promotionCodes" : "rewardCodes";
  const notificationType = isPromotion ? "promotion_code" : "reward_code";
  const notificationTitle = isPromotion ? "Código de promoción" : "Código de recompensa";
  const business = state.data.businesses.find((candidate) => candidate.id === item.businessId);
  const recipientId = business?.ownerId ?? item.businessId;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = `${prefix}-${randomCode()}`;
    const codeRef = doc(db, codeCollection, code);
    if ((await getDoc(codeRef)).exists()) continue;
    const batch = writeBatch(db);
    batch.set(codeRef, {
      label: item.title,
      targetId: item.id,
      businessId: item.businessId,
      used: false,
      createdAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "notifications")), {
      recipientId,
      type: notificationType,
      title: notificationTitle,
      message: `Tu código para "${item.title}" ya está listo. Entra en la app para copiarlo y activar.`,
      activationCode: code,
      relatedId: item.id,
      read: false,
      createdAt: serverTimestamp()
    });
    await batch.commit();
    return code;
  }
  throw new Error("No se pudo generar un código único.");
}

async function coordinateOrder(orderId) {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order || order.status !== "sent") return;
  try {
    await updateDoc(doc(db, "orders", orderId), {
      status: "received",
      statusUpdatedAt: serverTimestamp(),
      statusUpdatedBy: state.user.uid
    });
    await setDoc(doc(collection(db, "notifications")), {
      recipientId: order.clientId,
      type: "order_status",
      title: "Estado del pedido",
      message: "Tu pedido se actualizó a: En coordinación.",
      relatedId: orderId,
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => undefined);
    openOrderWhatsApp(orderId, "received");
  } catch (error) {
    alert(readableError(error));
  }
}

async function cancelOrder(orderId) {
  if (!confirm("¿Cancelar este pedido? Las promociones y canjes pendientes se marcarán como no entregados.")) return;
  try {
    await updateOrderStatusOnly(orderId, "cancelled");
    const order = state.data.orders.find((item) => item.id === orderId);
    const decisions = Object.fromEntries(orderPromotions(order).map((item) => [item.id, false]));
    if (Object.keys(decisions).length) await resolvePromotionDeliveries(orderId, decisions);
    const pending = state.data.redemptions.filter((item) => item.orderId === orderId && item.status === "pending");
    for (const redemption of pending) {
      await resolveRedemptionWeb(redemption.id, "rejected");
    }
    await loadAll();
  } catch (error) {
    alert(readableError(error));
  }
}

async function completeOrder(orderId) {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order) return;
  const rawPoints = document.querySelector(`[data-points-input="${cssEscape(orderId)}"]`)?.value?.trim() ?? "";
  const points = Number(rawPoints);
  if (!order.pointsAwarded && (!rawPoints || !Number.isInteger(points) || points <= 0)) {
    alert("Ingresa la cantidad de puntos a asignar antes de marcar como entregado.");
    return;
  }
  try {
    if (order.status !== "completed") {
      await updateOrderStatusOnly(orderId, "completed");
      await openOrderWhatsApp(orderId, "completed");
    }
    if (!order.pointsAwarded) {
      await awardPointsWeb(orderId, points);
    }
    const promotionDecisions = {};
    for (const promotion of orderPromotions(order)) {
      const checked = document.querySelector(`[data-promotion-check="${cssEscape(`${orderId}:${promotion.id}`)}"]`)?.checked ?? true;
      promotionDecisions[promotion.id] = checked;
    }
    if (Object.keys(promotionDecisions).length) {
      await resolvePromotionDeliveries(orderId, promotionDecisions);
    }
    const pending = state.data.redemptions.filter((item) => item.orderId === orderId && item.status === "pending");
    for (const redemption of pending) {
      const checked = document.querySelector(`[data-reward-check="${cssEscape(`${orderId}:${redemption.id}`)}"]`)?.checked ?? true;
      await resolveRedemptionWeb(redemption.id, checked ? "approved" : "rejected");
    }
    await loadAll();
  } catch (error) {
    alert(readableError(error));
  }
}

async function updateOrderStatusOnly(orderId, status) {
  await updateDoc(doc(db, "orders", orderId), {
    status,
    statusUpdatedAt: serverTimestamp(),
    statusUpdatedBy: state.user.uid
  });
  const order = state.data.orders.find((item) => item.id === orderId);
  if (order?.clientId) {
    await setDoc(doc(collection(db, "notifications")), {
      recipientId: order.clientId,
      type: "order_status",
      title: "Estado del pedido",
      message: `Tu pedido se actualizó a: ${labels[status] ?? status}.`,
      relatedId: orderId,
      read: false,
      createdAt: serverTimestamp()
    }).catch(() => undefined);
  }
}

async function awardPointsWeb(orderId, points) {
  await runTransaction(db, async (transaction) => {
    const orderRef = doc(db, "orders", orderId);
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists()) throw new Error("El pedido ya no existe.");
    const order = orderSnapshot.data();
    if (order.status !== "completed") throw new Error("Primero completa el pedido.");
    if (order.pointsAwarded) throw new Error("Este pedido ya tiene puntos asignados.");
    const userRef = doc(db, "users", order.clientId);
    const userSnapshot = await transaction.get(userRef);
    if (!userSnapshot.exists()) throw new Error("No existe el cliente.");
    const currentPoints = Number(userSnapshot.data().points ?? 0);
    const completedOrderCount = Number(userSnapshot.data().completedOrderCount ?? 0);
    transaction.update(userRef, {
      points: currentPoints + points,
      completedOrderCount: completedOrderCount + 1,
      updatedAt: new Date().toISOString()
    });
    transaction.update(orderRef, {
      pointsAwarded: true,
      pointsAwardedAmount: points,
      pointsAwardedAt: serverTimestamp()
    });
    transaction.set(doc(db, "pointsTransactions", `order_${orderId}`), {
      clientId: order.clientId,
      businessId: order.businessId,
      orderId,
      type: "earned",
      points,
      description: `Puntos por pedido en ${order.businessName ?? "negocio local"}`,
      createdAt: serverTimestamp()
    });
  });
}

async function resolvePromotionDeliveries(orderId, decisions) {
  await runTransaction(db, async (transaction) => {
    const orderRef = doc(db, "orders", orderId);
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists()) throw new Error("No existe el pedido.");
    const order = { ...orderSnapshot.data(), id: orderSnapshot.id };
    const ids = orderPromotions(order).map((item) => item.id).filter((id) => decisions[id] !== undefined);
    const alreadyResolved = new Set(order.promotionStockResolvedIds ?? []);
    const unresolvedIds = ids.filter((id) => !alreadyResolved.has(id));
    if (!unresolvedIds.length) return;
    const promotionSnapshots = [];
    for (const id of unresolvedIds) {
      promotionSnapshots.push(await transaction.get(doc(db, "promotions", id)));
    }
    const promotionDeliveries = { ...(order.promotionDeliveries ?? {}) };
    unresolvedIds.forEach((id) => {
      promotionDeliveries[id] = decisions[id];
    });
    transaction.update(orderRef, {
      promotionDeliveries,
      promotionStockResolvedIds: [...alreadyResolved, ...unresolvedIds],
      ...(order.promotionId && decisions[order.promotionId] !== undefined
        ? { promotionDelivered: decisions[order.promotionId], promotionStockResolved: true }
        : {})
    });
    promotionSnapshots.forEach((promotionSnapshot, index) => {
      const id = unresolvedIds[index];
      if (decisions[id] || !promotionSnapshot.exists()) return;
      const promotion = promotionSnapshot.data();
      if (promotion.quantityAvailable !== undefined) {
        const currentClaimed = Number(promotion.quantityClaimed ?? 0);
        if (currentClaimed <= 0) return;
        const nextClaimed = currentClaimed - 1;
        const expiresAt = promotion.expiresAt ? new Date(dateText(promotion.expiresAt)).getTime() : undefined;
        const canReactivate = promotion.status === "expired" && nextClaimed < promotion.quantityAvailable && (!expiresAt || expiresAt > Date.now());
        transaction.update(doc(db, "promotions", id), {
          quantityClaimed: nextClaimed,
          ...(canReactivate ? { status: "active" } : {})
        });
      }
    });
  });
}

async function resolveRedemptionWeb(redemptionId, status) {
  await runTransaction(db, async (transaction) => {
    const redemptionRef = doc(db, "redemptions", redemptionId);
    const redemptionSnapshot = await transaction.get(redemptionRef);
    if (!redemptionSnapshot.exists()) throw new Error("El canje ya no existe.");
    const redemption = redemptionSnapshot.data();
    if (redemption.status !== "pending") return;
    const orderSnapshot = await transaction.get(doc(db, "orders", redemption.orderId));
    const userRef = doc(db, "users", redemption.clientId);
    const userSnapshot = await transaction.get(userRef);
    const rewardRef = doc(db, "rewards", redemption.rewardId);
    const needsReward = (status === "approved" && !redemption.stockReserved) || (status === "rejected" && redemption.stockReserved);
    const rewardSnapshot = needsReward ? await transaction.get(rewardRef) : undefined;
    if (!orderSnapshot.exists()) throw new Error("No existe el pedido vinculado.");
    if (!userSnapshot.exists()) throw new Error("No existe el cliente.");
    if (status === "approved" && orderSnapshot.data().status !== "completed") throw new Error("Primero marca el pedido como entregado.");
    const currentPoints = Number(userSnapshot.data().points ?? 0);
    if (status === "approved" && currentPoints < redemption.pointsRequired) throw new Error("El cliente ya no tiene suficientes puntos.");
    transaction.update(redemptionRef, {
      status,
      resolvedAt: serverTimestamp(),
      resolvedBy: state.user.uid
    });
    transaction.set(doc(collection(db, "notifications")), {
      recipientId: redemption.clientId,
      type: "redemption_resolved",
      title: "Canje actualizado",
      message: status === "approved"
        ? `Tu canje de ${redemption.rewardTitle} fue aprobado.`
        : `Tu canje de ${redemption.rewardTitle} fue rechazado.`,
      relatedId: redemptionId,
      read: false,
      createdAt: serverTimestamp()
    });
    if (status === "rejected" && redemption.stockReserved && rewardSnapshot?.exists()) {
      const reward = rewardSnapshot.data();
      if (reward.quantityAvailable !== undefined) {
        const nextClaimed = Math.max(Number(reward.quantityClaimed ?? 0) - 1, 0);
        const expiresAt = reward.expiresAt ? new Date(dateText(reward.expiresAt)).getTime() : undefined;
        const canReactivate = reward.status === "expired" && nextClaimed < reward.quantityAvailable && (!expiresAt || expiresAt > Date.now());
        transaction.update(rewardRef, {
          quantityClaimed: nextClaimed,
          ...(canReactivate ? { status: "active", isActive: true } : {})
        });
        transaction.update(redemptionRef, { stockReserved: false });
      }
    }
    if (status === "approved") {
      if (!redemption.stockReserved && rewardSnapshot?.exists()) {
        const reward = rewardSnapshot.data();
        if (reward.quantityAvailable !== undefined) {
          const nextClaimed = Math.min(Number(reward.quantityClaimed ?? 0) + 1, reward.quantityAvailable);
          transaction.update(rewardRef, {
            quantityClaimed: nextClaimed,
            ...(nextClaimed >= reward.quantityAvailable ? { status: "expired", isActive: false } : {})
          });
          transaction.update(redemptionRef, { stockReserved: true });
        }
      }
      transaction.update(userRef, {
        points: currentPoints - redemption.pointsRequired,
        updatedAt: new Date().toISOString()
      });
      transaction.set(doc(db, "pointsTransactions", `redemption_${redemptionId}`), {
        clientId: redemption.clientId,
        businessId: redemption.businessId,
        type: "redeemed",
        points: -redemption.pointsRequired,
        description: `Canje: ${redemption.rewardTitle}`,
        redemptionId,
        orderId: redemption.orderId,
        createdAt: serverTimestamp()
      });
    }
  });
}

function openOrderWhatsApp(orderId, nextStatus = undefined) {
  const order = state.data.orders.find((item) => item.id === orderId);
  if (!order) return;
  const business = state.data.businesses.find((item) => item.id === order.businessId);
  const phone = normalizeWhatsAppPhone(business?.contactPhone);
  if (!phone) {
    alert("Este negocio no tiene WhatsApp registrado.");
    return;
  }
  const message = buildBusinessOrderMessage(order, business, nextStatus);
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
}

function buildBusinessOrderMessage(order, business, nextStatus) {
  const isPickup = order.fulfillmentType === "pickup";
  const lines = [
    nextStatus === "received"
      ? "Hola :) te comparto este pedido para coordinarlo."
      : "Hola :) te comparto esta solicitud de pedido.",
    "",
    `Pedido #${order.orderNumber ?? order.id.slice(0, 6)}`,
    `Negocio: ${business?.name ?? order.businessName ?? "Negocio"}`,
    `Cliente: ${order.clientName ?? ""}`,
    `Teléfono: ${order.clientPhone ?? ""}`,
    `Entrega: ${isPickup ? "Retiro en tienda" : "Servicio a domicilio"}`,
    `Pago: ${order.paymentMethod === "transfer" ? "Transferencia" : "Efectivo"}`,
    ...(!isPickup
      ? [
          `Dirección: ${order.address ?? ""}`,
          `Referencia: ${order.reference ?? ""}`,
          order.location ? `Mapa: https://www.google.com/maps?q=${order.location.latitude},${order.location.longitude}` : ""
        ]
      : []),
    "",
    "Pedido:",
    order.message ?? "",
    "",
    `Estado: ${labels[nextStatus ?? order.status] ?? order.status}`
  ];
  if (order.promotionTitles?.length) {
    lines.push("", "Promociones:", ...order.promotionTitles.map((title) => `- ${title}`));
  } else if (order.promotionTitle) {
    lines.push("", `Promoción: ${order.promotionTitle}`);
  }
  if (order.rewardTitles?.length) {
    lines.push("", "Recompensas:", ...order.rewardTitles.map((title) => `- ${title}`));
  } else if (order.rewardTitle) {
    lines.push("", `Recompensa: ${order.rewardTitle}`);
  }
  return lines.filter(Boolean).join("\n");
}

function normalizeWhatsAppPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("593")) return digits;
  if (digits.startsWith("0")) return `593${digits.slice(1)}`;
  return digits;
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function statusPill(status) {
  const text = labels[status] ?? (status === "business" ? "Tiene negocio" : status);
  const tone = ["cancelled", "rejected"].includes(status)
    ? "danger"
    : ["pending", "sent", "code_generated"].includes(status)
      ? "warn"
      : ["received", "business"].includes(status)
        ? "info"
        : "";
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cssEscape(value) {
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function readableError(error) {
  const message = error?.message ?? String(error);
  if (message.includes("permission")) return "No tienes permisos para cargar estos datos. Revisa que tu usuario tenga rol admin.";
  if (message.includes("index")) return "Firestore necesita un índice para esta consulta. Revisa el enlace que aparece en consola.";
  return "No se pudo cargar la información. Revisa tu conexión e intenta nuevamente.";
}
