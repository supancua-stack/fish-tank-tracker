/* Guppy Farm Tracker — Supabase Cloud Sync
 * One JSONB document per authenticated user in public.farm_data.
 * Uses only the project's publishable key. Never put a secret/service-role key here.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://uwcyompsxonpxjrgxryy.supabase.co';
  var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JlfwXglTkp3UFZ_JmuMKqQ_JdNmgssp';
  var SITE_URL = 'https://supancua-stack.github.io/fish-tank-tracker/';

  var client = null;
  var currentUser = null;
  var cloudReady = false;
  var cloudChoicePending = false;
  var pendingCloudData = null;
  var pendingCloudUpdatedAt = null;
  var pendingCloudExists = false;
  var processingUserId = null;
  var preparePromise = null;
  var saveTimer = null;
  var pollTimer = null;
  var saveInProgress = false;
  var saveAgain = false;
  var saveRevision = 0;
  var localDirty = false;
  var uiMounted = false;

  function byId(id) { return document.getElementById(id); }
  function setText(id, value) { var n = byId(id); if (n) n.textContent = value; }
  function setVisible(id, visible) { var n = byId(id); if (n) n.classList.toggle('hidden', !visible); }

  function setMessage(message, kind) {
    var n = byId('gft-auth-message');
    if (!n) return;
    n.textContent = message || '';
    n.className = 'mt-3 rounded-xl px-3 py-2 text-sm ' +
      (kind === 'error' ? 'bg-rose-100 text-rose-800' : kind === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700');
    n.classList.toggle('hidden', !message);
  }

  function setBusy(busy, message) {
    ['gft-login-btn', 'gft-signup-btn', 'gft-use-cloud-btn', 'gft-upload-local-btn'].forEach(function (id) {
      var b = byId(id); if (b) b.disabled = !!busy;
    });
    if (message) setMessage(message, 'info');
  }

  function setCloudStatus(label, mode) {
    var b = byId('gft-cloud-fab');
    if (!b) return;
    b.textContent = label;
    b.className = 'fixed bottom-4 right-3 z-[70] rounded-full px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-lg border ' +
      (mode === 'ok' ? 'bg-emerald-700 text-white border-emerald-500' : mode === 'error' ? 'bg-rose-700 text-white border-rose-500' : mode === 'busy' ? 'bg-amber-600 text-white border-amber-400' : 'bg-slate-800 text-white border-slate-600');
  }

  function cloneData(value) { return JSON.parse(JSON.stringify(value)); }
  function normalizedData(value) {
    if (typeof normalizeData !== 'function') throw new Error('ไม่พบฟังก์ชันจัดรูปแบบข้อมูลของแอป');
    return normalizeData(value, true);
  }
  function localSnapshot() { return normalizedData(cloneData(appData)); }
  function comparableData(value) {
    var d = normalizedData(value);
    return JSON.stringify({ fish: d.fish || [], tanks: d.tanks || [], strains: d.strains || [], events: d.events || [], pedigreePairs: d.pedigreePairs || [], transactions: d.transactions || [] });
  }
  function archiveLocal(label, value) {
    try {
      var key = STORAGE_KEY + '_' + label + '_' + new Date().toISOString().replace(/[:.]/g, '-');
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { console.warn('Local backup failed:', e); return false; }
  }
  function backupAndApplyCloud(value) {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw && !archiveLocal('before_cloud_' + (currentUser ? currentUser.id : 'local'), JSON.parse(raw))) {
      throw new Error('ไม่สามารถสำรองข้อมูลเดิมในเครื่องได้ จึงยกเลิกการเปลี่ยนข้อมูลเพื่อความปลอดภัย');
    }
    appData = normalizedData(value);
    appData.exportedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    if (typeof initSelectedLabels === 'function') initSelectedLabels();
    if (typeof renderAll === 'function') renderAll();
  }

  function showGate() { setVisible('gft-auth-gate', true); }
  function hideGate() { setVisible('gft-auth-gate', false); }

  function mountUi() {
    if (uiMounted) return;
    uiMounted = true;
    var markup = `
      <div id="gft-auth-gate" class="fixed inset-0 z-[100] overflow-y-auto bg-slate-950/95 p-4 sm:p-6">
        <div class="min-h-full flex items-center justify-center">
          <div class="w-full max-w-md rounded-3xl bg-white p-5 sm:p-7 shadow-2xl border border-slate-200">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center text-2xl">🐟</div>
              <div><h2 class="font-heading text-xl font-bold text-slate-900">Guppy Farm Tracker</h2><p class="text-xs text-slate-500">เข้าสู่ระบบเพื่อสำรองและซิงก์ข้อมูลออนไลน์</p></div>
            </div>
            <div id="gft-auth-form-panel">
              <h3 class="font-heading font-semibold text-slate-800 mb-3">เข้าสู่ระบบหรือสมัครสมาชิก</h3>
              <form id="gft-auth-form" class="space-y-3">
                <div><label for="gft-email" class="block text-sm font-medium text-slate-700 mb-1">อีเมล</label><input id="gft-email" type="email" autocomplete="email" required class="w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900" placeholder="name@example.com" /></div>
                <div><label for="gft-password" class="block text-sm font-medium text-slate-700 mb-1">รหัสผ่าน</label><input id="gft-password" type="password" autocomplete="current-password" minlength="6" required class="w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900" placeholder="อย่างน้อย 6 ตัวอักษร" /></div>
                <button id="gft-login-btn" type="submit" class="w-full rounded-xl bg-teal-700 px-4 py-3 text-white font-semibold">เข้าสู่ระบบ</button>
                <button id="gft-signup-btn" type="button" class="w-full rounded-xl border border-teal-700 px-4 py-3 text-teal-800 font-semibold">สมัครสมาชิกด้วยอีเมล</button>
              </form>
              <div id="gft-auth-message" class="hidden mt-3 rounded-xl px-3 py-2 text-sm"></div>
              <p class="mt-4 text-xs leading-5 text-slate-500">หลังสมัครสมาชิก กรุณาตรวจอีเมลยืนยันและโฟลเดอร์ Spam ก่อนเข้าสู่ระบบ</p>
            </div>
            <div id="gft-cloud-choice-panel" class="hidden">
              <h3 class="font-heading font-semibold text-slate-900 mb-2">ตรวจพบข้อมูลสำหรับบัญชีนี้</h3>
              <p id="gft-cloud-choice-text" class="text-sm leading-6 text-slate-600"></p>
              <div class="mt-4 space-y-2">
                <button id="gft-use-cloud-btn" type="button" class="w-full rounded-xl bg-teal-700 px-4 py-3 text-white font-semibold">ใช้ข้อมูลจาก Cloud บนอุปกรณ์นี้</button>
                <button id="gft-upload-local-btn" type="button" class="w-full rounded-xl border border-amber-500 px-4 py-3 text-amber-800 font-semibold">อัปโหลดข้อมูลในอุปกรณ์นี้ขึ้น Cloud</button>
              </div>
              <p class="mt-3 text-xs leading-5 text-amber-700">หากข้อมูลในเครื่องและ Cloud ต่างกัน ระบบจะไม่รวมรายการเอง เพื่อป้องกันข้อมูลซ้ำ กรุณาเลือกชุดข้อมูลที่ต้องการใช้</p>
            </div>
            <div id="gft-ready-panel" class="hidden">
              <div class="rounded-2xl bg-emerald-50 border border-emerald-200 p-4"><p class="font-semibold text-emerald-900">เชื่อมต่อบัญชีแล้ว</p><p id="gft-account-email" class="mt-1 break-all text-sm text-emerald-800"></p><p id="gft-ready-message" class="mt-2 text-sm text-emerald-800"></p></div>
              <button id="gft-enter-app-btn" type="button" class="mt-4 w-full rounded-xl bg-teal-700 px-4 py-3 text-white font-semibold">เข้าใช้งานแอป</button>
              <button id="gft-signout-btn" type="button" class="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-700 font-semibold">ออกจากระบบ</button>
            </div>
            <div class="mt-5 border-t border-slate-200 pt-4"><button id="gft-offline-btn" type="button" class="w-full rounded-xl bg-slate-100 px-4 py-3 text-slate-700 font-medium">ใช้ข้อมูลในเครื่องก่อน (ยังไม่ซิงก์ Cloud)</button><p class="mt-2 text-center text-[11px] leading-5 text-slate-500">ข้อมูลในเครื่องจะไม่ถูกลบเมื่อออกจากระบบ การซิงก์ออนไลน์ต้องเข้าสู่ระบบและเลือกชุดข้อมูลก่อน</p></div>
          </div>
        </div>
      </div>
      <button id="gft-cloud-fab" type="button" class="fixed bottom-4 right-3 z-[70] rounded-full px-4 py-2.5 text-xs sm:text-sm font-semibold shadow-lg border bg-slate-800 text-white border-slate-600">☁️ เชื่อมต่อ Cloud</button>
    `;
    document.body.insertAdjacentHTML('beforeend', markup);
    byId('gft-auth-form').addEventListener('submit', onLogin);
    byId('gft-signup-btn').addEventListener('click', onSignup);
    byId('gft-use-cloud-btn').addEventListener('click', useCloudData);
    byId('gft-upload-local-btn').addEventListener('click', uploadLocalData);
    byId('gft-enter-app-btn').addEventListener('click', hideGate);
    byId('gft-signout-btn').addEventListener('click', onSignout);
    byId('gft-offline-btn').addEventListener('click', function () { cloudReady = false; cloudChoicePending = false; setCloudStatus('☁️ ใช้ข้อมูลในเครื่อง', 'idle'); hideGate(); });
    byId('gft-cloud-fab').addEventListener('click', openGate);
  }

  function showAuthForm(message, kind) {
    setBusy(false);
    setVisible('gft-auth-form-panel', true); setVisible('gft-cloud-choice-panel', false); setVisible('gft-ready-panel', false);
    setMessage(message || '', kind || 'info'); setCloudStatus('☁️ ยังไม่เชื่อม Cloud', 'idle');
  }
  function showChoicePanel(message, existing) {
    setBusy(false); cloudChoicePending = true; pendingCloudExists = !!existing;
    setVisible('gft-auth-form-panel', false); setVisible('gft-ready-panel', false); setVisible('gft-cloud-choice-panel', true);
    setText('gft-cloud-choice-text', message);
    var b = byId('gft-upload-local-btn');
    if (b) b.textContent = existing ? 'แทนที่ข้อมูล Cloud ด้วยข้อมูลในอุปกรณ์นี้' : 'ย้ายข้อมูลในอุปกรณ์นี้ขึ้น Cloud';
    setCloudStatus('☁️ เลือกข้อมูลที่จะใช้', 'busy'); setMessage('', 'info');
  }
  function showReadyPanel(message) {
    setBusy(false); setVisible('gft-auth-form-panel', false); setVisible('gft-cloud-choice-panel', false); setVisible('gft-ready-panel', true);
    setText('gft-account-email', currentUser ? currentUser.email : ''); setText('gft-ready-message', message || 'ข้อมูลพร้อมใช้งานบน Cloud');
    setCloudStatus('☁️ Cloud พร้อมซิงก์', 'ok');
  }

  async function readCloudRow(userId) {
    var r = await client.from('farm_data').select('user_id, data, updated_at').eq('user_id', userId).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  async function writeCloudRow(userId, value, expectedUpdatedAt) {
    var payload = normalizedData(cloneData(value));
    var r;
    if (expectedUpdatedAt) {
      r = await client.from('farm_data').update({ data: payload }).eq('user_id', userId).eq('updated_at', expectedUpdatedAt).select('updated_at').maybeSingle();
      if (r.error) throw r.error;
      if (!r.data) { var e = new Error('ข้อมูล Cloud ถูกแก้ไขจากอุปกรณ์อื่นในเวลาเดียวกัน กรุณาเลือกข้อมูลอีกครั้ง'); e.code = 'GFT_CONFLICT'; throw e; }
      return r.data.updated_at;
    }
    r = await client.from('farm_data').insert({ user_id: userId, data: payload }).select('updated_at').single();
    if (r.error) {
      if (r.error.code === '23505') { var d = new Error('บัญชีนี้มีข้อมูล Cloud อยู่แล้ว กรุณาตรวจสอบข้อมูลอีกครั้ง'); d.code = 'GFT_CONFLICT'; throw d; }
      throw r.error;
    }
    return r.data.updated_at;
  }

  async function prepareUser(user) {
    if (!user || !user.id) return;
    if (currentUser && currentUser.id === user.id && cloudReady) { showReadyPanel('บัญชีนี้เชื่อมต่อและซิงก์ข้อมูลแล้ว'); return; }
    if (preparePromise && processingUserId === user.id) return preparePromise;
    currentUser = user; processingUserId = user.id; cloudReady = false; cloudChoicePending = false;
    setVisible('gft-auth-form-panel', false); setVisible('gft-ready-panel', false); setVisible('gft-cloud-choice-panel', false);
    setMessage('กำลังตรวจสอบข้อมูลของบัญชีนี้ใน Cloud...', 'info'); setCloudStatus('☁️ กำลังตรวจสอบ Cloud', 'busy');

    preparePromise = (async function () {
      try {
        var row = await readCloudRow(user.id);
        pendingCloudData = row ? normalizedData(cloneData(row.data)) : null;
        pendingCloudUpdatedAt = row ? row.updated_at : null;
        var local = localSnapshot();
        if (!row) {
          showChoicePanel('ยังไม่พบข้อมูลของบัญชีนี้บน Cloud สามารถย้ายข้อมูลปลา ตู้ปลา สายพันธุ์ ประวัติเหตุการณ์ คู่ผสมพันธุ์ และบัญชีจากอุปกรณ์นี้ขึ้น Cloud ได้', false);
          return;
        }
        if (comparableData(local) === comparableData(pendingCloudData)) {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) archiveLocal('same_data_before_cloud_' + user.id, JSON.parse(raw));
          appData = pendingCloudData; appData.exportedAt = new Date().toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
          if (typeof initSelectedLabels === 'function') initSelectedLabels(); if (typeof renderAll === 'function') renderAll();
          lastCloudUpdatedAt = row.updated_at; localDirty = false; cloudReady = true; cloudChoicePending = false;
          showReadyPanel('ข้อมูลในอุปกรณ์ตรงกับ Cloud แล้ว พร้อมซิงก์อัตโนมัติ'); hideGate(); startCloudPolling(); return;
        }
        showChoicePanel('พบข้อมูล Cloud อยู่แล้ว และข้อมูลในอุปกรณ์นี้แตกต่างกัน กรุณาเลือกว่าจะใช้ข้อมูลชุดใด ระบบจะสำรองข้อมูลเดิมในเครื่องก่อนเปลี่ยน', true);
      } catch (error) {
        console.error('Cloud data check failed:', error);
        showAuthForm('ตรวจสอบ Cloud ไม่สำเร็จ: ' + (error.message || 'โปรดลองอีกครั้ง') + ' คุณยังใช้ข้อมูลในเครื่องก่อนได้', 'error');
        setCloudStatus('☁️ เชื่อม Cloud ไม่สำเร็จ', 'error');
      } finally { preparePromise = null; }
    })();
    return preparePromise;
  }

  function backupAndApplyCloud(value) {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw && !archiveLocal('before_cloud_' + (currentUser ? currentUser.id : 'local'), JSON.parse(raw))) throw new Error('ไม่สามารถสำรองข้อมูลเดิมในเครื่องได้ จึงยกเลิกการเปลี่ยนข้อมูลเพื่อความปลอดภัย');
    appData = normalizedData(value); appData.exportedAt = new Date().toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    if (typeof initSelectedLabels === 'function') initSelectedLabels(); if (typeof renderAll === 'function') renderAll();
  }

  async function useCloudData() {
    if (!currentUser || !pendingCloudData) return;
    setBusy(true, 'กำลังสำรองข้อมูลในเครื่องและโหลดข้อมูลจาก Cloud...');
    try {
      backupAndApplyCloud(pendingCloudData); lastCloudUpdatedAt = pendingCloudUpdatedAt; cloudReady = true; cloudChoicePending = false; localDirty = false;
      showReadyPanel('ใช้ข้อมูลจาก Cloud แล้ว ข้อมูลเดิมในเครื่องถูกสำรองไว้'); hideGate(); setCloudStatus('☁️ Cloud พร้อมซิงก์', 'ok'); startCloudPolling();
    } catch (e) { setBusy(false); setMessage('ไม่สามารถโหลดข้อมูลจาก Cloud ได้: ' + e.message, 'error'); }
  }

  async function uploadLocalData() {
    if (!currentUser || !cloudChoicePending) return;
    if (pendingCloudExists && !window.confirm('บัญชีนี้มีข้อมูล Cloud อยู่แล้ว การดำเนินการนี้จะแทนที่ข้อมูล Cloud ด้วยข้อมูลในอุปกรณ์นี้ (ไม่รวมรายการอัตโนมัติ) ต้องการดำเนินการต่อหรือไม่?')) return;
    setBusy(true, 'กำลังสำรองและย้ายข้อมูลจากอุปกรณ์นี้ขึ้น Cloud...');
    try {
      if (pendingCloudExists && pendingCloudData && !archiveLocal('cloud_before_replace_' + currentUser.id, pendingCloudData)) throw new Error('ไม่สามารถสำรองข้อมูล Cloud เดิมไว้ในเครื่องนี้ได้ จึงยกเลิกการแทนที่');
      var snapshot = localSnapshot();
      lastCloudUpdatedAt = await writeCloudRow(currentUser.id, snapshot, pendingCloudUpdatedAt);
      pendingCloudData = cloneData(snapshot); pendingCloudUpdatedAt = lastCloudUpdatedAt;
      cloudReady = true; cloudChoicePending = false; localDirty = false; showReadyPanel('ย้ายข้อมูลขึ้น Cloud สำเร็จแล้ว ระบบจะซิงก์การแก้ไขครั้งต่อไปอัตโนมัติ'); hideGate();
      setCloudStatus('☁️ ย้ายข้อมูลขึ้น Cloud แล้ว', 'ok'); startCloudPolling();
      if (typeof showToast === 'function') showToast('ย้ายข้อมูลขึ้น Cloud สำเร็จแล้ว');
    } catch (e) {
      console.error('Cloud migration failed:', e); setBusy(false); setMessage('ย้ายข้อมูลไม่สำเร็จ: ' + (e.message || 'โปรดลองอีกครั้ง'), 'error'); setCloudStatus('☁️ ย้ายข้อมูลไม่สำเร็จ', 'error');
      if (e.code === 'GFT_CONFLICT') prepareUser(currentUser);
    }
  }

  async function onLogin(event) {
    event.preventDefault(); if (!client) return;
    setBusy(true, 'กำลังเข้าสู่ระบบ...');
    try {
      var r = await client.auth.signInWithPassword({ email: byId('gft-email').value.trim().toLowerCase(), password: byId('gft-password').value });
      if (r.error) throw r.error; await prepareUser(r.data.user);
    } catch (e) { setBusy(false); setMessage('เข้าสู่ระบบไม่สำเร็จ: ' + e.message, 'error'); }
  }

  async function onSignup() {
    if (!client) return;
    var email = byId('gft-email').value.trim().toLowerCase(); var password = byId('gft-password').value;
    if (!email || !password) { setMessage('กรุณากรอกอีเมลและรหัสผ่านก่อนสมัครสมาชิก', 'error'); return; }
    if (password.length < 6) { setMessage('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร', 'error'); return; }
    setBusy(true, 'กำลังสมัครสมาชิก...');
    try {
      var r = await client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: SITE_URL } });
      if (r.error) throw r.error;
      if (r.data.session && r.data.user) await prepareUser(r.data.user);
      else { setBusy(false); setMessage('สมัครสมาชิกแล้ว กรุณาเปิดอีเมลเพื่อกดยืนยันบัญชี จากนั้นกลับมาเข้าสู่ระบบอีกครั้ง', 'success'); }
    } catch (e) { setBusy(false); setMessage('สมัครสมาชิกไม่สำเร็จ: ' + e.message, 'error'); }
  }

  async function onSignout() {
    if (!client) return;
    setBusy(true, 'กำลังออกจากระบบ...');
    try { var r = await client.auth.signOut(); if (r.error) throw r.error; }
    catch (e) { setBusy(false); setMessage('ออกจากระบบไม่สำเร็จ: ' + e.message, 'error'); }
  }

  function showConflict(row) {
    pendingCloudData = normalizedData(cloneData(row.data)); pendingCloudUpdatedAt = row.updated_at; cloudReady = false;
    showChoicePanel('ข้อมูล Cloud มีการแก้ไขจากอุปกรณ์อื่น ขณะที่อุปกรณ์นี้มีข้อมูลไม่ตรงกัน กรุณาเลือกใช้ข้อมูลจาก Cloud หรือแทนที่ Cloud ด้วยข้อมูลในอุปกรณ์นี้', true); showGate();
  }

  async function flushCloudSave() {
    if (!cloudReady || !currentUser || !client) return;
    if (saveInProgress) { saveAgain = true; return; }
    saveInProgress = true; saveAgain = false; var revision = saveRevision;
    try {
      var snapshot = localSnapshot(); var latest = await readCloudRow(currentUser.id);
      if (!latest) throw new Error('ไม่พบข้อมูล Cloud ของบัญชีนี้ กรุณาเปิดเมนู Cloud เพื่อเชื่อมต่อใหม่');
      if (lastCloudUpdatedAt && latest.updated_at !== lastCloudUpdatedAt) {
        if (comparableData(latest.data) !== comparableData(snapshot)) { showConflict(latest); return; }
        lastCloudUpdatedAt = latest.updated_at;
      }
      setCloudStatus('☁️ กำลังบันทึก...', 'busy');
      lastCloudUpdatedAt = await writeCloudRow(currentUser.id, snapshot, latest.updated_at);
      if (revision === saveRevision) { localDirty = false; setCloudStatus('☁️ ซิงก์ข้อมูลแล้ว', 'ok'); }
    } catch (e) {
      console.error('Cloud save failed:', e);
      if (e.code === 'GFT_CONFLICT') {
        try { var row = await readCloudRow(currentUser.id); if (row) showConflict(row); }
        catch (readError) { console.error(readError); setCloudStatus('☁️ ตรวจสอบความขัดแย้งไม่สำเร็จ', 'error'); }
      } else {
        setCloudStatus('☁️ บันทึก Cloud ไม่สำเร็จ', 'error');
        if (typeof showToast === 'function') showToast('บันทึกในเครื่องแล้ว แต่ซิงก์ Cloud ไม่สำเร็จ กรุณาเชื่อมอินเทอร์เน็ตและลองอีกครั้ง', 'warning');
      }
    } finally {
      saveInProgress = false;
      if (saveAgain || (cloudReady && revision !== saveRevision)) { saveAgain = false; clearTimeout(saveTimer); saveTimer = setTimeout(flushCloudSave, 600); }
    }
  }

  function scheduleCloudSave() {
    if (!cloudReady || !currentUser || !client) return;
    saveRevision += 1; localDirty = true; clearTimeout(saveTimer); setCloudStatus('☁️ มีข้อมูลรอซิงก์...', 'busy'); saveTimer = setTimeout(flushCloudSave, 800);
  }

  function patchSaveData() {
    if (typeof window.saveData !== 'function' || window.saveData.__gftCloudPatched) return;
    var original = window.saveData;
    var wrapped = function () { var result = original.apply(this, arguments); scheduleCloudSave(); return result; };
    wrapped.__gftCloudPatched = true; window.saveData = wrapped;
  }

  async function refreshCloudIfChanged() {
    if (!cloudReady || !currentUser || !client || localDirty || saveInProgress || saveTimer || !navigator.onLine || document.visibilityState === 'hidden') return;
    try {
      var row = await readCloudRow(currentUser.id); if (!row) return;
      if (lastCloudUpdatedAt && row.updated_at !== lastCloudUpdatedAt) {
        var local = localSnapshot();
        if (comparableData(local) !== comparableData(row.data)) {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw && !archiveLocal('before_remote_update_' + currentUser.id, JSON.parse(raw))) { setCloudStatus('☁️ สำรองข้อมูลก่อนรับข้อมูลใหม่ไม่สำเร็จ', 'error'); return; }
          appData = normalizedData(row.data); appData.exportedAt = new Date().toISOString(); localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
          if (typeof initSelectedLabels === 'function') initSelectedLabels(); if (typeof renderAll === 'function') renderAll();
          if (typeof showToast === 'function') showToast('อัปเดตข้อมูลจาก Cloud แล้ว');
        }
        lastCloudUpdatedAt = row.updated_at; setCloudStatus('☁️ ซิงก์ข้อมูลแล้ว', 'ok');
      }
    } catch (e) { console.warn('Cloud refresh failed:', e); setCloudStatus('☁️ ตรวจสอบ Cloud ไม่สำเร็จ', 'error'); }
  }

  function startCloudPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(refreshCloudIfChanged, 30000); }

  function onAuthChange(event, session) {
    if (session && session.user) {
      currentUser = session.user;
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'USER_UPDATED') setTimeout(function () { prepareUser(session.user); }, 0);
      return;
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null; cloudReady = false; cloudChoicePending = false; pendingCloudData = null; pendingCloudUpdatedAt = null; pendingCloudExists = false; processingUserId = null; preparePromise = null; localDirty = false;
      if (pollTimer) clearInterval(pollTimer); showAuthForm('ออกจากระบบแล้ว ข้อมูลในอุปกรณ์นี้ยังคงอยู่', 'success'); showGate(); setCloudStatus('☁️ ออกจากระบบแล้ว', 'idle');
    }
  }

  async function initializeCloud() {
    mountUi(); patchSaveData();
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { showAuthForm('โหลดไลบรารี Supabase ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต หรือใช้ข้อมูลในเครื่องก่อน', 'error'); return; }
    try {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } });
      client.auth.onAuthStateChange(onAuthChange);
      var r = await client.auth.getSession(); if (r.error) throw r.error;
      if (r.data.session && r.data.session.user) await prepareUser(r.data.session.user);
      else showAuthForm('เข้าสู่ระบบหรือสมัครสมาชิกเพื่อเปิดใช้งาน Cloud Sync', 'info');
    } catch (e) { console.error('Supabase initialization failed:', e); showAuthForm('เชื่อมต่อ Supabase ไม่สำเร็จ: ' + e.message, 'error'); }
  }

  window.addEventListener('online', function () { if (cloudReady) { if (localDirty) flushCloudSave(); else refreshCloudIfChanged(); } else setCloudStatus('☁️ กลับมาออนไลน์แล้ว', 'idle'); });
  window.addEventListener('focus', refreshCloudIfChanged);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refreshCloudIfChanged(); });
  window.addEventListener('offline', function () { if (cloudReady) setCloudStatus('☁️ ออฟไลน์ — เก็บในเครื่องก่อน', 'error'); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeCloud);
  else initializeCloud();
})();
