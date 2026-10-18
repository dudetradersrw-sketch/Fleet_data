const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyxlBROYZ8OPTqdVbOCDvJYS4t4lkZE5e3ZlKeHImfZLGQbC-c1zGBtPZiE0MPHV8BX8Q/exec";
let globalData = {};

// --- 🎨 SYSTEM THEME & COLOR SETTINGS SYSTEM ---
const THEME_PRESETS = {
  slate: {
    name: "Dark Slate",
    bg: "bg-slate-900", text: "text-slate-300", headingText: "text-white", subText: "text-slate-400",
    hoverBg: "hover:bg-slate-800", hoverText: "hover:text-white", activeBg: "bg-slate-800", activeText: "text-white",
    border: "border-slate-800", toggleBtnBg: "bg-slate-800", toggleBtnText: "text-slate-400"
  },
  emerald: {
    name: "Forest Emerald",
    bg: "bg-emerald-950", text: "text-emerald-200", headingText: "text-white", subText: "text-emerald-400",
    hoverBg: "hover:bg-emerald-900", hoverText: "hover:text-white", activeBg: "bg-emerald-900", activeText: "text-white",
    border: "border-emerald-900", toggleBtnBg: "bg-emerald-900", toggleBtnText: "text-emerald-300"
  },
  indigo: {
    name: "Royal Indigo",
    bg: "bg-indigo-950", text: "text-indigo-200", headingText: "text-white", subText: "text-indigo-400",
    hoverBg: "hover:bg-indigo-900", hoverText: "hover:text-white", activeBg: "bg-indigo-900", activeText: "text-white",
    border: "border-indigo-900", toggleBtnBg: "bg-indigo-900", toggleBtnText: "text-indigo-300"
  },
  zinc: {
    name: "Modern Zinc",
    bg: "bg-zinc-900", text: "text-zinc-300", headingText: "text-white", subText: "text-zinc-400",
    hoverBg: "hover:bg-zinc-800", hoverText: "hover:text-white", activeBg: "bg-zinc-800", activeText: "text-white",
    border: "border-zinc-800", toggleBtnBg: "bg-zinc-800", toggleBtnText: "text-zinc-400"
  }
};

function getCurrentThemeKey() {
  const saved = localStorage.getItem("fleetDesk_themeKey") || "slate";
  return THEME_PRESETS[saved] ? saved : "slate";
}

function saveSystemTheme(themeKey) {
  if (!THEME_PRESETS[themeKey]) return;
  localStorage.setItem("fleetDesk_themeKey", themeKey);
  showNotification("System color scheme updated!");
  setTimeout(() => window.location.reload(), 500);
}

// Robust JSONP fetch function that bypasses browser CORS locks completely
// --- JSONP DATABASE FETCH (Bypasses Netlify CORS restrictions) ---
let globalData = {};

function fetchDatabase(forceRefresh = false) {
  // If we already have cached data and aren't forcing a refresh, use it
  if (!forceRefresh && window.cachedFleetData) {
    globalData = window.cachedFleetData;
    if (typeof window.onDataLoaded === 'function') window.onDataLoaded(globalData);
    return;
  }

  // Unique callback name to avoid collisions
  const callbackName = 'jsonp_callback_' + Math.round(100000 * Math.random());
  
  window[callbackName] = function(data) {
    // Cleanup script tag
    delete window[callbackName];
    const scriptTag = document.getElementById('jsonpScript');
    if (scriptTag) scriptTag.remove();

    if (data) {
      globalData = data;
      window.cachedFleetData = data;
      if (typeof window.onDataLoaded === 'function') {
        window.onDataLoaded(data);
      }
    } else {
      showErrorNotification("Failed to parse database response.");
    }
  };

  // Inject script tag to bypass CORS
  const oldScript = document.getElementById('jsonpScript');
  if (oldScript) oldScript.remove();

  const script = document.createElement('script');
  script.id = 'jsonpScript';
  script.src = `${SCRIPT_URL}?callback=${callbackName}`;
  
  script.onerror = function() {
    delete window[callbackName];
    console.error("JSONP fetch failed, falling back to local cache...");
    // Fallback if offline or blocked
    if (typeof window.onDataLoaded === 'function') {
      window.onDataLoaded(globalData || {});
    }
  };

  document.body.appendChild(script);
}

async function triggerSyncWithLoading() {
  const syncBtn = document.getElementById("sync_btn");
  const syncIcon = document.getElementById("sync_icon");
  const syncText = document.getElementById("sync_text");

  if (syncBtn) syncBtn.disabled = true;
  if (syncIcon) syncIcon.classList.add("animate-spin");
  if (syncText) syncText.innerText = "Syncing...";

  try {
    await fetchDatabase(true);
    showNotification("Data synced successfully!");
  } catch (err) {
    console.error("Sync failed:", err);
    showNotification("Sync failed. Please check internet connection.", "error");
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    if (syncIcon) syncIcon.classList.remove("animate-spin");
    if (syncText) syncText.innerText = "Sync";
  }
}

async function sendToServer(sheetName, action, data) {
  try {
    if (!globalData[sheetName]) globalData[sheetName] = [];
    
    if (action === "add") {
      data.ID = data.ID || "FD-" + Date.now().toString().slice(-4);
      globalData[sheetName].unshift(data);
    } else if (action === "update") {
      const index = globalData[sheetName].findIndex(row => String(row.ID) === String(data.ID));
      if (index !== -1) {
        globalData[sheetName][index] = { ...globalData[sheetName][index], ...data };
      }
    } else if (action === "delete") {
      globalData[sheetName] = globalData[sheetName].filter(row => String(row.ID) !== String(data.id));
    } else if (action === "archive") {
      const item = globalData[sheetName].find(row => String(row.ID) === String(data.id));
      if (item) item.Status = "Archived";
    }

    sessionStorage.setItem("fleetDesk_db", JSON.stringify(globalData));

    if (typeof window.onDataLoaded === "function") {
      window.onDataLoaded(globalData);
    }
    
    closeFormModal();
    showNotification("Saving to Google Drive and Sheets...");

    // Send payload to Apps Script using mode: "no-cors" to bypass local browser file security locks
    await fetch(SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ sheet: sheetName, action: action, data: data })
    });

    // Refresh database after 1.5s to pull transformed Google Drive preview links
    setTimeout(() => fetchDatabase(true), 1500);

  } catch (err) {
    console.error("Server error:", err);
    showNotification("Saved locally (offline mode).", "error");
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById("fleetSidebar");
  const toggleIcon = document.getElementById("sidebarToggleIcon");
  if (!sidebar) return;

  const isCollapsed = sidebar.classList.toggle("w-16");
  sidebar.classList.toggle("w-64");

  document.querySelectorAll(".sidebar-label").forEach(el => {
    el.classList.toggle("hidden", isCollapsed);
  });

  const brandText = document.getElementById("brandText");
  if (brandText) brandText.classList.toggle("hidden", isCollapsed);

  const userDetails = document.getElementById("sidebarUserDetails");
  if (userDetails) userDetails.classList.toggle("hidden", isCollapsed);

  if (toggleIcon) toggleIcon.innerText = isCollapsed ? "▶" : "◀";

  localStorage.setItem("fleetDesk_sidebarCollapsed", isCollapsed ? "true" : "false");
}

function renderSidebar(activePage) {
  const currentUser = JSON.parse(sessionStorage.getItem("fleetDesk_currentUser") || "{}");
  const isAdmin = currentUser.Username === "admin" || currentUser.IsMasterAdmin;
  const isCollapsed = localStorage.getItem("fleetDesk_sidebarCollapsed") === "true";

  const allPages = [
    { name: "Dashboard", file: "index.html", icon: "📊" },
    { name: "Clearing", file: "clearing.html", icon: "⚓" },
    { name: "Trucks", file: "trucks.html", icon: "🚛" },
    { name: "Trailers", file: "trailers.html", icon: "🚃" },
    { name: "Combinations", file: "combinations.html", icon: "🔗" },
    { name: "Drivers", file: "drivers.html", icon: "👤" },
    { name: "Garage", file: "garage.html", icon: "🔧" },
    { name: "Trips", file: "trips.html", icon: "🚀" },
    { name: "Monitoring & Alerts", file: "monitoring.html", icon: "⚠️" },
    { name: "Containers", file: "containers.html", icon: "📦" },
    { name: "Cashbook", file: "cashbook.html", icon: "💵" },
    { name: "Invoices", file: "invoices.html", icon: "📄" },
    { name: "Expenses", file: "expenses.html", icon: "📉" },
    { name: "Contacts", file: "contacts.html", icon: "📇" },
    { name: "Settings", file: "settings.html", icon: "⚙️" }
  ];

  const pages = allPages.filter(p => isAdmin || hasPermission(p.name));

  if (isAdmin) {
    pages.push({ name: "Users", file: "users.html", icon: "🔐" });
  }

  const t = THEME_PRESETS[getCurrentThemeKey()];

  return `
    <aside id="fleetSidebar" class="${isCollapsed ? 'w-16' : 'w-64'} ${t.bg} ${t.text} flex flex-col justify-between hidden md:flex h-screen sticky top-0 transition-all duration-300 z-30">
      <div>
        <div class="p-4 text-xl font-bold ${t.headingText} flex items-center justify-between border-b ${t.border}">
          <div class="flex items-center gap-2 overflow-hidden">
            <span>🚚</span> <span id="brandText" class="${isCollapsed ? 'hidden' : ''} whitespace-nowrap">FleetDesk</span>
          </div>
          <button onclick="toggleSidebar()" title="Toggle Sidebar" class="${t.toggleBtnText} ${t.hoverText} ${t.toggleBtnBg} p-1.5 rounded-lg text-xs transition">
            <span id="sidebarToggleIcon">${isCollapsed ? '▶' : '◀'}</span>
          </button>
        </div>
        <nav class="mt-2 px-2 space-y-1 text-sm overflow-y-auto max-h-[calc(100vh-140px)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          ${pages.map(p => {
            const isActive = activePage === p.name;
            return `
              <a href="${p.file}" title="${p.name}" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${t.hoverBg} ${t.hoverText}${isActive ? `${t.activeBg} ${t.activeText} font-semibold` : ''}">
                <span class="text-base">${p.icon}</span>
                <span class="sidebar-label ${isCollapsed ? 'hidden' : ''} whitespace-nowrap">${p.name}</span>
              </a>
            `;
          }).join('')}
        </nav>
      </div>
      
      <div class="p-3 border-t ${t.border} flex items-center justify-between text-xs overflow-hidden">
        <div id="sidebarUserDetails" class="${isCollapsed ? 'hidden' : ''} whitespace-nowrap">
          <p class="font-bold ${t.headingText} truncate max-w-[110px]">${currentUser.Name || currentUser.Username || 'User'}</p>
          <p class="${t.subText} truncate max-w-[110px]">${currentUser.Category || 'User'}</p>
        </div>
        <button onclick="sessionStorage.clear(); window.location.href='login.html';" class="bg-red-600/20 text-red-400 hover:bg-red-600 hover:text-white p-2 rounded-lg transition font-semibold" title="Sign Out">
          🚪
        </button>
      </div>
    </aside>

    <div id="previewModal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center hidden">
      <div class="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl relative max-h-[90vh] overflow-y-auto">
        <button onclick="closeModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 font-bold text-xl">&times;</button>
        <h3 id="modalTitle" class="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Record Details</h3>
        <div id="modalBody" class="space-y-3 text-sm text-gray-700"></div>
        <div class="mt-6 flex justify-end gap-2">
          <button onclick="closeModal()" class="bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-300">Close</button>
        </div>
      </div>
    </div>

    <div id="formModal" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center hidden">
      <div class="bg-white rounded-xl max-w-2xl w-full p-6 shadow-xl relative max-h-[90vh] overflow-y-auto">
        <button onclick="closeFormModal()" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 font-bold text-xl">&times;</button>
        <h3 id="formModalTitle" class="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Add New Record</h3>
        <div id="formModalBody"></div>
      </div>
    </div>
  `;
}

function openFormModal(title, htmlContent) {
  document.getElementById("formModalTitle").innerText = title;
  document.getElementById("formModalBody").innerHTML = htmlContent;
  document.getElementById("formModal").classList.remove("hidden");
}

function closeFormModal() {
  document.getElementById("formModal").classList.add("hidden");
}

function renderColumnVisibilityMenu(tableId, headers) {
  return `
    <div class="relative inline-block text-left">
      <button onclick="toggleColDropdown('${tableId}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm border flex items-center gap-1 font-medium">
        👁️ Columns
      </button>
      <div id="menu_${tableId}" class="hidden absolute right-0 mt-2 w-52 bg-white border border-gray-200 rounded-lg shadow-xl p-3 z-30 text-xs space-y-2">
        <p class="font-semibold text-gray-500 border-b pb-1">Toggle Columns</p>
        ${headers.map((h, idx) => `
          <label class="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
            <input type="checkbox" checked onchange="toggleTableColumn('${tableId}',${idx}, this.checked)" class="rounded">
            <span class="text-gray-700">${h}</span>
          </label>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleColDropdown(tableId) {
  const menu = document.getElementById(`menu_${tableId}`);
  menu.classList.toggle('hidden');
}

function toggleTableColumn(tableId, colIndex, isVisible) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const rows = table.rows;
  for (let i = 0; i < rows.length; i++) {
    const cell = rows[i].cells[colIndex];
    if (cell) cell.style.display = isVisible ? '' : 'none';
  }
}

function renderActionCell(sheetName, id) {
  return `
    <div class="inline-block relative text-left">
      <button onclick="toggleActionDropdown('${id}')" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-xs font-semibold transition border">
        Actions ▼
      </button>
      <div id="actionMenu_${id}" class="hidden absolute right-0 mt-1 w-36 bg-white border border-gray-200 rounded-lg shadow-xl z-20 py-1 text-left text-xs flex flex-col space-y-0.5">
        <button onclick="editRecord('${sheetName}', '${id}')" class="w-full text-left px-3 py-1.5 hover:bg-amber-50 text-amber-800 font-medium">✏️ Edit</button>
        <button onclick="previewRecord('${sheetName}', '${id}')" class="w-full text-left px-3 py-1.5 hover:bg-blue-50 text-blue-800 font-medium">👁️ Preview</button>
        <button onclick="downloadReceipt('${sheetName}', '${id}')" class="w-full text-left px-3 py-1.5 hover:bg-indigo-50 text-indigo-800 font-medium">📄 Download</button>
        <button onclick="archiveRecord('${sheetName}', '${id}')" class="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-800 font-medium">📦 Archive</button>
        <button onclick="deleteRecord('${sheetName}', '${id}')" class="w-full text-left px-3 py-1.5 hover:bg-red-50 text-red-800 font-medium border-t">🗑️ Delete</button>
      </div>
    </div>
  `;
}

function toggleActionDropdown(id) {
  document.querySelectorAll("[id^='actionMenu_']").forEach(menu => {
    if (menu.id !== `actionMenu_${id}`) menu.classList.add('hidden');
  });
  const menu = document.getElementById(`actionMenu_${id}`);
  if (menu) menu.classList.toggle('hidden');
}

window.addEventListener('click', function(e) {
  if (!e.target.closest("button[onclick^='toggleActionDropdown']")) {
    document.querySelectorAll("[id^='actionMenu_']").forEach(menu => menu.classList.add('hidden'));
  }
});

function previewRecord(sheetName, id) {
  const item = (globalData[sheetName] || []).find(row => String(row.ID) === String(id));
  if (!item) return alert("Record not found.");

  document.getElementById("modalTitle").innerText = `${sheetName} - Preview [${id}]`;
  const body = document.getElementById("modalBody");
  body.innerHTML = Object.keys(item).map(key => `
    <div class="flex justify-between border-b pb-1">
      <span class="font-medium text-gray-500">${key}:</span>
      <span class="font-semibold text-gray-800">${item[key] || 'N/A'}</span>
    </div>
  `).join('');
  document.getElementById("previewModal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("previewModal").classList.add("hidden");
}

function editRecord(sheetName, id) {
  const item = (globalData[sheetName] || []).find(row => String(row.ID) === String(id));
  if (!item) return alert("Record not found.");
  if (typeof window.onEditTriggered === "function") {
    window.onEditTriggered(sheetName, item);
  } else {
    alert(`Edit triggered for ID [${id}].`);
  }
}

function downloadReceipt(sheetName, id) {
  const item = (globalData[sheetName] || []).find(i => String(i.ID) === String(id));
  if (!item) return alert("Record not found.");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`FLEETDESK - ${sheetName.toUpperCase()} RECEIPT`, 105, 20, { align: "center" });
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 105, 28, { align: "center" });
  doc.line(20, 35, 190, 35);

  let y = 48;
  Object.keys(item).forEach(key => {
    doc.setFont("helvetica", "bold");
    doc.text(`${key}:`, 20, y);
    doc.setFont("helvetica", "normal");
    doc.text(`${item[key] || ''}`, 70, y);
    y += 10;
  });

  doc.line(20, y + 5, 190, y + 5);
  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  doc.text("Thank you for using FleetDesk System!", 105, y + 15, { align: "center" });
  doc.save(`Receipt_${sheetName}_${id}.pdf`);
}

async function deleteRecord(sheetName, id) {
  if (!confirm(`⚠️ WARNING: Permanently delete record [${id}]?`)) return;
  await sendToServer(sheetName, "delete", { id: id });
}

async function archiveRecord(sheetName, id) {
  await sendToServer(sheetName, "archive", { id: id });
}

function filterTable(e, tableId) {
  const query = e.target.value.toLowerCase();
  const table = document.getElementById(tableId);
  if (!table) return;
  const trs = table.getElementsByTagName("tr");
  for (let i = 1; i < trs.length; i++) {
    const text = trs[i].innerText.toLowerCase();
    trs[i].style.display = text.includes(query) ? "" : "none";
  }
}

function exportCSVData(sheetName, list) {
  if (!list || list.length === 0) return alert("No data to export.");
  const headers = Object.keys(list[0]);
  let csv = headers.join(",") + "\n";
  list.forEach(row => {
    csv += headers.map(h => `"${row[h] || ''}"`).join(",") + "\n";
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${sheetName}_export.csv`;
  link.click();
}

function exportPDFTable(sheetName, list) {
  if (!list || list.length === 0) return alert("No data available.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`FleetDesk - ${sheetName} Report`, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 28);
  
  let y = 40;
  const headers = Object.keys(list[0]);
  doc.setFillColor(240, 240, 240);
  doc.rect(14, y-6, 180, 8, "F");
  doc.text(headers.join(" | "), 14, y);
  y += 10;
  
  doc.setFont("helvetica", "normal");
  list.forEach(item => {
    if (y > 280) { doc.addPage(); y = 20; }
    const rowText = headers.map(h => String(item[h] || '')).join(" | ");
    doc.text(rowText.substring(0, 95), 14, y);
    y += 8;
  });
  doc.save(`${sheetName}_Report.pdf`);
}

function showNotification(message, type = "success") {
  const existingToast = document.getElementById("fleetToast");
  if (existingToast) existingToast.remove();

  const toast = document.createElement("div");
  toast.id = "fleetToast";
  toast.className = `fixed top-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white transition-all transform duration-300 translate-y-[-20px] opacity-0 ${
    type === "success" ? "bg-emerald-600" : "bg-red-600"
  }`;
  toast.innerHTML = `✨ ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove("translate-y-[-20px]", "opacity-0");
    toast.classList.add("translate-y-0", "opacity-100");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-[-20px]", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

(function enforceAuth() {
  const currentUser = sessionStorage.getItem("fleetDesk_currentUser");
  const path = window.location.pathname;
  const isLoginPage = path.includes("login.html") || window.location.href.includes("login.html");

  if (!currentUser && !isLoginPage) {
    window.location.href = "login.html";
  }
})();

function checkAuth() {
  const currentUser = sessionStorage.getItem("fleetDesk_currentUser");
  return currentUser ? JSON.parse(currentUser) : null;
}

function renderUserHeaderBadge() {
  const user = checkAuth();
  if (!user) return "";
  return `
    <div class="hidden md:flex items-center gap-2 bg-gray-50 border px-3 py-1.5 rounded-full shadow-sm text-xs">
      <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span class="font-bold text-gray-800">${user.Name || user.Username}</span>
      <span class="text-gray-400">|</span>
      <span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-semibold">${user.Category || 'Administrator'}</span>
    </div>
  `;
}

function hasPermission(moduleName) {
  const user = checkAuth();
  if (!user) return false;
  if (user.Username === "admin" || user.IsMasterAdmin) return true;
  const permissions = user.Permissions || [];
  return permissions.includes(moduleName) || permissions.includes("All");
}
