
    // ═══ AUTHENTICATION & FETCH WRAPPER ═══════════
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      let [resource, config] = args;
      if (typeof resource === 'string' && resource.startsWith('http')) {
        config = config || {};
        config.headers = config.headers || {};
        const token = localStorage.getItem('token');
        if (token && !config.headers['Authorization']) {
          config.headers['Authorization'] = 'Bearer ' + token;
        }
      }
      const response = await origFetch(resource, config);
      if (response.status === 401 || response.status === 403) {
        if (resource.includes('/login')) return response;
        toast('Session expired or access denied!', 'err');
        document.getElementById('lo').style.display = 'flex';
      }
      return response;
    };

    // ═══ STATE ═══════════════════════════════════
    let currentCart = [];
    let myChart = null;
    let dashChartRef = null;
    let productCache = [];   // in-memory product store for fast lookup
    let selectedProdId = null;
    let shopSettings = { shop_name: 'POULTRY PRO SHOP', owner_name: '', address: '', phone: '', email: '', gst_number: '' };

    // ═══ ROUTER ══════════════════════════════════
    function nb(id) { return document.querySelector(`.ni[onclick*="${id}"]`); }
    function showPage(id, btn) {
      document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
      document.getElementById('page-' + id).classList.add('active');
      if (btn) btn.classList.add('active');
      window.scrollTo(0, 0);
      if (id === 'dashboard') { getReport(); loadDashChart(); checkLowStock(); }
      if (id === 'billing') { loadAllProducts(); }
      if (id === 'inventory') { loadProducts(); }
      if (id === 'customers') { loadCustomers(); }
      if (id === 'wastage') { loadWastageProducts(); }
      if (id === 'reports') { loadReportData(); loadReportChart(); loadBillsReport(); loadStockReport(); }
      if (id === 'khata') { loadKhata(); }
      if (id === 'settings') { loadSettings(); }
    }

    // ═══ TOAST ═══════════════════════════════════
    function toast(msg, type = 'ok') {
      const t = document.getElementById('toast');
      t.innerText = msg; t.style.display = 'block';
      t.style.borderLeftColor = type === 'ok' ? 'var(--ok)' : type === 'warn' ? 'var(--warn)' : 'var(--err)';
      setTimeout(() => t.style.display = 'none', 3200);
    }

    // ═══ LOGIN ═══════════════════════════════════
    document.getElementById('loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('http://localhost:5000/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: document.getElementById('username').value, Password: document.getElementById('password').value })
      })
        .then(r => r.json()).then(d => {
          if (d.success) {
            localStorage.clear();
            localStorage.setItem('token', d.token);
            localStorage.setItem('role', d.user.role);
            console.log("Logged in role:", d.user.role);
            document.getElementById('lo').style.display = 'none';
            toast(`Welcome back, ${d.user.role.toUpperCase()}!`);
            applyRoleUI();
            fetchShopSettings();
            showPage('dashboard', nb('dashboard'));
            syncReportDate(); loadDashChart(); checkLowStock();
          } else toast(d.message || 'Error', 'err');
        }).catch(() => toast('Server not responding!', 'err'));
    });

    // ═══ PRODUCTS (shared cache) ═════════════════
    function fetchProducts(cb) {
      fetch('http://localhost:5000/products')
        .then(r => r.json()).then(data => {
          productCache = data;
          if (cb) cb(data);
        }).catch(e => console.error('Product fetch failed:', e));
    }

    function stockBadge(stock, threshold) {
      const t = parseFloat(threshold) || 5;
      if (stock <= 0) return '<span class="badge badge-err">Out of Stock</span>';
      if (stock <= t) return '<span class="badge badge-warn">⚠ Low Stock</span>';
      return '<span class="badge badge-ok">In Stock</span>';
    }

    function renderTable(tbodyId, data, withActions) {
      const list = document.getElementById(tbodyId); if (!list) return;
      list.innerHTML = '';
      data.forEach(p => {
        const id = p.Product_ID || p.id || p.product_id;
        const name = p.Product_Name || p.product_name || p.name;
        const price = parseFloat(p.Price_Per_Kg || p.Price || p.price || 0);
        const stock = parseFloat(p.Stock_Quantity || p.stock_quantity || p.stock || 0);
        const thr = parseFloat(p.Low_Stock_Threshold || 5);
        const badge = stockBadge(stock, thr);
        const tCell = withActions ? `<td>${thr} kg</td>` : ''
        const aCell = withActions ? `<td>
            <button onclick="openEditModal(${id},'${name.replace(/'/g, "\\'")}',${price},${stock})" style="background:#f59e0b;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8rem">Edit</button>
            <button onclick="deleteProduct(${id})" style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:.8rem">Del</button>
        </td>`: '';
        list.innerHTML += `<tr><td>${name}</td><td>₹${price.toFixed(2)}</td><td>${stock.toFixed(2)} kg</td>${tCell}<td>${badge}</td>${aCell}</tr>`;
      });
    }

    function loadProducts() { fetchProducts(d => { renderTable('productList', d, true); showLowStockAlert(d); }); }
    function loadWastageProducts() {
      fetchProducts(d => {
        renderTable('wastageProductList', d, false);
        // Populate product name dropdown
        const sel = document.getElementById('w_pid');
        if (sel) {
          sel.innerHTML = '<option value="">Select a product...</option>' +
            d.map(p => `<option value="${p.Product_ID || p.id}">${p.Product_Name || p.name}</option>`).join('');
        }
      });
      // Load wastage history with product names
      loadWastageHistory();
    }

    function loadWastageHistory() {
      const dtEl = document.getElementById('wastageFilterDate');
      const dt = dtEl ? dtEl.value : '';
      const q = dt ? `?date=${dt}` : '';
      fetch(`http://localhost:5000/wastage${q}`)
        .then(r => r.json()).then(data => {
          const tb = document.getElementById('wastageHistoryList');
          if (!tb) return;
          if (data.length === 0) {
            const msg = dt ? `No wastage records for ${dt}` : 'No wastage logged yet.';
            tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--dim)">${msg}</td></tr>`;
            return;
          }
          tb.innerHTML = data.map(w => `<tr>
            <td>${new Date(w.Date).toLocaleDateString('en-IN')}</td>
            <td><b>${w.Product_Name || 'Deleted Product'}</b></td>
            <td>${parseFloat(w.Quantity).toFixed(2)} kg</td>
            <td style="color:var(--err)">₹${parseFloat(w.Loss_Amount || 0).toFixed(2)}</td>
          </tr>`).join('');
        }).catch(() => { });
    }
    function loadAllProducts() {
      fetchProducts(d => {
        renderTable('billingProductList', d, false);
        // Fill datalist for customer suggestions
        fillCustomerSuggestions();
      });
    }

    // ═══ LOW STOCK ALERT ═════════════════════════
    function showLowStockAlert(data) {
      const low = data.filter(p => {
        const s = parseFloat(p.Stock_Quantity);
        const t = parseFloat(p.Low_Stock_Threshold != null ? p.Low_Stock_Threshold : 5);
        return !isNaN(s) && !isNaN(t) && s <= t;
      });
      const bar = document.getElementById('invAlertBar');
      const cnt = document.getElementById('lowStockCount');
      if (low.length > 0) {
        const names = low.map(p => p.Product_Name || p.name).join(', ');
        if (bar) { bar.style.display = 'block'; bar.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <b>Low Stock Alert:</b> ${names}`; }
        if (cnt) { cnt.style.display = 'inline'; cnt.textContent = `${low.length} item(s) low`; }
      } else {
        if (bar) bar.style.display = 'none';
        if (cnt) cnt.style.display = 'none';
      }
    }

    function checkLowStock() {
      fetchProducts(data => {
        const low = data.filter(p => {
          const s = parseFloat(p.Stock_Quantity);
          const t = parseFloat(p.Low_Stock_Threshold != null ? p.Low_Stock_Threshold : 5);
          return !isNaN(s) && !isNaN(t) && s <= t;
        });
        const banner = document.getElementById('lowStockBanner');
        if (banner) {
          if (low.length > 0) {
            banner.style.display = 'block';
            banner.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <b>${low.length} product(s) running low:</b> ${low.map(p => p.Product_Name || p.name).join(', ')}`;
          } else {
            banner.style.display = 'none';
          }
        }
        // Dashboard khata stat
        fetch('http://localhost:5000/khata').then(r => r.json()).then(d => {
          const due = d.reduce((s, k) => s + parseFloat(k.Amount_Due || 0), 0);
          const el = document.getElementById('statKhata');
          if (el) el.innerText = '₹' + due.toFixed(2);
        }).catch(() => { });
      });
    }

    // ═══ ADD PRODUCT ═════════════════════════════
    document.getElementById('productForm').addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('http://localhost:5000/add-product', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: document.getElementById('pname').value, price: document.getElementById('price').value, stock: document.getElementById('stock').value, threshold: document.getElementById('threshold').value || 5 })
      })
        .then(r => r.json())
        .then(() => { toast('Product added!'); document.getElementById('productForm').reset(); document.getElementById('threshold').value = 5; loadProducts(); })
        .catch(() => toast('Error adding product', 'err'));
    });

    // ═══ DELETE / EDIT (INLINE) ═══════════════════
    function deleteProduct(id) {
      if (!confirm('Delete this product? (Linked wastage records will also be removed)')) return;
      fetch(`http://localhost:5000/delete-product/${id}`, { method: 'DELETE' })
        .then(async r => {
          let d; try { d = await r.json() } catch (e) { d = { message: await r.text(), success: r.ok } }
          if (d.success) { toast(d.message || 'Deleted!'); loadProducts(); }
          else { toast(d.message || 'Cannot delete', 'err'); }
        })
        .catch(() => toast('Could not delete', 'err'));
    }
    function openEditModal(id, name, price, stock) {
      document.getElementById('editProdId').value = id;
      document.getElementById('editProdLabel').textContent = name;
      document.getElementById('editProdPrice').value = price;
      document.getElementById('editProdStock').value = '';  // Clear — user enters amount to ADD
      // Show current stock info banner
      const stockInfo = document.getElementById('editProdCurrentStock');
      const stockVal = document.getElementById('editProdCurrentStockVal');
      if (stockInfo && stockVal) {
        stockVal.textContent = parseFloat(stock).toFixed(2);
        stockInfo.style.display = 'block';
      }
      const container = document.getElementById('inlineEditProduct');
      container.style.display = 'block';
      container.scrollIntoView({ behavior: 'smooth' });
    }
    function submitEditProduct() {
      const id = document.getElementById('editProdId').value;
      const price = parseFloat(document.getElementById('editProdPrice').value);
      const addStock = parseFloat(document.getElementById('editProdStock').value) || 0;
      if (isNaN(price)) { toast('Enter a valid price!', 'err'); return; }
      if (addStock < 0) { toast('Stock value cannot be negative!', 'err'); return; }
      const data = { Price: price, AddStock: addStock };
      fetch(`http://localhost:5000/update-product/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(r => r.json()).then(d => {
          if (d.success) {
            toast(d.message || 'Updated!');
            document.getElementById('inlineEditProduct').style.display = 'none';
            loadProducts();
          } else {
            toast(d.message || 'Update failed', 'err');
          }
        })
        .catch(() => toast('Update failed', 'err'));
    }



    // ═══ CUSTOMERS MODULE ════════════════════════
    function loadCustomers() {
      fetch('http://localhost:5000/customers').then(r => r.json()).then(data => {
        const tb = document.getElementById('customerList'); if (!tb) return;
        tb.innerHTML = '';
        document.getElementById('custTotal').innerText = data.length;
        data.forEach(c => {
          tb.innerHTML += `<tr>
            <td><b>${c.Customer_Name}</b></td>
            <td>${c.Phone || '—'}</td>
            <td>${c.Address || '—'}</td>
            <td>
              <button onclick="openEditCustomer(${c.Customer_ID},'${(c.Customer_Name || '').replace(/'/g, "\\'")}','${(c.Phone || '').replace(/'/g, "\\'")}','${(c.Address || '').replace(/'/g, "\\'")}' )" style="background:#f59e0b;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8rem">Edit</button>
              <button onclick="deleteCustomer(${c.Customer_ID})" style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:.8rem">Del</button>
            </td>
          </tr>`;
        });
      }).catch(() => { });
    }
    function addCustomer() {
      const name = document.getElementById('custName').value;
      const phone = document.getElementById('custPhone').value;
      const address = document.getElementById('custAddress').value;
      if (!name) { toast('Enter customer name', 'err'); return; }
      fetch('http://localhost:5000/add-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Name: name, Phone: phone, Address: address })
      })
        .then(r => r.json()).then(d => {
          toast(d.message || 'Customer added!');
          document.getElementById('custName').value = '';
          document.getElementById('custPhone').value = '';
          document.getElementById('custAddress').value = '';
          document.getElementById('newCustForm').style.display = 'none';
          loadCustomers();
        }).catch(() => toast('Error adding customer', 'err'));
    }
    function openEditCustomer(id, name, phone, address) {
      document.getElementById('editCustId').value = id;
      document.getElementById('editCustLabel').textContent = name;
      document.getElementById('editCustName').value = name;
      document.getElementById('editCustPhone').value = phone;
      document.getElementById('editCustAddress').value = address;
      const container = document.getElementById('inlineEditCustomer');
      container.style.display = 'block';
      container.scrollIntoView({ behavior: 'smooth' });
    }
    function submitEditCustomer() {
      const id = document.getElementById('editCustId').value;
      const data = { Name: document.getElementById('editCustName').value, Phone: document.getElementById('editCustPhone').value, Address: document.getElementById('editCustAddress').value };
      if (!data.Name) { toast('Name is required', 'err'); return; }
      fetch(`http://localhost:5000/customers/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(r => r.json()).then(d => { toast(d.message || 'Updated!'); document.getElementById('inlineEditCustomer').style.display = 'none'; loadCustomers(); })
        .catch(() => toast('Update failed', 'err'));
    }
    function deleteCustomer(id) {
      if (!confirm('Delete this customer?')) return;
      fetch(`http://localhost:5000/customers/${id}`, { method: 'DELETE' })
        .then(r => r.json()).then(d => {
          if (d.success) { toast(d.message || 'Deleted!'); loadCustomers(); }
          else toast(d.message || 'Cannot delete', 'err');
        }).catch(() => toast('Could not delete', 'err'));
    }

    // ═══ CUSTOMER SUGGESTIONS (from customers API) ═══
    function fillCustomerSuggestions() {
      fetch('http://localhost:5000/customers').then(r => r.json()).then(data => {
        const dl = document.getElementById('custSuggestions'); if (!dl) return;
        dl.innerHTML = data.map(c => `<option value="${c.Customer_Name}">`).join('');
      }).catch(() => {
        // Fallback: try khata
        fetch('http://localhost:5000/khata').then(r => r.json()).then(data => {
          const dl = document.getElementById('custSuggestions'); if (!dl) return;
          dl.innerHTML = data.map(k => `<option value="${k.Customer_Name}">`).join('');
        }).catch(() => { });
      });
    }

    // ═══ FILTER ══════════════════════════════════
    function filterProducts() {
      const f = document.getElementById('prodSearch').value.toLowerCase();
      document.querySelectorAll('#productList tr').forEach(r => { r.style.display = r.cells[1]?.textContent.toLowerCase().includes(f) ? '' : 'none'; });
    }

    function filterBillingProducts() {
      const f = document.getElementById('billingProdSearch').value.toLowerCase();
      let count = 0;
      document.querySelectorAll('#billingProductList tr').forEach(r => {
        if (r.id === 'noProductsRow') return;
        const txt = r.cells[1]?.textContent.toLowerCase() || '';
        if (txt.includes(f)) { r.style.display = ''; count++; }
        else { r.style.display = 'none'; }
      });
      const tbody = document.getElementById('billingProductList');
      let noRow = document.getElementById('noProductsRow');
      if (count === 0 && tbody.children.length > 0) {
        if (!noRow) {
          tbody.insertAdjacentHTML('beforeend', `<tr id="noProductsRow"><td colspan="5" style="text-align:center;color:var(--dim)">No products found matching "${f}"</td></tr>`);
        } else {
          noRow.style.display = '';
          noRow.innerHTML = `<td colspan="5" style="text-align:center;color:var(--dim)">No products found matching "${f}"</td>`;
        }
      } else if (noRow) noRow.style.display = 'none';
    }

    function filterCustomers() {
      const f = document.getElementById('custSearch').value.toLowerCase();
      document.querySelectorAll('#customerList tr').forEach(r => {
        const txt = (r.cells[1]?.textContent + ' ' + r.cells[2]?.textContent).toLowerCase();
        r.style.display = txt.includes(f) ? '' : 'none';
      });
    }

    // ═══ BILLING — PRODUCT SEARCH WITH AUTO-PRICE ═
    function filterBillingSearch() {
      const val = document.getElementById('prodName').value.toLowerCase().trim();
      const box = document.getElementById('prodSuggestBox');
      selectedProdId = null;
      document.getElementById('autoPrice').value = '';
      if (!val || val.length < 1) { box.innerHTML = ''; return; }
      const matches = productCache.filter(p => (p.Product_Name || p.name || '').toLowerCase().includes(val));
      if (matches.length === 0) { box.innerHTML = ''; return; }
      box.innerHTML = `<div style="position:absolute;top:2px;left:0;right:0;background:var(--card);border:1px solid var(--g);border-radius:8px;z-index:500;max-height:180px;overflow-y:auto">
        ${matches.map(p => `<div onclick="selectProduct(${p.Product_ID || p.id},'${(p.Product_Name || p.name).replace(/'/g, "\\'")}',${p.Price_Per_Kg || p.Price || p.price || 0})"
            style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--g);font-size:.88rem;transition:.2s"
            onmouseover="this.style.background='var(--g)'" onmouseout="this.style.background=''"
        ><b>${p.Product_Name || p.name}</b> <span style="color:var(--dim);font-size:.8rem">— ₹${parseFloat(p.Price_Per_Kg || p.Price || p.price || 0).toFixed(2)}/kg — ${parseFloat(p.Stock_Quantity || 0).toFixed(1)}kg left</span></div>`).join('')}
    </div>`;
    }

    function selectProduct(id, name, price) {
      selectedProdId = id;
      document.getElementById('prodName').value = name;
      document.getElementById('autoPrice').value = '₹' + parseFloat(price).toFixed(2);
      document.getElementById('prodSuggestBox').innerHTML = '';
      document.getElementById('qty').focus();
    }

    // ═══ CART ════════════════════════════════════
    document.getElementById('orderForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const qty = parseFloat(document.getElementById('qty').value);
      if (!selectedProdId) { toast('Select a product from the list!', 'err'); return; }
      if (isNaN(qty) || qty <= 0) { toast('Enter valid quantity', 'err'); return; }
      const p = productCache.find(x => (x.Product_ID || x.id) == selectedProdId);
      if (!p) { toast('Product not found', 'err'); return; }
      const price = parseFloat(p.Price_Per_Kg || p.Price || p.price || 0);
      const name = p.Product_Name || p.name;
      currentCart.push({ id: selectedProdId, name, price, qty, total: price * qty });
      updateCartUI();
      document.getElementById('prodName').value = '';
      document.getElementById('autoPrice').value = '';
      document.getElementById('qty').value = '';
      selectedProdId = null;
      toast(`${name} added to cart`);
    });

    function updateCartUI() {
      const tbody = document.getElementById('cartTableBody');
      let grand = 0; tbody.innerHTML = '';
      currentCart.forEach((item, i) => {
        grand += item.total;
        tbody.innerHTML += `<tr><td>${item.name}</td><td>${item.qty}kg</td><td>₹${item.total.toFixed(2)}</td>
        <td><i class="fas fa-trash" style="color:var(--err);cursor:pointer" onclick="removeFromCart(${i})"></i></td></tr>`;
      });
      document.getElementById('cartGrandTotal').innerText = `Total: ₹${grand.toFixed(2)}`;
      document.getElementById('cartPreview').style.display = currentCart.length > 0 ? 'block' : 'none';
    }
    function removeFromCart(i) { currentCart.splice(i, 1); updateCartUI(); }

    // ═══ PRINT / GENERATE BILL ═══════════════════
    async function printFinalBill() {
      if (currentCart.length === 0) { toast('Cart is empty!', 'err'); return; }
      const custName = document.getElementById('billCustName').value || 'Walk-in Customer';
      const payType = document.getElementById('paymentType').value;
      const total = currentCart.reduce((s, i) => s + i.total, 0);

      // Check khata credit limit before allowing
      let khataId = null;
      if (payType === 'khata') {
        const allK = await fetch('http://localhost:5000/khata').then(r => r.json()).catch(() => []);
        const existing = allK.find(k => k.Customer_Name.toLowerCase() === custName.toLowerCase());
        if (existing) {
          khataId = existing.Khata_ID;
          const newDue = parseFloat(existing.Amount_Due) + total;
          if (newDue > parseFloat(existing.Credit_Limit)) {
            const over = (newDue - parseFloat(existing.Credit_Limit)).toFixed(2);
            if (!confirm(`⚠ This will exceed ${custName}'s credit limit by ₹${over}.\nLimit: ₹${existing.Credit_Limit} | Current Due: ₹${existing.Amount_Due}\nContinue anyway?`)) return;
          }
        }
      }

      try {
        const res = await fetch('http://127.0.0.1:5000/generate-bill-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ CustomerName: custName, Items: currentCart, TotalAmount: total, PaymentType: payType, KhataID: khataId })
        });
        if (res.ok) {
          const data = await res.json();
          const billId = data.billId; // Use the real Bill_ID from the database
          generateReceipt(custName, [...currentCart], payType, billId);
        }
        else toast('Server Error: ' + await res.text(), 'err');
      } catch { toast('Server not responding!', 'err'); }
    }

    // ═══ RECEIPT ═════════════════════════════════
    function generateReceipt(customer, cartItems, payType, billNo) {
      if (!Array.isArray(cartItems)) return;
      const grand = cartItems.reduce((s, i) => s + i.total, 0);
      const date = new Date();
      const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

      const rows = cartItems.map((item, idx) => `
        <tr style="background:${idx % 2 === 0 ? '#f8fafc' : '#ffffff'}">
          <td style="padding:10px 12px;text-align:left;border-bottom:1px solid #e2e8f0">
            <div style="font-weight:600;color:#1e293b;font-size:13px">${item.name}</div>
            <div style="font-size:11px;color:#64748b;margin-top:2px">${item.qty} kg × ₹${item.price.toFixed(2)}</div>
          </td>
          <td style="padding:10px 12px;text-align:right;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1e293b;font-size:13px">₹${item.total.toFixed(2)}</td>
        </tr>
      `).join('');

      const payBadge = payType === 'khata'
        ? `<div style="margin:14px 24px;padding:10px 16px;background:linear-gradient(135deg,#fef9c3,#fef3c7);border:1px solid #fde68a;border-radius:8px;text-align:center;font-size:12px;color:#92400e;font-weight:600">
             📒 KHATA — Pay Later
           </div>`
        : `<div style="margin:14px 24px;padding:10px 16px;background:linear-gradient(135deg,#dcfce7,#d1fae5);border:1px solid #86efac;border-radius:8px;text-align:center;font-size:12px;color:#166534;font-weight:600">
             ✅ PAID — Cash / Card
           </div>`;

      document.getElementById('receiptContent').innerHTML = `
      <div style="font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#1e293b;overflow:hidden;border-radius:14px">
        <!-- HEADER -->
        <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:24px 24px 20px;text-align:center;color:white">
          <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;opacity:.7;margin-bottom:6px">Tax Invoice</div>
          <h2 style="margin:0;font-size:22px;font-weight:700;letter-spacing:1.5px">${shopSettings.shop_name}</h2>
          ${shopSettings.address ? `<p style="margin:4px 0 0;font-size:11.5px;opacity:.8">${shopSettings.address}</p>` : ''}
          ${shopSettings.phone ? `<p style="margin:3px 0 0;font-size:12px;opacity:.9;font-weight:600">📞 ${shopSettings.phone}</p>` : ''}
          ${shopSettings.gst_number ? `<p style="margin:3px 0 0;font-size:10.5px;opacity:.7">GST: ${shopSettings.gst_number}</p>` : ''}
        </div>

        <!-- BILL INFO -->
        <div style="display:flex;justify-content:space-between;padding:14px 24px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;font-size:12px">
          <div>
            <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:1px">Bill No</div>
            <div style="font-weight:700;color:#0f172a;font-size:14px">#${billNo}</div>
          </div>
          <div style="text-align:center">
            <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:1px">Date</div>
            <div style="font-weight:600;color:#0f172a">${dateStr}</div>
          </div>
          <div style="text-align:right">
            <div style="color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:1px">Time</div>
            <div style="font-weight:600;color:#0f172a">${timeStr}</div>
          </div>
        </div>

        <!-- CUSTOMER -->
        <div style="padding:12px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#2563eb);display:flex;align-items:center;justify-content:center;font-size:14px;color:white;font-weight:700">${customer.charAt(0).toUpperCase()}</div>
          <div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Customer</div>
            <div style="font-weight:600;font-size:14px;color:#0f172a">${customer}</div>
          </div>
        </div>

        ${payBadge}

        <!-- ITEMS TABLE -->
        <div style="padding:0 24px">
          <table style="width:100%;border-collapse:collapse;margin-top:4px">
            <thead>
              <tr style="background:#0f172a">
                <th style="padding:10px 12px;text-align:left;color:white;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-radius:6px 0 0 0">Item</th>
                <th style="padding:10px 12px;text-align:right;color:white;font-size:11px;text-transform:uppercase;letter-spacing:1px;border-radius:0 6px 0 0">Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>

        <!-- SUMMARY -->
        <div style="margin:16px 24px;border-radius:10px;overflow:hidden;border:2px solid #0f172a">
          <div style="display:flex;justify-content:space-between;padding:10px 16px;font-size:13px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
            <span style="color:#64748b">Subtotal (${cartItems.length} item${cartItems.length > 1 ? 's' : ''})</span>
            <span style="font-weight:600">₹${grand.toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:14px 16px;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:white">
            <span style="font-size:15px;font-weight:700;letter-spacing:.5px">GRAND TOTAL</span>
            <span style="font-size:18px;font-weight:800">₹${grand.toFixed(2)}</span>
          </div>
        </div>

        <!-- FOOTER -->
        <div style="text-align:center;padding:16px 24px 22px;border-top:1px dashed #cbd5e1;margin-top:8px">
          <p style="margin:0;font-weight:700;font-size:13px;color:#0f172a">Thank You! Visit Again 🙏</p>
          <p style="margin:5px 0 0;font-size:10px;color:#94a3b8">System generated invoice • No signature required</p>
          <button onclick="window.print()" class="no-print" 
            style="margin-top:16px;padding:10px 28px;cursor:pointer;background:linear-gradient(135deg,#3b82f6,#2563eb);color:white;border:none;border-radius:8px;font-weight:700;font-size:13px;letter-spacing:.5px;box-shadow:0 4px 12px rgba(37,99,235,.3);transition:transform .15s"
            onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'"
          >🖨️ Print Invoice</button>
        </div>
      </div>`;
      document.getElementById('receiptModal').style.display = 'flex';
    }

    function closeAndReset() {
      document.getElementById('receiptModal').style.display = 'none';
      currentCart = []; updateCartUI();
      const c = document.getElementById('billCustName'); if (c) c.value = '';
      document.getElementById('paymentType').value = 'cash';
      syncReportDate(); loadAllProducts();
    }

    // ═══ CUSTOMER SUGGESTIONS (in billing) ══════════
    // (already defined above as fillCustomerSuggestions)

    // ═══ WASTAGE ═════════════════════════════════
    async function autoPredictWastage() {
        const prodId = document.getElementById('w_pid').value;
        if (!prodId) { 
            document.getElementById('aiPredictionResult').style.display = 'none';
            return; 
        }

        const prodSel = document.getElementById('w_pid');
        const prodName = prodSel.options[prodSel.selectedIndex].text;
        const token = localStorage.getItem('token');

        try {
            const res = await fetch(`http://localhost:5000/wastage/predict-auto?product_id=${prodId}&product_name=${encodeURIComponent(prodName)}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (data.success) {
                document.getElementById('w_processed_qty').value = data.processed_quantity;
                document.getElementById('w_predicted_qty').value = data.predicted_wastage;
                
                const pInfo = productCache.find(px => (px.Product_ID || px.id) == prodId);
                const price = pInfo ? parseFloat(pInfo.Price_Per_Kg || pInfo.Price || pInfo.price || 0) : 0;
                document.getElementById('w_predicted_cost').value = (data.predicted_wastage * price).toFixed(2);
                
                document.getElementById('aiPredictionResult').style.display = 'block';
                toast('Auto-prediction fetched based on sales!');
            } else {
                toast(data.message, 'err');
            }
        } catch(e) { toast('Failed to fetch automated prediction', 'err'); }
    }

    function savePredictedWastage() {
        const pid = document.getElementById('w_pid').value;
        const qty = parseFloat(document.getElementById('w_predicted_qty').value);
        const cost = parseFloat(document.getElementById('w_predicted_cost').value);

        fetch('http://localhost:5000/add-wastage', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ ProductID: pid, Quantity: qty, Cost: cost, Source: 'AI_RULE_BASED' })
        })
        .then(res => res.json())
        .then(data => {
            if (data.success) { 
                toast('Wastage logged with AI source!'); 
                document.getElementById('wasteForm').reset(); 
                document.getElementById('aiPredictionResult').style.display = 'none';
                loadWastageProducts(); 
                syncReportDate(); 
            } else toast('Error logging wastage', 'err');
        }).catch(() => toast('Server not responding!', 'err'));
    }

    // ═══ REPORTS ═════════════════════════════════

    function changeReportType() {
      const type = document.getElementById('reportType').value;
      document.getElementById('reportDateDaily').style.display = type === 'daily' ? 'block' : 'none';
      document.getElementById('reportDateWeekly').style.display = type === 'weekly' ? 'block' : 'none';
      document.getElementById('reportDateMonthly').style.display = type === 'monthly' ? 'block' : 'none';
      syncReportDate();
    }

    function syncReportDate() {
      const type = document.getElementById('reportType') ? document.getElementById('reportType').value : 'daily';
      
      let startDateStr = '';
      let endDateStr = '';
      let displayLbl = '';

      if (type === 'daily') {
        const dtEl = document.getElementById('reportDateDaily') || document.getElementById('masterReportDate');
        if (dtEl && !dtEl.value) {
          const tzOffset = (new Date()).getTimezoneOffset() * 60000;
          dtEl.value = (new Date(Date.now() - tzOffset)).toISOString().split('T')[0];
        }
        startDateStr = dtEl ? dtEl.value : '';
        endDateStr = startDateStr;
        displayLbl = startDateStr;
      } else if (type === 'weekly') {
        const wkEl = document.getElementById('reportDateWeekly');
        if (wkEl && !wkEl.value) {
           const now = new Date();
           const getISOWeek = (d) => {
               const date = new Date(d.getTime());
               date.setHours(0, 0, 0, 0);
               date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
               const week1 = new Date(date.getFullYear(), 0, 4);
               return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
           };
           const wString = `${now.getFullYear()}-W${getISOWeek(now).toString().padStart(2, '0')}`;
           wkEl.value = wString;
        }
        if (wkEl && wkEl.value) {
           const [year, week] = wkEl.value.split('-W');
           const simpleDate = new Date(year, 0, 1 + (week - 1) * 7);
           const dayOfWeek = simpleDate.getDay();
           const ISOweekStart = simpleDate;
           if (dayOfWeek <= 4) ISOweekStart.setDate(simpleDate.getDate() - simpleDate.getDay() + 1);
           else ISOweekStart.setDate(simpleDate.getDate() + 8 - simpleDate.getDay());
           const ISOweekEnd = new Date(ISOweekStart);
           ISOweekEnd.setDate(ISOweekStart.getDate() + 6);
           
           startDateStr = ISOweekStart.toISOString().split('T')[0];
           endDateStr = ISOweekEnd.toISOString().split('T')[0];
           displayLbl = `Week ${week}, ${year}`;
        }
      } else if (type === 'monthly') {
        const mnEl = document.getElementById('reportDateMonthly');
        if (mnEl && !mnEl.value) {
           const tzOffset = (new Date()).getTimezoneOffset() * 60000;
           mnEl.value = (new Date(Date.now() - tzOffset)).toISOString().substring(0,7);
        }
        if (mnEl && mnEl.value) {
           const [year, month] = mnEl.value.split('-');
           const startDate = new Date(year, month - 1, 1);
           const endDate = new Date(year, month, 0); // Last day of month
           
           const pad = n => n<10 ? '0'+n : n;
           startDateStr = `${year}-${month}-01`;
           endDateStr = `${year}-${month}-${pad(endDate.getDate())}`;
           displayLbl = `${startDate.toLocaleString('en-IN', { month: 'short' })} ${year}`;
        }
      }

      const lbl = document.getElementById('lblTransDate');
      if (lbl) lbl.textContent = displayLbl || startDateStr;

      let q = '';
      if (startDateStr && endDateStr && type !== 'daily') {
          q = `?startDate=${startDateStr}&endDate=${endDateStr}`;
      } else if (startDateStr) {
          q = `?date=${startDateStr}`;
      }

      // Update Stats
      fetch(`http://localhost:5000/sales-report${q}`).then(r => r.json()).then(d => {
        const s = parseFloat(d.Totalsales) || 0, w = parseFloat(d.TotalWaste) || 0, p = parseFloat(d.Profit) || 0;
        // Dashboard
        const stS = document.getElementById('statSales'); if (stS) stS.innerText = '₹' + s.toFixed(2);
        const stW = document.getElementById('statWaste'); if (stW) stW.innerText = '₹' + w.toFixed(2);
        const stP = document.getElementById('statProfit'); if (stP) { stP.innerText = '₹' + p.toFixed(2); stP.style.color = p >= 0 ? 'var(--ok)' : 'var(--err)'; }

        // Report Page
        const rpS = document.getElementById('rptSales'); if (rpS) rpS.innerText = '₹' + s.toFixed(2);
        const rpW = document.getElementById('rptWaste'); if (rpW) rpW.innerText = '₹' + w.toFixed(2);
        const rpP = document.getElementById('rptProfit'); if (rpP) { rpP.innerText = '₹' + p.toFixed(2); rpP.style.color = p >= 0 ? 'var(--ok)' : 'var(--err)'; }
      }).catch(() => { });

      // Update Table
      fetch(`http://localhost:5000/bills-report${q}`).then(r => r.json()).then(data => {
        const tb = document.getElementById('dailyReportTable');
        if (!tb) return;
        tb.innerHTML = '';
        let total = 0;
        if (data.length === 0) {
          tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--dim)">No transactions found for ${displayLbl || startDateStr}</td></tr>`;
        } else {
          data.forEach(b => {
            total += parseFloat(b.Total_Amount || 0);
            const tm = new Date(b.Date || b.date).toLocaleTimeString('en-IN');
            tb.innerHTML += `<tr>
                        <td>#${b.Bill_ID || b.id || '—'}</td>
                        <td>${b.Customer_Name || '—'}</td>
                        <td style="color:var(--ok)">₹${parseFloat(b.Total_Amount || 0).toFixed(2)}</td>
                        <td>${tm}</td>
                    </tr>`;
          });
        }
        const tbT = document.getElementById('dailyTotalAmt');
        if (tbT) tbT.innerText = total.toFixed(2);
      }).catch(() => { });
    }

    function openDownloadModal() {
        document.getElementById('downloadModal').classList.add('open');
    }
    
    function triggerDownload(format) {
      document.getElementById('downloadModal').classList.remove('open');
      const type = document.getElementById('reportType') ? document.getElementById('reportType').value : 'daily';
      let startDateStr = ''; let endDateStr = '';

      if (type === 'daily') {
        const dtEl = document.getElementById('reportDateDaily');
        startDateStr = dtEl ? dtEl.value : '';
        endDateStr = startDateStr;
      } else if (type === 'weekly') {
        const wkEl = document.getElementById('reportDateWeekly');
        if (wkEl && wkEl.value) {
           const [year, week] = wkEl.value.split('-W');
           const simpleDate = new Date(year, 0, 1 + (week - 1) * 7);
           const dayOfWeek = simpleDate.getDay();
           const ISOweekStart = simpleDate;
           if (dayOfWeek <= 4) ISOweekStart.setDate(simpleDate.getDate() - simpleDate.getDay() + 1);
           else ISOweekStart.setDate(simpleDate.getDate() + 8 - simpleDate.getDay());
           const ISOweekEnd = new Date(ISOweekStart);
           ISOweekEnd.setDate(ISOweekStart.getDate() + 6);
           startDateStr = ISOweekStart.toISOString().split('T')[0];
           endDateStr = ISOweekEnd.toISOString().split('T')[0];
        }
      } else if (type === 'monthly') {
        const mnEl = document.getElementById('reportDateMonthly');
        if (mnEl && mnEl.value) {
           const [year, month] = mnEl.value.split('-');
           const lastDay = new Date(year, month, 0).getDate();
           const pad = n => n<10 ? '0'+n : n;
           startDateStr = `${year}-${month}-01`;
           endDateStr = `${year}-${month}-${pad(lastDay)}`;
        }
      }

      if (!startDateStr) { toast('Please select a valid period first', 'warn'); return; }
      const tb = document.getElementById('dailyReportTable');
      if (tb && tb.innerHTML.includes('No transactions found')) { toast('No data available for selected period', 'warn'); return; }

      let q = `?type=${type}&format=${format}`;
      if (startDateStr && endDateStr && type !== 'daily') {
          q += `&startDate=${startDateStr}&endDate=${endDateStr}`;
      } else if (startDateStr) {
          q += `&date=${startDateStr}`;
      }
      const token = localStorage.getItem('token');
      if (!token) { toast('Please login again', 'err'); return; }

      fetch(`http://localhost:5000/reports/download${q}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(async res => {
          if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              throw new Error(errData.message || 'Error downloading file');
          }
          
          let extension = format === 'excel' ? 'xlsx' : format;
          let filename = `sales_report_${type}_${startDateStr}.${extension}`;
          if (startDateStr && endDateStr && type !== 'daily') {
              filename = `sales_report_${type}_${startDateStr}_to_${endDateStr}.${extension}`;
          }

          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.style.display = "none";
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
      })
      .catch(err => { toast(err.message || 'Download failed', 'err'); });
    }

    function previewReport() {
        document.getElementById('downloadModal').classList.remove('open');
        toast('Preview mode ready. Scroll to view details or print the page.');
    }

    // backwards compatibility for any leftover html bindings
    function getReport() { syncReportDate() }
    function loadReportData() { syncReportDate() }

    function renderChart(canvasId, data, isMain) {
      const labels = data.map(i => new Date(i.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
      const values = data.map(i => parseFloat(i.totalSales) || 0);
      const canvas = document.getElementById(canvasId); if (!canvas) return;
      if (isMain && myChart) { myChart.destroy(); myChart = null; }
      if (!isMain && dashChartRef) { dashChartRef.destroy(); dashChartRef = null; }
      const chart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [{ label: 'Revenue (₹)', data: values, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.1)', fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#38bdf8' }] },
        options: {
          responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.05)' }, ticks: { color: '#94a3b8' } }, x: { grid: { display: false }, ticks: { color: '#94a3b8' } } }
        }
      });
      if (isMain) myChart = chart; else dashChartRef = chart;
    }
    function loadReportChart() { fetch('http://localhost:5000/sales-report-date').then(r => r.json()).then(d => { if (d?.length) renderChart('salesChart', d, true); }).catch(console.error); }
    function loadDashChart() { fetch('http://localhost:5000/sales-report-date').then(r => r.json()).then(d => { if (d?.length) renderChart('dashChart', d, false); }).catch(console.error); }

    // ═══ KHATA ═══════════════════════════════════
    function loadKhata() {
      fetch('http://localhost:5000/khata').then(r => r.json()).then(async data => {
        const tb = document.getElementById('khataList'); if (!tb) return;
        tb.innerHTML = '';
        let totalDue = 0, overCount = 0;
        // Fetch transaction summaries for each account
        for (const k of data) {
          const due = parseFloat(k.Amount_Due || 0);
          const limit = parseFloat(k.Credit_Limit || 5000);
          totalDue += due;
          const pct = Math.min((due / limit) * 100, 100);
          const color = pct >= 100 ? 'var(--err)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)';
          if (due > limit) overCount++;
          // Fetch total billed and paid for this account
          let totalBilled = 0, totalPaid = 0;
          try {
            const detail = await fetch(`http://localhost:5000/khata/${k.Khata_ID}`).then(r => r.json());
            const txns = detail.transactions || [];
            txns.forEach(t => {
              totalBilled += parseFloat(t.Bill_Amount || 0);
              totalPaid += parseFloat(t.Payment_Amount || 0);
            });
          } catch (e) { }
          const deleteBtn = `<button onclick="deleteKhata(${k.Khata_ID})" style="background:#ef4444;color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:.8rem">Del</button>`;
          const availableBal = limit - due;
          tb.innerHTML += `<tr>
                <td><b>${k.Customer_Name}</b></td>
                <td>${k.Phone || '—'}</td>
                <td>₹${limit.toFixed(0)}</td>
                <td style="color:${due > 0 ? 'var(--err)' : 'var(--ok)'};"><b>₹${due.toFixed(2)}</b></td>
                <td><b style="color:${availableBal < 0 ? 'var(--err)' : 'var(--ok)'}">₹${availableBal.toFixed(2)}</b><br><small style="color:var(--dim)">Billed: ₹${totalBilled.toFixed(2)} | Paid: ₹${totalPaid.toFixed(2)}</small></td>
                <td style="width:120px">
                    <div class="meter"><div class="meter-fill" style="width:${pct}%;background:${color}"></div></div>
                    <small style="color:var(--dim);font-size:.72rem">${pct.toFixed(0)}% used</small>
                </td>
                <td>
                    <button onclick="openKhataDetail(${k.Khata_ID})" style="background:var(--accent);color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:.8rem">View</button>
                    <button onclick="openInlinePayment(${k.Khata_ID},'${k.Customer_Name.replace(/'/g, "\\'")}')" style="background:var(--ok);color:white;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;margin-left:4px;font-size:.8rem">Pay</button>
                    ${deleteBtn}
                </td>
            </tr>`;
        }
        document.getElementById('kTotal').innerText = data.length;
        document.getElementById('kDue').innerText = '₹' + totalDue.toFixed(2);
        document.getElementById('kOver').innerText = overCount;
      }).catch(() => { });
    }

    function addKhataAccount() {
      const name = document.getElementById('kName').value;
      const phone = document.getElementById('kPhone').value;
      const limit = document.getElementById('kLimit').value || 5000;
      if (!name) { toast('Enter customer name', 'err'); return; }
      fetch('http://localhost:5000/khata', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ CustomerName: name, Phone: phone, CreditLimit: limit })
      })
        .then(r => r.json()).then(() => {
          toast('Khata account created!');
          document.getElementById('kName').value = '';
          document.getElementById('kPhone').value = '';
          document.getElementById('kLimit').value = 5000;
          document.getElementById('newKhataForm').style.display = 'none';
          loadKhata();
        }).catch(() => toast('Error creating account', 'err'));
    }

    // Inline payment (replaces prompt)
    function openInlinePayment(id, name) {
      document.getElementById('payKhataId').value = id;
      document.getElementById('payKhataLabel').textContent = name;
      document.getElementById('payKhataAmt').value = '';
      document.getElementById('payKhataNote').value = '';
      const container = document.getElementById('inlinePayKhata');
      container.style.display = 'block';
      container.scrollIntoView({ behavior: 'smooth' });
    }
    function submitInlinePayment() {
      const id = document.getElementById('payKhataId').value;
      const amt = parseFloat(document.getElementById('payKhataAmt').value);
      const note = document.getElementById('payKhataNote').value || 'Payment received';
      if (!id || isNaN(amt) || amt <= 0) { toast('Enter a valid payment amount', 'err'); return; }
      fetch(`http://localhost:5000/khata/${id}/pay`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Amount: amt, Note: note })
      })
        .then(r => r.json()).then(() => {
          toast(`₹${amt.toFixed(2)} payment recorded!`);
          document.getElementById('inlinePayKhata').style.display = 'none';
          loadKhata();
          getReport();
        }).catch(() => toast('Error recording payment', 'err'));
    }
    function deleteKhata(id) {
      if (!confirm('Delete this Khata account? (Only allowed if dues are cleared)')) return;
      fetch(`http://localhost:5000/khata/${id}`, { method: 'DELETE' })
        .then(r => r.json()).then(d => {
          if (d.success) { toast(d.message || 'Deleted!'); loadKhata(); }
          else toast(d.message || 'Cannot delete', 'err');
        }).catch(() => toast('Could not delete', 'err'));
    }
    // Keep recordPayment for the modal view button (redirects to inline)
    function recordPayment(id, name) {
      document.getElementById('khataModal').classList.remove('open');
      openInlinePayment(id, name);
    }

    function openKhataDetail(id) {
      fetch(`http://localhost:5000/khata/${id}`).then(r => r.json()).then(d => {
        const k = d.account;
        const txns = d.transactions || [];
        const due = parseFloat(k.Amount_Due || 0);
        const limit = parseFloat(k.Credit_Limit || 5000);
        const pct = Math.min((due / limit) * 100, 100).toFixed(0);
        const txnRows = txns.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--dim)">No transactions yet</td></tr>' :
          txns.map(t => {
            const isPayment = parseFloat(t.Payment_Amount || 0) > 0;
            return `<tr>
                    <td>${new Date(t.Txn_Date).toLocaleDateString('en-IN')}</td>
                    <td>${t.Note || '—'}</td>
                    <td style="color:var(--err)">${parseFloat(t.Bill_Amount || 0) > 0 ? '₹' + parseFloat(t.Bill_Amount).toFixed(2) : '—'}</td>
                    <td style="color:var(--ok)">${isPayment ? '₹' + parseFloat(t.Payment_Amount).toFixed(2) : '—'}</td>
                </tr>`;
          }).join('');

        document.getElementById('khataModalContent').innerHTML = `
            <div style="margin-bottom:16px">
                <h3 style="color:var(--accent);margin-bottom:4px">${k.Customer_Name}</h3>
                <p style="color:var(--dim);font-size:.88rem">📞 ${k.Phone || '—'}</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
                <div style="background:var(--bg);padding:14px;border-radius:10px;border:1px solid var(--g)">
                    <div style="font-size:.78rem;color:var(--dim)">AMOUNT DUE</div>
                    <div style="font-size:1.6rem;font-weight:600;color:${due > 0 ? 'var(--err)' : 'var(--ok)'}">₹${due.toFixed(2)}</div>
                </div>
                <div style="background:var(--bg);padding:14px;border-radius:10px;border:1px solid var(--g)">
                    <div style="font-size:.78rem;color:var(--dim)">CREDIT LIMIT</div>
                    <div style="font-size:1.6rem;font-weight:600;color:var(--accent)">₹${limit.toFixed(0)}</div>
                </div>
            </div>
            <div style="margin-bottom:16px">
                <div style="display:flex;justify-content:space-between;font-size:.8rem;color:var(--dim);margin-bottom:5px"><span>Credit Usage</span><span>${pct}%</span></div>
                <div class="meter"><div class="meter-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--err)' : pct >= 70 ? 'var(--warn)' : 'var(--ok)'}"></div></div>
            </div>
            <div style="display:flex;gap:10px;margin-bottom:20px">
                <button onclick="recordPayment(${k.Khata_ID},'${k.Customer_Name}');document.getElementById('khataModal').classList.remove('open')" style="flex:1;background:var(--ok)">💰 Record Payment</button>
            </div>
            <h4 style="margin-bottom:10px;color:var(--txt)">Transaction History</h4>
            <table style="font-size:.83rem"><thead><tr><th>Date</th><th>Note</th><th style="color:var(--err)">Billed</th><th style="color:var(--ok)">Paid</th></tr></thead><tbody>${txnRows}</tbody></table>
        `;
        document.getElementById('khataModal').classList.add('open');
      }).catch(() => toast('Error loading khata', 'err'));
    }

    // ═══ SHOP SETTINGS ═══════════════════════════
    function fetchShopSettings() {
      fetch('http://localhost:5000/settings')
        .then(r => r.json()).then(d => {
          shopSettings = d;
        }).catch(() => { });
    }

    function loadSettings() {
      fetch('http://localhost:5000/settings')
        .then(r => r.json()).then(d => {
          shopSettings = d;
          document.getElementById('set_shop_name').value = d.shop_name || '';
          document.getElementById('set_owner_name').value = d.owner_name || '';
          document.getElementById('set_address').value = d.address || '';
          document.getElementById('set_phone').value = d.phone || '';
          document.getElementById('set_email').value = d.email || '';
          document.getElementById('set_gst').value = d.gst_number || '';
          updateSettingsPreview();
        }).catch(() => toast('Could not load settings', 'err'));
    }

    function updateSettingsPreview() {
      const n = document.getElementById('set_shop_name').value || 'SHOP NAME';
      const a = document.getElementById('set_address').value;
      const p = document.getElementById('set_phone').value;
      const g = document.getElementById('set_gst').value;
      document.getElementById('prevShopName').textContent = n.toUpperCase();
      document.getElementById('prevAddress').textContent = a || '';
      document.getElementById('prevPhone').textContent = p ? '📞 ' + p : '';
      document.getElementById('prevGST').textContent = g ? 'GST: ' + g : '';
    }

    function saveSettings() {
      const data = {
        shop_name: document.getElementById('set_shop_name').value,
        owner_name: document.getElementById('set_owner_name').value,
        address: document.getElementById('set_address').value,
        phone: document.getElementById('set_phone').value,
        email: document.getElementById('set_email').value,
        gst_number: document.getElementById('set_gst').value
      };
      if (!data.shop_name || !data.phone) { toast('Shop Name and Phone are required!', 'err'); return; }
      fetch('http://localhost:5000/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(r => r.json()).then(d => {
          if (d.success) {
            toast(d.message || 'Settings saved!');
            shopSettings = data;
            updateSettingsPreview();
          } else toast(d.message || 'Error saving', 'err');
        }).catch(() => toast('Server not responding!', 'err'));
    }

    // ═══ INIT ════════════════════════════════════
    function applyRoleUI() {
      const role = localStorage.getItem('role') || 'staff';
      const isAdmin = role === 'admin';
      document.body.classList.toggle('role-staff', !isAdmin);
      document.querySelectorAll('.user-role-display').forEach(el => el.textContent = isAdmin ? 'Admin User' : 'Staff Member');
    }

    function logout() {
      localStorage.clear();
      window.location.reload();
    }

    if (localStorage.getItem('token')) {
      document.getElementById('lo').style.display = 'none';
      applyRoleUI();
      fetchShopSettings();
      getReport();
    }
  