
// ==================================================
// إعداد الاتصال المباشر بـ Supabase
// ==================================================
const SUPABASE_URL = "https://lpunsnvraeylwuugjmwl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_vcPbI8K3XNmrLn99ZIT16w_p5K36USH";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// صورة افتراضية داخلية بدون روابط خارجية
function formatImageUrl(url) {
  if (!url) return NO_IMG_PLACEHOLDER;
  if (typeof url === 'string' && url.includes('/storage/v1/object/product-images/') && !url.includes('/storage/v1/object/public/')) {
    return url.replace('/storage/v1/object/product-images/', '/storage/v1/object/public/product-images/');
  }
  return url;
}

const NO_IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><rect width="80" height="80" fill="%231e1e24"/><text x="40" y="46" font-size="28" text-anchor="middle" dominant-baseline="middle" fill="%23555560">👕</text></svg>'
);


// متغيرات الرسوم البيانية والذاكرة المؤقتة
let salesChartInstance = null;
let statusChartInstance = null;

let allOrdersCache = [];
let allProductsCache = [];
let allVariantsCache = [];
let allDiscountsCache = [];

// حالة نموذج إضافة المنتج
let currentProductColors = [];
let currentProductSizes = [];
let currentUploadedImages = []; // { file, previewUrl, is_cover, sort_order, existing_url }

// ==================================================
// تهيئة التطبيق
// ==================================================
document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupUIEvents();
  setupProductFormEvents();
  loadAllDashboardData();
});

// ==================================================
// التنقل بين التبويبات
// ==================================================
function setupNavigation() {
  const navItems = document.querySelectorAll(".sidebar-nav .nav-item");
  const tabPanels = document.querySelectorAll(".tab-panel");
  const titleEl = document.getElementById("currentPageTitle");

  navItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const tabKey = item.getAttribute("data-tab");

      navItems.forEach(n => n.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));

      item.classList.add("active");
      const activePanel = document.getElementById(`tab-${tabKey}`);
      if (activePanel) activePanel.classList.add("active");

      if (titleEl) {
        titleEl.textContent = item.querySelector("span").textContent;
      }

      const sidebar = document.getElementById("sidebar");
      if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.remove("show");
      }
    });
  });

  document.querySelectorAll("[data-tab-switch]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const target = btn.getAttribute("data-tab-switch");
      const targetNav = document.querySelector(`.nav-item[data-tab="${target}"]`);
      if (targetNav) targetNav.click();
    });
  });
}

function setupUIEvents() {
  const menuBtn = document.getElementById("menuToggleBtn");
  const closeBtn = document.getElementById("closeSidebarBtn");
  const sidebar = document.getElementById("sidebar");

  if (menuBtn && sidebar) menuBtn.addEventListener("click", () => sidebar.classList.add("show"));
  if (closeBtn && sidebar) closeBtn.addEventListener("click", () => sidebar.classList.remove("show"));

  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      refreshBtn.querySelector("i").classList.add("fa-spin");
      loadAllDashboardData().finally(() => {
        setTimeout(() => refreshBtn.querySelector("i").classList.remove("fa-spin"), 600);
      });
    });
  }

  const orderFilter = document.getElementById("orderStatusFilter");
  if (orderFilter) {
    orderFilter.addEventListener("change", () => filterOrdersTable(orderFilter.value));
  }

  const stockFilter = document.getElementById("inventoryStockFilter");
  if (stockFilter) {
    stockFilter.addEventListener("change", () => filterInventoryTable(stockFilter.value));
  }

  const prodSearch = document.getElementById("productSearchInput");
  if (prodSearch) {
    prodSearch.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      const filtered = allProductsCache.filter(p => 
        p.name.toLowerCase().includes(term) || (p.sku && p.sku.toLowerCase().includes(term))
      );
      renderProductsTable(filtered);
    });
  }
}

// دالة الجلب الشامل
async function loadAllDashboardData() {
  await Promise.allSettled([
    loadOrders(),
    loadProductsWithVariants(),
    loadDiscounts(),
    loadCustomers()
  ]);
  calculateKPIsAndCharts();
}

// ==================================================
// الطلبات (Orders)
// ==================================================
async function loadOrders() {
  const tbody = document.getElementById("allOrdersTbody");
  if (!tbody) return;

  try {
    const { data: orders, error: ordersErr } = await supabaseClient
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (ordersErr) throw ordersErr;

    const { data: items } = await supabaseClient
      .from("order_items")
      .select("*");

    const itemsMap = {};
    if (items) {
      items.forEach(it => {
        if (!itemsMap[it.order_id]) itemsMap[it.order_id] = [];
        itemsMap[it.order_id].push(it);
      });
    }

    allOrdersCache = (orders || []).map(o => {
      const orderItems = itemsMap[o.id] || [];
      let totalCost = 0;
      orderItems.forEach(it => {
        totalCost += Number(it.cost_price || 0) * Number(it.quantity || 1);
      });
      const totalAmount = Number(o.total_amount || 0);
      const profit = totalAmount - totalCost;

      return {
        ...o,
        items: orderItems,
        calculated_cost: totalCost,
        calculated_profit: profit
      };
    });

    renderOrdersTable(allOrdersCache);
    renderLatestOrders(allOrdersCache.slice(0, 5));

  } catch (err) {
    console.error("خطأ في جلب الطلبات:", err);
    tbody.innerHTML = `<tr><td colspan="13" class="empty-cell" style="color:var(--accent-red);">فشل تحميل الطلبات: ${err.message}</td></tr>`;
  }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById("allOrdersTbody");
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="empty-cell">لا توجد طلبات مسجلة حتى الآن.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><strong>#${o.id.slice(0, 8)}</strong></td>
      <td>
        <div><strong>${o.customer_name || 'عميل'}</strong></div>
        <small style="color:var(--text-muted); direction:ltr; display:inline-block;">${o.customer_phone || '-'}</small>
      </td>
      <td><strong>${o.items ? o.items.length : 0}</strong> صنف</td>
      <td>${Number(o.subtotal || o.total_amount || 0).toLocaleString("ar-EG")} ج.م</td>
      <td>${Number(o.discount_amount || 0).toLocaleString("ar-EG")} ج.م</td>
      <td>${Number(o.shipping_cost || 0).toLocaleString("ar-EG")} ج.م</td>
      <td><strong style="color:var(--accent-gold);">${Number(o.total_amount || 0).toLocaleString("ar-EG")} ج.م</strong></td>
      <td>${Number(o.calculated_cost || 0).toLocaleString("ar-EG")} ج.م</td>
      <td><strong style="color:${o.calculated_profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${Number(o.calculated_profit || 0).toLocaleString("ar-EG")} ج.م</strong></td>
      <td><span class="badge-status badge-${o.payment_status === 'paid' ? 'paid' : 'unpaid'}">${o.payment_status === 'paid' ? 'مدفوع' : 'معلق'}</span></td>
      <td>
        <select class="form-select" style="padding:4px 8px; font-size:0.8rem;" onchange="updateOrderStatus('${o.id}', this.value)">
          <option value="pending" ${o.status === 'pending' ? 'selected' : ''}>قيد الانتظار</option>
          <option value="confirmed" ${o.status === 'confirmed' ? 'selected' : ''}>مؤكد</option>
          <option value="processing" ${o.status === 'processing' ? 'selected' : ''}>جاري التجهيز</option>
          <option value="shipped" ${o.status === 'shipped' ? 'selected' : ''}>تم الشحن</option>
          <option value="delivered" ${o.status === 'delivered' ? 'selected' : ''}>تم التوصيل</option>
          <option value="cancelled" ${o.status === 'cancelled' ? 'selected' : ''}>ملغي</option>
          <option value="returned" ${o.status === 'returned' ? 'selected' : ''}>مرتجع</option>
        </select>
      </td>
      <td>${new Date(o.created_at).toLocaleDateString("ar-EG")}</td>
      <td>
        <button class="btn-secondary" style="padding:4px 10px; font-size:0.8rem;" onclick="openOrderDetailsModal('${o.id}')">
          <i class="fa-solid fa-eye"></i> تفاصيل
        </button>
      </td>
    </tr>
  `).join("");
}

function filterOrdersTable(status) {
  if (status === "all") {
    renderOrdersTable(allOrdersCache);
  } else {
    renderOrdersTable(allOrdersCache.filter(o => o.status === status));
  }
}

function renderLatestOrders(orders) {
  const tbody = document.getElementById("latestOrdersTbody");
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">لا توجد طلبات حديثة.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><strong>#${o.id.slice(0, 8)}</strong></td>
      <td>${o.customer_name || 'عميل'}</td>
      <td style="direction:ltr; text-align:right;">${o.customer_phone || '-'}</td>
      <td><strong>${Number(o.total_amount || 0).toLocaleString("ar-EG")} ج.م</strong></td>
      <td style="color:${o.calculated_profit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};">${Number(o.calculated_profit || 0).toLocaleString("ar-EG")} ج.م</td>
      <td><span class="badge-status badge-${o.status}">${translateStatus(o.status)}</span></td>
      <td><span class="badge-status badge-${o.payment_status === 'paid' ? 'paid' : 'unpaid'}">${o.payment_status === 'paid' ? 'مدفوع' : 'معلق'}</span></td>
      <td>
        <button class="link-btn" onclick="openOrderDetailsModal('${o.id}')">عرض</button>
      </td>
    </tr>
  `).join("");
}

window.openOrderDetailsModal = async function(orderId) {
  const modal = document.getElementById("orderDetailsModal");
  const modalBody = document.getElementById("modalOrderBody");
  const modalTitle = document.getElementById("modalOrderNumber");
  modal.classList.add("active");
  modalTitle.textContent = `تفاصيل الطلب #${orderId.slice(0, 8)}`;
  modalBody.innerHTML = `<div class="loading-cell">جاري جلب تفاصيل الطلب...</div>`;

  try {
    const { data: order, error: ordErr } = await supabaseClient
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (ordErr) throw ordErr;

    const { data: items } = await supabaseClient
      .from("order_items")
      .select("*")
      .eq("order_id", orderId);

    let totalItemsCost = 0;
    const itemsList = items || [];
    itemsList.forEach(it => {
      totalItemsCost += Number(it.cost_price || 0) * Number(it.quantity || 1);
    });

    const subtotal = Number(order.subtotal || order.total_amount || 0);
    const discount = Number(order.discount_amount || 0);
    const shipping = Number(order.shipping_cost || 0);
    const totalAmount = Number(order.total_amount || 0);
    const totalProfit = totalAmount - totalItemsCost;

    const addressDetails = `
      ${order.governorate ? 'المحافظة: ' + order.governorate + ' | ' : ''}
      ${order.city ? 'المدينة: ' + order.city + ' | ' : ''}
      ${order.area ? 'المنطقة: ' + order.area + '<br>' : ''}
      ${order.address_line ? 'العنوان: ' + order.address_line + '<br>' : ''}
      ${order.building_number ? 'عمارة: ' + order.building_number + ' - ' : ''}
      ${order.floor_number ? 'طابق: ' + order.floor_number + ' - ' : ''}
      ${order.apartment_number ? 'شقة: ' + order.apartment_number : ''}
      ${order.address_notes ? '<br><small style="color:var(--accent-gold);">ملاحظات: ' + order.address_notes + '</small>' : ''}
    `;

    modalBody.innerHTML = `
      <div class="order-detail-grid">
        <div class="info-card">
          <h4><i class="fa-solid fa-user"></i> بيانات العميل</h4>
          <div class="info-list-row"><span>الاسم:</span><strong>${order.customer_name || 'غير محدد'}</strong></div>
          <div class="info-list-row"><span>الهاتف:</span><strong style="direction:ltr;">${order.customer_phone || '-'}</strong></div>
          <div class="info-list-row"><span>البريد الإلكتروني:</span><span>${order.customer_email || '-'}</span></div>
          <div class="info-list-row"><span>تاريخ الطلب:</span><span>${new Date(order.created_at).toLocaleString("ar-EG")}</span></div>
        </div>

        <div class="info-card">
          <h4><i class="fa-solid fa-location-dot"></i> عنوان الشحن والتسليم</h4>
          <div style="font-size:0.85rem; line-height:1.7;">
            ${addressDetails.trim() || 'لم يتم تسجيل تفاصيل العنوان'}
          </div>
        </div>
      </div>

      <div class="card table-card" style="margin-bottom:0;">
        <div class="card-header">
          <h4 style="font-size:0.95rem;"><i class="fa-solid fa-boxes-stacked"></i> منتجات وبنود الطلب</h4>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>المنتج</th>
                <th>اللون والمقاس</th>
                <th>SKU</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>تكلفة الوحدة</th>
                <th>الإجمالي</th>
                <th>الربح</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList.length === 0 ? '<tr><td colspan="8" class="empty-cell">لا توجد بنود مسجلة لهذا الطلب</td></tr>' : 
                itemsList.map(it => {
                  const qty = Number(it.quantity || 1);
                  const price = Number(it.unit_price || 0);
                  const cost = Number(it.cost_price || 0);
                  const itemTotal = price * qty;
                  const itemProfit = (price - cost) * qty;

                  return `
                    <tr>
                      <td><strong>${it.product_name || 'منتج'}</strong></td>
                      <td>${it.color_name || '-'} / ${it.size_name || '-'}</td>
                      <td><code>${it.sku || '-'}</code></td>
                      <td>${qty}</td>
                      <td>${price.toLocaleString("ar-EG")} ج.م</td>
                      <td>${cost.toLocaleString("ar-EG")} ج.م</td>
                      <td><strong>${itemTotal.toLocaleString("ar-EG")} ج.م</strong></td>
                      <td style="color:${itemProfit >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'};"><strong>${itemProfit.toLocaleString("ar-EG")} ج.م</strong></td>
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="order-totals-card">
        <div class="info-list-row"><span>المجموع الفرعي (Subtotal):</span><strong>${subtotal.toLocaleString("ar-EG")} ج.م</strong></div>
        <div class="info-list-row"><span>الخصم (Discount):</span><strong style="color:var(--accent-red);">- ${discount.toLocaleString("ar-EG")} ج.م</strong></div>
        <div class="info-list-row"><span>تكلفة الشحن (Shipping):</span><strong>${shipping.toLocaleString("ar-EG")} ج.م</strong></div>
        <div class="info-list-row" style="font-size:1.1rem; border-top:1px solid var(--border-color); padding-top:10px;">
          <span>الإجمالي النهائي (Total):</span><strong style="color:var(--accent-gold);">${totalAmount.toLocaleString("ar-EG")} ج.م</strong>
        </div>
        <div class="info-list-row" style="color:var(--text-muted);"><span>إجمالي تكلفة المصنع:</span><span>${totalItemsCost.toLocaleString("ar-EG")} ج.م</span></div>
        <div class="info-list-row" style="color:var(--accent-green); font-size:1rem;">
          <span>صافي ربح الطلب:</span><strong>${totalProfit.toLocaleString("ar-EG")} ج.م</strong>
        </div>
      </div>
    `;

  } catch (err) {
    modalBody.innerHTML = `<div class="empty-cell" style="color:var(--accent-red);">خطأ أثناء تحميل الطلب: ${err.message}</div>`;
  }
};

window.closeOrderModal = function() {
  document.getElementById("orderDetailsModal").classList.remove("active");
};

window.updateOrderStatus = async function(orderId, newStatus) {
  try {
    const { error } = await supabaseClient
      .from("orders")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", orderId);

    if (error) throw error;

    await supabaseClient.from("order_status_history").insert({
      order_id: orderId,
      status: newStatus,
      notes: `تم التحديث من لوحة الإدارة`
    });

    loadOrders();
  } catch (err) {
    alert("تعذر تحديث حالة الطلب: " + err.message);
  }
};

// ==================================================
// إضافة وتعديل المنتجات
// ==================================================
function setupProductFormEvents() {
  const nameInput = document.getElementById("p_name");
  const slugInput = document.getElementById("p_slug");
  if (nameInput && slugInput) {
    nameInput.addEventListener("input", () => {
      if (!document.getElementById("editProductId").value) {
        slugInput.value = slugifyText(nameInput.value);
      }
    });
  }

  const addColorBtn = document.getElementById("addColorBtn");
  const colorNameInput = document.getElementById("colorNameInput");
  const colorHexInput = document.getElementById("colorHexInput");

  if (addColorBtn) {
    addColorBtn.addEventListener("click", () => {
      const name = colorNameInput.value.trim();
      const hex = colorHexInput.value;
      if (!name) return alert("يرجى إدخال اسم اللون");

      currentProductColors.push({ name, hex_code: hex });
      colorNameInput.value = "";
      renderColorsTags();
      generateVariantMatrix();
    });
  }

  const addSizeBtn = document.getElementById("addSizeBtn");
  const sizeNameInput = document.getElementById("sizeNameInput");

  if (addSizeBtn) {
    addSizeBtn.addEventListener("click", () => {
      const name = sizeNameInput.value.trim().toUpperCase();
      if (!name) return alert("يرجى إدخال اسم المقاس");
      if (currentProductSizes.some(s => s.name === name)) return alert("المقاس مضاف مسبقاً");

      currentProductSizes.push({ name });
      sizeNameInput.value = "";
      renderSizesTags();
      generateVariantMatrix();
    });
  }

  const dropzone = document.getElementById("imageDropzone");
  const fileInput = document.getElementById("imageFileInput");

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files);
      files.forEach((file) => {
        const previewUrl = URL.createObjectURL(file);
        const isCover = currentUploadedImages.length === 0;
        currentUploadedImages.push({
          file,
          previewUrl,
          is_cover: isCover,
          sort_order: currentUploadedImages.length
        });
      });
      renderImagesPreview();
      fileInput.value = "";
    });
  }

  const genBtn = document.getElementById("generateMatrixBtn");
  if (genBtn) genBtn.addEventListener("click", generateVariantMatrix);

  const resetBtn = document.getElementById("resetProductFormBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetProductForm);
}

window.addPresetSizes = function(presets) {
  presets.forEach(sz => {
    if (!currentProductSizes.some(s => s.name === sz)) {
      currentProductSizes.push({ name: sz });
    }
  });
  renderSizesTags();
  generateVariantMatrix();
};

function renderColorsTags() {
  const container = document.getElementById("colorsListContainer");
  if (!container) return;
  container.innerHTML = currentProductColors.map((c, i) => `
    <span class="tag-item">
      <span class="color-dot" style="background:${c.hex_code};"></span>
      ${c.name}
      <i class="fa-solid fa-xmark tag-del" onclick="removeColor(${i})"></i>
    </span>
  `).join("");
}

window.removeColor = function(index) {
  currentProductColors.splice(index, 1);
  renderColorsTags();
  generateVariantMatrix();
};

function renderSizesTags() {
  const container = document.getElementById("sizesListContainer");
  if (!container) return;
  container.innerHTML = currentProductSizes.map((s, i) => `
    <span class="tag-item">
      ${s.name}
      <i class="fa-solid fa-xmark tag-del" onclick="removeSize(${i})"></i>
    </span>
  `).join("");
}

window.removeSize = function(index) {
  currentProductSizes.splice(index, 1);
  renderSizesTags();
  generateVariantMatrix();
};

function renderImagesPreview() {
  const container = document.getElementById("imagesPreviewContainer");
  if (!container) return;

  container.innerHTML = currentUploadedImages.map((img, i) => `
    <div class="img-preview-box">
      <img src="${img.previewUrl || img.existing_url}" alt="Product">
      <div class="img-actions-overlay">
        <button type="button" class="img-btn-circle" title="حذف الصورة" onclick="removeUploadedImage(${i})">
          <i class="fa-solid fa-trash"></i>
        </button>
        <button type="button" class="img-btn-circle" title="جعلها الصورة الرئيسية" onclick="setImageAsCover(${i})">
          <i class="fa-solid ${img.is_cover ? 'fa-star' : 'fa-star-half-stroke'}"></i>
        </button>
      </div>
      ${img.is_cover ? '<span class="cover-badge">الرئيسية</span>' : ''}
    </div>
  `).join("");
}

window.removeUploadedImage = function(index) {
  currentUploadedImages.splice(index, 1);
  if (currentUploadedImages.length > 0 && !currentUploadedImages.some(img => img.is_cover)) {
    currentUploadedImages[0].is_cover = true;
  }
  renderImagesPreview();
};

window.setImageAsCover = function(index) {
  currentUploadedImages.forEach((img, i) => {
    img.is_cover = (i === index);
  });
  renderImagesPreview();
};

function generateVariantMatrix() {
  const tbody = document.getElementById("matrixTableBody");
  if (!tbody) return;

  if (currentProductColors.length === 0 || currentProductSizes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">أضف لوناً واحداً ومقاساً واحداً على الأقل لإنشاء المصفوفة.</td></tr>`;
    return;
  }

  const defaultPrice = document.getElementById("p_selling_price").value || 0;
  const defaultCost = document.getElementById("p_cost_price").value || 0;
  const baseSku = (document.getElementById("p_sku").value || "SKU").trim().toUpperCase();

  let rows = "";
  currentProductColors.forEach((col, cIdx) => {
    currentProductSizes.forEach((siz, sIdx) => {
      const variantSku = `${baseSku}-${col.name.slice(0, 3).toUpperCase()}-${siz.name}`;

      rows += `
        <tr class="matrix-row" data-color-idx="${cIdx}" data-size-idx="${sIdx}">
          <td>
            <span class="color-dot" style="background:${col.hex_code};"></span>
            ${col.name}
          </td>
          <td><strong>${siz.name}</strong></td>
          <td><input type="text" class="m-sku" value="${variantSku}"></td>
          <td><input type="number" step="0.01" class="m-price" value="${defaultPrice}"></td>
          <td><input type="number" step="0.01" class="m-cost" value="${defaultCost}"></td>
          <td><input type="number" class="m-stock" value="10" min="0"></td>
          <td>
            <label class="checkbox-label">
              <input type="checkbox" class="m-active" checked> نشط
            </label>
          </td>
        </tr>
      `;
    });
  });

  tbody.innerHTML = rows;
}


function slugifyText(text) {
  if (!text) return "";
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\u0600-\u06FFa-z0-9\s_-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateSafeUniqueSlug(text) {
  let base = slugifyText(text);
  if (!base) base = "product";
  const suffix = Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
  return base + "-" + suffix;
}

window.handleProductFormSubmit = async function(e) {
  e.preventDefault();

  const statusMsg = document.getElementById("formStatusMsg");
  const submitBtn = document.getElementById("submitProductBtn");
  const editId = document.getElementById("editProductId").value;

  const name = document.getElementById("p_name").value.trim();
  const slug = document.getElementById("p_slug").value.trim();
  const description = document.getElementById("p_description").value.trim();
  const selling_price = parseFloat(document.getElementById("p_selling_price").value) || 0;
  const cost_price = parseFloat(document.getElementById("p_cost_price").value) || 0;
  const compare_at_price = parseFloat(document.getElementById("p_compare_price").value) || null;
  const sku = document.getElementById("p_sku").value.trim();
  const is_active = document.getElementById("p_is_active").checked;
  const is_featured = document.getElementById("p_is_featured").checked;

  submitBtn.disabled = true;
  statusMsg.textContent = "جاري حفظ المنتج والبيانات...";
  statusMsg.style.color = "var(--accent-gold)";

  try {
    let productId = editId;

    if (editId) {
      const { error: updErr } = await supabaseClient
        .from("products")
        .update({
          name, slug: slugifyText(slug) || generateSafeUniqueSlug(name), description, selling_price, cost_price,
          compare_at_price, sku, is_active, is_featured, updated_at: new Date().toISOString()
        })
        .eq("id", editId);
      if (updErr) throw updErr;
    } else {
      let productSlug = slugifyText(slug);
      if (!productSlug) {
        productSlug = generateSafeUniqueSlug(name);
      }
      let { data: newProd, error: insErr } = await supabaseClient
        .from("products")
        .insert({
          name, slug: productSlug, description, selling_price, cost_price,
          compare_at_price, sku, is_active, is_featured
        })
        .select()
        .single();

      // إذا تكرر الـ slug، نولد slug فريد ونعيد المحاولة تلقائياً
      if (insErr && (insErr.code === '23505' || insErr.message.includes('products_slug_key'))) {
        productSlug = generateSafeUniqueSlug(name);
        const retryRes = await supabaseClient
          .from("products")
          .insert({
            name, slug: productSlug, description, selling_price, cost_price,
            compare_at_price, sku, is_active, is_featured
          })
          .select()
          .single();
        if (retryRes.error) throw retryRes.error;
        newProd = retryRes.data;
        insErr = null;
      } else if (insErr) {
        throw insErr;
      }
      productId = newProd.id;
    }

    for (let i = 0; i < currentUploadedImages.length; i++) {
      const img = currentUploadedImages[i];
      if (img.file) {
        const fileExt = img.file.name.split('.').pop();
        const fileName = `${productId}/${Date.now()}-${i}.${fileExt}`;
        
        const { data: uploadData, error: uploadErr } = await supabaseClient
          .storage
          .from("product-images")
          .upload(fileName, img.file, { upsert: true });

        if (uploadErr) {
          console.error("خطأ في رفع الصورة إلى Storage:", uploadErr);
          alert("تنبيه: فشل رفع الصورة إلى Supabase Storage. يرجى التأكد من إنشاء Bucket باسم 'product-images' وتفعيله كـ Public في Supabase.");
        } else if (uploadData) {
          const { data: pubUrlData } = supabaseClient.storage.from("product-images").getPublicUrl(fileName);
          let fullUrl = pubUrlData.publicUrl;
          if (fullUrl && fullUrl.includes('/storage/v1/object/product-images/') && !fullUrl.includes('/storage/v1/object/public/')) {
            fullUrl = fullUrl.replace('/storage/v1/object/product-images/', '/storage/v1/object/public/product-images/');
          }

          await supabaseClient.from("product_images").insert({
            product_id: productId,
            image_url: fullUrl,
            is_cover: img.is_cover,
            sort_order: i
          });
        }
      }
    }

    // جلب أو إنشاء الألوان والمقاسات (يدعم الجداول المرتبطة بالمنتج أو العامة)
    async function getOrCreate(table, row) {
      // 1) البحث داخل نفس المنتج
      let { data: found, error: findErr } = await supabaseClient.from(table).select("id")
        .eq("product_id", productId).eq("name", row.name).limit(1);
      if (!findErr && found && found.length) return found[0].id;

      // 2) محاولة الإضافة مربوطة بالمنتج
      let ins = await supabaseClient.from(table)
        .insert({ product_id: productId, ...row }).select("id").single();
      if (!ins.error && ins.data) return ins.data.id;

      // 3) لو الجدول عام (بدون product_id) أو الاسم مكرر: نبحث بالاسم فقط
      const byName = await supabaseClient.from(table).select("id").eq("name", row.name).limit(1);
      if (!byName.error && byName.data && byName.data.length) return byName.data[0].id;

      // 4) إضافة بدون product_id
      const ins2 = await supabaseClient.from(table).insert({ ...row }).select("id").single();
      if (!ins2.error && ins2.data) return ins2.data.id;

      const msg = (ins.error && ins.error.message) || (ins2.error && ins2.error.message) || "سبب غير معروف";
      throw new Error(`فشل حفظ "${row.name}" في ${table}: ${msg}`);
    }

    const colorIdMap = {};
    for (let col of currentProductColors) {
      colorIdMap[col.name] = await getOrCreate("product_colors", { name: col.name, hex_code: col.hex_code });
    }

    const sizeIdMap = {};
    for (let siz of currentProductSizes) {
      sizeIdMap[siz.name] = await getOrCreate("product_sizes", { name: siz.name });
    }
    console.log("[حفظ المنتج] معرفات المقاسات:", sizeIdMap, "معرفات الألوان:", colorIdMap);

    const matrixRows = document.querySelectorAll(".matrix-row");
    const variantsToInsert = [];
    let totalStockFromVariants = 0;

    matrixRows.forEach(row => {
      const cIdx = row.getAttribute("data-color-idx");
      const sIdx = row.getAttribute("data-size-idx");
      const colName = currentProductColors[cIdx]?.name;
      const sizName = currentProductSizes[sIdx]?.name;

      const vSku = row.querySelector(".m-sku").value.trim();
      const vPrice = parseFloat(row.querySelector(".m-price").value) || selling_price;
      const vCost = parseFloat(row.querySelector(".m-cost").value) || cost_price;
      const vStock = parseInt(row.querySelector(".m-stock").value) || 0;
      const vActive = row.querySelector(".m-active").checked;

      if (sizName && !sizeIdMap[sizName]) {
        throw new Error(`المقاس "${sizName}" لم يُحفظ بشكل صحيح، لم يتم حفظ المتغيرات.`);
      }

      totalStockFromVariants += vStock;

      variantsToInsert.push({
        product_id: productId,
        color_id: colorIdMap[colName] || null,
        size_id: sizeIdMap[sizName] || null,
        sku: vSku,
        price: vPrice,
        cost_price: vCost,
        stock_quantity: vStock,
        is_active: vActive
      });
    });

    if (variantsToInsert.length > 0) {
      const failed = [];
      for (const v of variantsToInsert) {
        let q = supabaseClient.from("product_variants").select("id").eq("product_id", productId);
        q = v.color_id ? q.eq("color_id", v.color_id) : q.is("color_id", null);
        q = v.size_id ? q.eq("size_id", v.size_id) : q.is("size_id", null);
        const { data: ex } = await q.limit(1);
        const res = (ex && ex.length)
          ? await supabaseClient.from("product_variants").update(v).eq("id", ex[0].id)
          : await supabaseClient.from("product_variants").insert(v);
        if (res.error) failed.push(`${v.sku}: ${res.error.message}`);
      }

      // حذف الصفوف القديمة التالفة اللي اتسجلت من غير مقاس (كانت بتظهر "-")
      if (variantsToInsert.every(v => v.size_id)) {
        const { error: cleanErr } = await supabaseClient.from("product_variants")
          .delete().eq("product_id", productId).is("size_id", null);
        if (cleanErr) console.warn("تعذر حذف الصفوف القديمة بدون مقاس:", cleanErr.message);
      }

      if (failed.length) alert("بعض المتغيرات لم تُحفظ:\n" + failed.join("\n"));
      await supabaseClient.from("products").update({ stock_quantity: totalStockFromVariants }).eq("id", productId);
    }

    statusMsg.textContent = editId ? "تم تحديث المنتج بنجاح!" : "تمت إضافة المنتج بنجاح!";
    statusMsg.style.color = "var(--accent-green)";

    alert(editId ? "تم تعديل المنتج بنجاح!" : "تم نشر المنتج الجديد والمتغيرات بنجاح!");
    resetProductForm();
    loadProductsWithVariants();
    loadAllDashboardData();

    const prodNav = document.querySelector(`.nav-item[data-tab="products"]`);
    if (prodNav) prodNav.click();

  } catch (err) {
    console.error("فشل حفظ المنتج:", err);
    statusMsg.textContent = "حدث خطأ: " + err.message;
    statusMsg.style.color = "var(--accent-red)";
    alert("حدث خطأ أثناء حفظ المنتج: " + err.message);
  } finally {
    submitBtn.disabled = false;
  }
};

function resetProductForm() {
  document.getElementById("productForm").reset();
  document.getElementById("editProductId").value = "";
  document.getElementById("formModeTitle").innerHTML = `<i class="fa-solid fa-circle-plus"></i> إضافة منتج جديد`;
  document.getElementById("submitBtnText").textContent = "حفظ ونشر المنتج";
  document.getElementById("formStatusMsg").textContent = "";

  currentProductColors = [];
  currentProductSizes = [];
  currentUploadedImages = [];

  renderColorsTags();
  renderSizesTags();
  renderImagesPreview();
  generateVariantMatrix();
}

window.editProduct = async function(productId) {
  const product = allProductsCache.find(p => p.id === productId);
  if (!product) return;

  resetProductForm();
  document.getElementById("editProductId").value = product.id;
  document.getElementById("formModeTitle").innerHTML = `<i class="fa-solid fa-pen-to-square"></i> تعديل المنتج: ${product.name}`;
  document.getElementById("submitBtnText").textContent = "حفظ التعديلات";

  document.getElementById("p_name").value = product.name || "";
  document.getElementById("p_slug").value = product.slug || "";
  document.getElementById("p_description").value = product.description || "";
  document.getElementById("p_selling_price").value = product.selling_price || 0;
  document.getElementById("p_cost_price").value = product.cost_price || 0;
  document.getElementById("p_compare_price").value = product.compare_at_price || "";
  document.getElementById("p_sku").value = product.sku || "";
  document.getElementById("p_is_active").checked = !!product.is_active;
  document.getElementById("p_is_featured").checked = !!product.is_featured;

  if (product.product_images) {
    currentUploadedImages = product.product_images.map(img => ({
      existing_url: img.image_url,
      previewUrl: img.image_url,
      is_cover: !!img.is_cover,
      sort_order: img.sort_order || 0
    }));
    renderImagesPreview();
  }

  // تحميل الألوان والمقاسات والمخزون الحالي للمنتج داخل الفورم (عشان التعديل مايعملش صفوف مكررة)
  const variants = product.product_variants || [];
  variants.forEach(v => {
    const cName = v.product_colors?.name;
    const sName = getVariantSizeName(v);
    if (cName && !currentProductColors.some(c => c.name === cName)) {
      currentProductColors.push({ name: cName, hex_code: v.product_colors.hex_code || "#000000" });
    }
    if (sName && !currentProductSizes.some(s => s.name === sName)) {
      currentProductSizes.push({ name: sName });
    }
  });
  renderColorsTags();
  renderSizesTags();
  generateVariantMatrix();
  document.querySelectorAll(".matrix-row").forEach(row => {
    const col = currentProductColors[row.getAttribute("data-color-idx")]?.name;
    const siz = currentProductSizes[row.getAttribute("data-size-idx")]?.name;
    const v = variants.find(x => x.product_colors?.name === col && getVariantSizeName(x) === siz);
    if (!v) return;
    if (v.sku) row.querySelector(".m-sku").value = v.sku;
    row.querySelector(".m-price").value = v.price ?? 0;
    row.querySelector(".m-cost").value = v.cost_price ?? 0;
    row.querySelector(".m-stock").value = v.stock_quantity ?? 0;
    row.querySelector(".m-active").checked = v.is_active !== false;
  });

  const addNav = document.getElementById("navAddProduct");
  if (addNav) addNav.click();
};

window.deleteProduct = async function(productId, productName) {
  const confirmDel = confirm(`هل أنت متأكد من رغبتك في حذف المنتج: "${productName}"؟`);
  if (!confirmDel) return;

  try {
    const { data: orderItemCheck } = await supabaseClient
      .from("order_items")
      .select("id")
      .eq("product_id", productId)
      .limit(1);

    if (orderItemCheck && orderItemCheck.length > 0) {
      await supabaseClient
        .from("products")
        .update({ is_active: false })
        .eq("id", productId);
      alert("المنتج مرتبط بطلبات سابقة، تم إيقاف تنشيطه (is_active = false) للحفاظ على سجلات الطلبات.");
    } else {
      await supabaseClient.from("product_variants").delete().eq("product_id", productId);
      await supabaseClient.from("product_images").delete().eq("product_id", productId);
      await supabaseClient.from("product_colors").delete().eq("product_id", productId);
      await supabaseClient.from("product_sizes").delete().eq("product_id", productId);
      const { error } = await supabaseClient.from("products").delete().eq("id", productId);
      if (error) throw error;
      alert("تم حذف المنتج بنجاح.");
    }

    loadProductsWithVariants();
  } catch (err) {
    alert("تعذر حذف المنتج: " + err.message);
  }
};

// ==================================================
// استعراض المنتجات وجرد المخزون
// ==================================================
async function loadProductsWithVariants() {
  const prodTbody = document.getElementById("productsTbody");

  try {
    const { data: products, error } = await supabaseClient
      .from("products")
      .select(`
        *,
        product_images(image_url, is_cover, sort_order),
        product_variants(id, sku, price, cost_price, stock_quantity, is_active, color_id, size_id, product_colors(name, hex_code), product_sizes(name))
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    allProductsCache = products || [];

    // تحديث قائمة المنتجات داخل نافذة الكوبونات
    populateDiscountProductsSelect();

    allVariantsCache = [];
    allProductsCache.forEach(p => {
      if (p.product_variants && p.product_variants.length > 0) {
        p.product_variants.forEach(v => {
          allVariantsCache.push({
            ...v,
            product_name: p.name,
            product_id: p.id
          });
        });
      }
    });

    renderProductsTable(allProductsCache);
    renderInventoryTable(allVariantsCache);

  } catch (err) {
    console.error("خطأ في جلب المنتجات:", err);
    if (prodTbody) prodTbody.innerHTML = `<tr><td colspan="8" class="empty-cell" style="color:var(--accent-red);">فشل جلب المنتجات: ${err.message}</td></tr>`;
  }
}

function populateDiscountProductsSelect() {
  const sel = document.getElementById("d_specific_product");
  if (!sel) return;
  sel.innerHTML = `<option value="">اختر المنتج من القائمة...</option>` +
    allProductsCache.map(p => `<option value="${p.id}">${p.name} (${Number(p.selling_price || 0).toLocaleString("ar-EG")} ج.م)</option>`).join("");
}

function renderProductsTable(products) {
  const tbody = document.getElementById("productsTbody");
  if (!tbody) return;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">لا توجد منتجات مسجلة.</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const cover = (p.product_images && p.product_images.find(img => img.is_cover)) || (p.product_images && p.product_images[0]);
    const imgUrl = cover ? cover.image_url : NO_IMG_PLACEHOLDER;

    let variantsPills = "";
    let totalStock = 0;

    if (p.product_variants && p.product_variants.length > 0) {
      variantsPills = p.product_variants.map(v => {
        totalStock += Number(v.stock_quantity || 0);
        return `
          <span class="variant-pill">
            ${v.product_colors ? `<span class="color-dot" style="background:${v.product_colors.hex_code};"></span>` : ''}
            ${getVariantSizeName(v)} 
            <strong>(${v.stock_quantity})</strong>
          </span>
        `;
      }).join("");
    } else {
      totalStock = Number(p.stock_quantity || 0);
      variantsPills = `<span style="color:var(--text-dim);">بدون متغيرات</span>`;
    }

    return `
      <tr>
        <td><img src="${formatImageUrl(imgUrl)}" class="prod-thumb" alt="${p.name}" onerror="this.onerror=null;this.src=NO_IMG_PLACEHOLDER;"></td>
        <td>
          <strong>${p.name}</strong>
          <div style="font-size:0.75rem; color:var(--text-dim);">${p.sku || ''}</div>
        </td>
        <td><strong>${Number(p.selling_price || 0).toLocaleString("ar-EG")} ج.م</strong></td>
        <td>${Number(p.cost_price || 0).toLocaleString("ar-EG")} ج.م</td>
        <td style="max-width:260px;">${variantsPills}</td>
        <td><strong style="color:${totalStock <= 5 ? 'var(--accent-red)' : 'var(--text-main)'}; font-size:1rem;">${totalStock}</strong></td>
        <td>
          <span class="badge-status ${p.is_active ? 'badge-delivered' : 'badge-cancelled'}">
            ${p.is_active ? 'نشط' : 'معطل'}
          </span>
        </td>
        <td>
          <div class="flex-gap">
            <button class="btn-secondary" style="padding:4px 8px; color:var(--accent-gold);" title="إنشاء كوبون لهذا المنتج" onclick="createDiscountForProduct('${p.id}')">
              <i class="fa-solid fa-tag"></i> خصم
            </button>
            <button class="btn-secondary" style="padding:4px 8px;" title="تعديل" onclick="editProduct('${p.id}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-secondary" style="padding:4px 8px; color:var(--accent-red);" title="حذف" onclick="deleteProduct('${p.id}', '${p.name.replace(/'/g, "\\'")}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderInventoryTable(variants) {
  const tbody = document.getElementById("inventoryTbody");
  if (!tbody) return;

  if (variants.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">لا توجد متغيرات مخزون مسجلة.</td></tr>`;
    return;
  }

  tbody.innerHTML = variants.map(v => {
    const qty = Number(v.stock_quantity || 0);
    let stockStatusBadge = "";
    if (qty === 0) stockStatusBadge = `<span class="badge-status badge-outofstock">نفد من المخزون</span>`;
    else if (qty <= 5) stockStatusBadge = `<span class="badge-status badge-lowstock">أوشك على النفاد (${qty})</span>`;
    else stockStatusBadge = `<span class="badge-status badge-instock">متوفر (${qty})</span>`;

    return `
      <tr>
        <td><strong>${v.product_name}</strong></td>
        <td>
          ${v.product_colors ? `<span class="color-dot" style="background:${v.product_colors.hex_code};"></span> ${v.product_colors.name}` : '-'}
        </td>
        <td><strong>${getVariantSizeName(v) || '-'}</strong></td>
        <td><code>${v.sku || '-'}</code></td>
        <td>${Number(v.price || 0).toLocaleString("ar-EG")} ج.م</td>
        <td>${Number(v.cost_price || 0).toLocaleString("ar-EG")} ج.م</td>
        <td><strong style="font-size:1.05rem;">${qty}</strong></td>
        <td>${stockStatusBadge}</td>
        <td>
          <button class="btn-secondary" style="padding:4px 10px; font-size:0.8rem;" onclick="quickUpdateStock('${v.id}', ${qty})">
            <i class="fa-solid fa-pen-to-square"></i> تحديث
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

window.quickUpdateStock = async function(variantId, currentQty) {
  const newQty = prompt("أدخل كمية المخزون الجديدة:", currentQty);
  if (newQty === null) return;
  const parsed = parseInt(newQty);
  if (isNaN(parsed) || parsed < 0) return alert("يرجى إدخال رقم صحيح.");

  try {
    const { error } = await supabaseClient
      .from("product_variants")
      .update({ stock_quantity: parsed, updated_at: new Date().toISOString() })
      .eq("id", variantId);

    if (error) throw error;
    loadProductsWithVariants();
  } catch (err) {
    alert("تعذر تحديث المخزون: " + err.message);
  }
};

function filterInventoryTable(filter) {
  if (filter === "all") renderInventoryTable(allVariantsCache);
  else if (filter === "low") renderInventoryTable(allVariantsCache.filter(v => Number(v.stock_quantity) <= 5 && Number(v.stock_quantity) > 0));
  else if (filter === "out") renderInventoryTable(allVariantsCache.filter(v => Number(v.stock_quantity) === 0));
  else if (filter === "in") renderInventoryTable(allVariantsCache.filter(v => Number(v.stock_quantity) > 5));
}

// ==================================================
// نظام الكوبونات والخصومات (Discounts Management)
// ==================================================
async function loadDiscounts() {
  const tbody = document.getElementById("discountsTbody");
  if (!tbody) return;

  try {
    // جلب الكوبونات
    const { data: discounts, error: dErr } = await supabaseClient
      .from("discounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (dErr) throw dErr;

    // جلب علاقات المنتجات بالكوبونات من discount_products
    const { data: discountProds } = await supabaseClient
      .from("discount_products")
      .select("discount_id, product_id");

    const dpMap = {};
    if (discountProds) {
      discountProds.forEach(dp => {
        if (!dpMap[dp.discount_id]) dpMap[dp.discount_id] = [];
        dpMap[dp.discount_id].push(dp.product_id);
      });
    }

    allDiscountsCache = (discounts || []).map(d => ({
      ...d,
      specific_product_ids: dpMap[d.id] || []
    }));

    renderDiscountsTable(allDiscountsCache);

  } catch (err) {
    console.error("خطأ في جلب الكوبونات:", err);
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell" style="color:var(--accent-red);">فشل تحميل الكوبونات: ${err.message}</td></tr>`;
  }
}

function renderDiscountsTable(discounts) {
  const tbody = document.getElementById("discountsTbody");
  if (!tbody) return;

  if (discounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-cell">لا توجد كوبونات مسجلة. اضغط على "إضافة خصم جديد" لإنشاء أول كوبون.</td></tr>`;
    return;
  }

  tbody.innerHTML = discounts.map(d => {
    let scopeBadge = "";
    if (d.specific_product_ids && d.specific_product_ids.length > 0) {
      const prodNames = d.specific_product_ids.map(pid => {
        const p = allProductsCache.find(prod => prod.id === pid);
        return p ? p.name : "منتج محدد";
      }).join(", ");
      scopeBadge = `<span class="badge-status badge-confirmed" title="${prodNames}"><i class="fa-solid fa-shirt"></i> ${prodNames}</span>`;
    } else {
      scopeBadge = `<span class="badge-status badge-processing"><i class="fa-solid fa-globe"></i> كل المنتجات</span>`;
    }

    return `
      <tr>
        <td><strong><code style="color:var(--accent-gold); font-size:1.05rem; letter-spacing:1px;">${d.code}</code></strong></td>
        <td>${d.name || '-'}</td>
        <td>
          <strong>${d.discount_type === 'percentage' ? d.discount_value + '%' : d.discount_value + ' ج.م'}</strong>
          <small style="color:var(--text-muted); display:block;">${d.discount_type === 'percentage' ? 'نسبة مئوية' : 'مبلغ ثابت'}</small>
        </td>
        <td style="max-width:220px;">${scopeBadge}</td>
        <td>${d.minimum_order_amount ? Number(d.minimum_order_amount).toLocaleString("ar-EG") + ' ج.م' : 'بدون حد'}</td>
        <td><strong>${d.usage_count || 0}</strong> / ${d.usage_limit || '∞'}</td>
        <td>${d.expires_at ? new Date(d.expires_at).toLocaleDateString("ar-EG") : 'مستمر'}</td>
        <td>
          <span class="badge-status ${d.is_active ? 'badge-delivered' : 'badge-cancelled'}">
            ${d.is_active ? 'ساري ومفعل' : 'معطل'}
          </span>
        </td>
        <td>
          <div class="flex-gap">
            <button class="btn-secondary" style="padding:4px 8px;" title="تعديل الكوبون" onclick="editDiscount('${d.id}')">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-secondary" style="padding:4px 8px; color:var(--accent-red);" title="حذف" onclick="deleteDiscount('${d.id}', '${d.code}')">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// التحكم بنافذة إنشاء الكوبون
window.openDiscountModal = function(defaultProductId = null) {
  document.getElementById("discountForm").reset();
  document.getElementById("d_edit_id").value = "";
  document.getElementById("discountModalTitle").innerHTML = `<i class="fa-solid fa-ticket"></i> إنشاء كوبون خصم جديد`;
  document.getElementById("d_is_active").checked = true;

  populateDiscountProductsSelect();

  if (defaultProductId) {
    document.getElementById("scopeSpecific").checked = true;
    toggleProductSelection(true);
    document.getElementById("d_specific_product").value = defaultProductId;
  } else {
    document.getElementById("scopeAll").checked = true;
    toggleProductSelection(false);
  }

  document.getElementById("discountModal").classList.add("active");
};

window.closeDiscountModal = function() {
  document.getElementById("discountModal").classList.remove("active");
};

window.toggleProductSelection = function(isSpecific) {
  const wrapper = document.getElementById("productSelectWrapper");
  if (wrapper) wrapper.style.display = isSpecific ? "block" : "none";
};

// إنشاء خصم مباشر لمنتج معين من جدول المنتجات
window.createDiscountForProduct = function(productId) {
  const prod = allProductsCache.find(p => p.id === productId);
  openDiscountModal(productId);
  if (prod) {
    document.getElementById("d_name").value = `خصم على ${prod.name}`;
  }
};

// حفظ الكوبون في Supabase
window.handleDiscountFormSubmit = async function(e) {
  e.preventDefault();

  const editId = document.getElementById("d_edit_id").value;
  const code = document.getElementById("d_code").value.trim().toUpperCase();
  const name = document.getElementById("d_name").value.trim();
  const discount_type = document.getElementById("d_type").value;
  const discount_value = parseFloat(document.getElementById("d_value").value) || 0;
  const minimum_order_amount = parseFloat(document.getElementById("d_min_amount").value) || null;
  const maximum_discount_amount = parseFloat(document.getElementById("d_max_discount").value) || null;
  const usage_limit = parseInt(document.getElementById("d_usage_limit").value) || null;
  const starts_at = document.getElementById("d_start_date").value ? new Date(document.getElementById("d_start_date").value).toISOString() : null;
  const expires_at = document.getElementById("d_expire_date").value ? new Date(document.getElementById("d_expire_date").value).toISOString() : null;
  const is_active = document.getElementById("d_is_active").checked;

  const isSpecific = document.getElementById("scopeSpecific").checked;
  const specificProductId = document.getElementById("d_specific_product").value;

  if (isSpecific && !specificProductId) {
    return alert("يرجى اختيار المنتج المشمول بالخصم من القائمة.");
  }

  const saveBtn = document.getElementById("saveDiscountBtn");
  saveBtn.disabled = true;

  try {
    let discountId = editId;

    if (editId) {
      const { error: updErr } = await supabaseClient
        .from("discounts")
        .update({
          code, name, discount_type, discount_value,
          minimum_order_amount, maximum_discount_amount,
          usage_limit, starts_at, expires_at, is_active
        })
        .eq("id", editId);

      if (updErr) throw updErr;

      // حذف العلاقات القديمة لربطها من جديد
      await supabaseClient.from("discount_products").delete().eq("discount_id", editId);

    } else {
      const { data: newDisc, error: insErr } = await supabaseClient
        .from("discounts")
        .insert({
          code, name, discount_type, discount_value,
          minimum_order_amount, maximum_discount_amount,
          usage_limit, starts_at, expires_at, is_active
        })
        .select()
        .single();

      if (insErr) throw insErr;
      discountId = newDisc.id;
    }

    // إذا كان الكوبون لمنتج محدد، يتم إدراجه في جدول discount_products
    if (isSpecific && specificProductId) {
      await supabaseClient.from("discount_products").insert({
        discount_id: discountId,
        product_id: specificProductId
      });
    }

    alert(editId ? "تم تعديل الكوبون بنجاح!" : "تم إنشاء كوبون الخصم بنجاح!");
    closeDiscountModal();
    loadDiscounts();

  } catch (err) {
    console.error("فشل حفظ الكوبون:", err);
    alert("تعذر حفظ الكوبون: " + err.message);
  } finally {
    saveBtn.disabled = false;
  }
};

window.editDiscount = function(discountId) {
  const d = allDiscountsCache.find(item => item.id === discountId);
  if (!d) return;

  openDiscountModal();
  document.getElementById("d_edit_id").value = d.id;
  document.getElementById("discountModalTitle").innerHTML = `<i class="fa-solid fa-pen-to-square"></i> تعديل الكوبون: ${d.code}`;

  document.getElementById("d_code").value = d.code || "";
  document.getElementById("d_name").value = d.name || "";
  document.getElementById("d_type").value = d.discount_type || "percentage";
  document.getElementById("d_value").value = d.discount_value || "";
  document.getElementById("d_min_amount").value = d.minimum_order_amount || "";
  document.getElementById("d_max_discount").value = d.maximum_discount_amount || "";
  document.getElementById("d_usage_limit").value = d.usage_limit || "";
  document.getElementById("d_is_active").checked = !!d.is_active;

  if (d.starts_at) document.getElementById("d_start_date").value = d.starts_at.split("T")[0];
  if (d.expires_at) document.getElementById("d_expire_date").value = d.expires_at.split("T")[0];

  if (d.specific_product_ids && d.specific_product_ids.length > 0) {
    document.getElementById("scopeSpecific").checked = true;
    toggleProductSelection(true);
    document.getElementById("d_specific_product").value = d.specific_product_ids[0];
  } else {
    document.getElementById("scopeAll").checked = true;
    toggleProductSelection(false);
  }
};

window.deleteDiscount = async function(discountId, code) {
  const ok = confirm(`هل أنت متأكد من حذف الكوبون: "${code}"؟`);
  if (!ok) return;

  try {
    await supabaseClient.from("discount_products").delete().eq("discount_id", discountId);
    const { error } = await supabaseClient.from("discounts").delete().eq("id", discountId);
    if (error) throw error;
    alert("تم حذف الكوبون بنجاح.");
    loadDiscounts();
  } catch (err) {
    alert("تعذر حذف الكوبون: " + err.message);
  }
};

// ==================================================
// العملاء (Profiles)
// ==================================================
async function loadCustomers() {
  const tbody = document.getElementById("customersTbody");
  if (!tbody) return;

  try {
    const { data, error } = await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-cell">لا يوجد عملاء مسجلون.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(p => `
      <tr>
        <td><strong>${p.full_name || 'بدون اسم'}</strong></td>
        <td style="direction:ltr; text-align:right;">${p.phone || '-'}</td>
        <td><span class="badge-status ${p.role === 'admin' ? 'badge-confirmed' : 'badge-processing'}">${p.role === 'admin' ? 'مدير' : 'عميل'}</span></td>
        <td>${new Date(p.created_at).toLocaleDateString("ar-EG")}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error(err);
  }
}

// ==================================================
// الإحصائيات العامة
// ==================================================
function calculateKPIsAndCharts() {
  let totalSales = 0;
  let totalProfit = 0;
  let completedCount = 0;
  let pendingCount = 0;

  const statusCounts = {
    pending: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0, returned: 0
  };

  allOrdersCache.forEach(o => {
    const st = (o.status || "pending").toLowerCase();
    if (statusCounts[st] !== undefined) statusCounts[st]++;

    if (st === "pending") pendingCount++;
    if (st === "delivered" || st === "confirmed" || st === "shipped") completedCount++;

    if (st !== "cancelled" && st !== "returned") {
      totalSales += Number(o.total_amount || 0);
      totalProfit += Number(o.calculated_profit || 0);
    }
  });

  const lowStockCount = allVariantsCache.filter(v => Number(v.stock_quantity) <= 5).length;

  document.getElementById("kpiTotalSales").textContent = `${totalSales.toLocaleString("ar-EG")} ج.م`;
  document.getElementById("kpiNetProfit").textContent = `${totalProfit.toLocaleString("ar-EG")} ج.م`;
  document.getElementById("kpiTotalOrders").textContent = allOrdersCache.length.toString();
  document.getElementById("kpiCompletedOrders").textContent = `${completedCount} طلب مؤكد ومكتمل`;
  document.getElementById("kpiLowStock").textContent = lowStockCount.toString();
  document.getElementById("pendingOrdersBadge").textContent = pendingCount.toString();

  renderSalesChart(allOrdersCache);
  renderStatusChart(statusCounts);
}

function renderSalesChart(orders) {
  const ctx = document.getElementById("salesChart");
  if (!ctx) return;

  const daysMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString("ar-EG", { weekday: 'short', month: 'numeric', day: 'numeric' });
    daysMap[key] = 0;
  }

  orders.forEach(o => {
    if (o.status !== "cancelled" && o.status !== "returned") {
      const d = new Date(o.created_at);
      const key = d.toLocaleDateString("ar-EG", { weekday: 'short', month: 'numeric', day: 'numeric' });
      if (daysMap[key] !== undefined) daysMap[key] += Number(o.total_amount || 0);
    }
  });

  if (salesChartInstance) salesChartInstance.destroy();

  salesChartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: Object.keys(daysMap),
      datasets: [{
        label: "المبيعات (ج.م)",
        data: Object.values(daysMap),
        borderColor: "#f59e0b",
        backgroundColor: "rgba(245, 158, 11, 0.12)",
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: "#f59e0b"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#9ca3af", font: { family: "Cairo" } } } },
      scales: {
        x: { ticks: { color: "#9ca3af", font: { family: "Cairo" } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#9ca3af", font: { family: "Cairo" } }, grid: { color: "rgba(255,255,255,0.05)" } }
      }
    }
  });
}

function renderStatusChart(statusCounts) {
  const ctx = document.getElementById("ordersStatusChart");
  if (!ctx) return;

  if (statusChartInstance) statusChartInstance.destroy();

  statusChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["قيد الانتظار", "مؤكد", "تجهيز", "شحن", "تم التوصيل", "ملغي", "مرتجع"],
      datasets: [{
        data: [
          statusCounts.pending,
          statusCounts.confirmed,
          statusCounts.processing,
          statusCounts.shipped,
          statusCounts.delivered,
          statusCounts.cancelled,
          statusCounts.returned
        ],
        backgroundColor: ["#f59e0b", "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981", "#ef4444", "#6b7280"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: "#9ca3af", font: { family: "Cairo" } } } }
    }
  });
}

function translateStatus(st) {
  const map = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    processing: "جاري التجهيز",
    shipped: "تم الشحن",
    delivered: "تم التوصيل",
    cancelled: "ملغي",
    returned: "مرتجع"
  };
  return map[st] || st;
}

// ==================================================
// استخراج اسم المقاس للمتغير (من جدول المقاسات، أو من الـ SKU كحل احتياطي)
// ==================================================
function getVariantSizeName(v) {
  if (!v) return "";
  if (v.product_sizes && v.product_sizes.name) return v.product_sizes.name;
  // الـ SKU بيتولد بالشكل: BASE-COL-SIZE
  if (v.sku && v.sku.includes("-")) {
    const last = v.sku.split("-").pop().trim().toUpperCase();
    if (/^(XXS|XS|S|M|L|XL|XXL|XXXL|\dXL|\d{1,3})$/.test(last)) return last;
  }
  return "";
}
