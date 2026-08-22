/**
 * NETAX Desk — 폴더/링크 관리 백엔드 (Apps Script)
 *
 * 이 스크립트는 desk.netax.kr이 쓰는 구글시트("NETAX Desk Data")에 직접 바인딩해서 배포한다.
 * 기존엔 "웹에 게시"된 CSV(읽기 전용)만 썼는데, 이 스크립트를 통하면 화면에서 바로
 * 폴더·링크를 추가/삭제할 수 있다. 시트를 직접 읽으므로 게시된 CSV처럼 반영이
 * 몇 분 지연되는 문제도 없다(항상 실시간).
 *
 * ===== 배포 방법 =====
 * 1. 이 스프레드시트(NETAX Desk Data)를 열고 확장 프로그램 → Apps Script
 * 2. 기본 코드를 지우고 이 파일 내용 전체를 붙여넣기
 * 3. 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행 계정: 나
 *    - 액세스 권한: 전체 공개(익명 사용자 포함) — desk.netax.kr에서 로그인 없이 호출해야 하므로
 * 4. 배포 후 나오는 웹앱 URL을 desk.netax.kr의 config.js(DESK_GAS_URL)에 붙여넣기
 */

const SHEET_ID = '1TACQdGSsPdr8EFd-v_iR3DRmt6NlTPwmSXtm30jbPm8'; // NETAX Desk Data
const FOLDERS_SHEET_NAME = 'Folders';
const LINKS_SHEET_NAME = 'Links';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const WRITE_ACTIONS = ['addFolder', 'deleteFolder', 'addLink', 'deleteLink', 'reorderFolders', 'reorderLinks', 'moveLink'];
    if (WRITE_ACTIONS.indexOf(body.action) !== -1) {
      const authError = checkEditPassword_(body.password);
      if (authError) return jsonResponse(authError);
    }
    let result;
    switch (body.action) {
      case 'listAll':      result = handleListAll(); break;
      case 'addFolder':    result = handleAddFolder(body); break;
      case 'deleteFolder': result = handleDeleteFolder(body); break;
      case 'addLink':      result = handleAddLink(body); break;
      case 'deleteLink':   result = handleDeleteLink(body); break;
      case 'reorderFolders': result = handleReorderFolders(body); break;
      case 'reorderLinks':   result = handleReorderLinks(body); break;
      case 'moveLink':       result = handleMoveLink(body); break;
      default: result = { error: '알 수 없는 action: ' + body.action };
    }
    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: '서버 처리 중 오류: ' + err.message });
  }
}

/**
 * 이 웹앱은 "액세스 권한: 전체 공개"로 배포해야 desk.netax.kr에서 로그인 없이 호출할 수
 * 있는데, 그러면 URL만 알면 누구나 addFolder/deleteFolder 등을 호출할 수 있게 된다.
 * 그래서 쓰기 작업(추가/삭제)에는 별도 비밀번호를 요구한다.
 * 스크립트 속성(파일 → 프로젝트 설정 → 스크립트 속성)에 DESK_EDIT_PASSWORD를 설정해야
 * 실제로 동작한다 — 설정 안 돼있으면 쓰기 작업 자체를 막는다(설정을 깜빡하고
 * 완전 무방비로 배포하는 사고를 방지).
 */
function checkEditPassword_(inputPassword) {
  const correct = PropertiesService.getScriptProperties().getProperty('DESK_EDIT_PASSWORD');
  if (!correct) return { error: 'DESK_EDIT_PASSWORD가 스크립트 속성에 설정되어 있지 않아 쓰기 작업이 비활성화되어 있습니다.' };
  if (String(inputPassword || '') !== correct) return { error: '비밀번호가 올바르지 않습니다.' };
  return null;
}

// GET으로도 listAll을 지원해두면 배포 후 브라우저 주소창에 ?action=listAll 붙여서 바로 확인 가능
function doGet(e) {
  const params = (e && e.parameter) || {}; // 편집기에서 "실행" 버튼으로 직접 돌리면 e 자체가 undefined라 방어
  if (params.action === 'listAll') return jsonResponse(handleListAll());
  return jsonResponse({ status: 'ok', message: 'NETAX Desk 관리 백엔드가 정상 동작 중입니다.' });
}

/**
 * 같은 시트를 여러 사람이 거의 동시에 고칠 때 뒤에 쓴 쪽이 앞 내용을 덮어쓰는 걸
 * 막기 위한 잠금 헬퍼 (NX Assistant의 withLock_과 동일 패턴).
 */
function withLock_(waitMs, fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(waitMs || 8000);
  } catch (err) {
    return { error: '다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.' };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 폴더명 비교용 정규화 — index.html의 normalizeFolderKey와 동일 로직.
// 구글시트 입력 과정에서 섞이기 쉬운 보이지 않는 공백(NBSP·전각공백·제로폭 문자) 차이로
// 폴더-링크 매칭이 어긋나는 걸 방지한다.
function normalizeKey_(s) {
  return String(s || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\s\u00A0\u3000]+/g, '')
    .toLowerCase();
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 1) return [];
  const header = values[0].map(function (h) { return String(h).trim(); });
  return values.slice(1)
    .filter(function (row) { return row.some(function (v) { return String(v).trim() !== ''; }); })
    .map(function (row) {
      const obj = {};
      header.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function handleListAll() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const folders = sheetToObjects_(ss.getSheetByName(FOLDERS_SHEET_NAME));
  const links = sheetToObjects_(ss.getSheetByName(LINKS_SHEET_NAME));
  return { folders: folders, links: links };
}

function handleAddFolder(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: '폴더명이 없습니다.' };
  return withLock_(8000, function () {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(FOLDERS_SHEET_NAME);
    const values = sheet.getDataRange().getValues();

    // 중복 폴더명 방지
    for (let i = 1; i < values.length; i++) {
      if (normalizeKey_(values[i][2]) === normalizeKey_(name)) {
        return { error: '이미 같은 이름의 폴더가 있습니다: ' + name };
      }
    }
    // 순서는 지금 있는 것 중 최댓값+1로 자동 채번 (맨 뒤에 추가됨)
    let maxOrder = -1;
    for (let i = 1; i < values.length; i++) {
      const n = Number(values[i][0]);
      if (Number.isFinite(n) && n > maxOrder) maxOrder = n;
    }
    sheet.appendRow([maxOrder + 1, body.icon || '', name, body.desc || '']);
    return { success: true };
  });
}

function handleDeleteFolder(body) {
  const name = String(body.name || '').trim();
  if (!name) return { error: '폴더명이 없습니다.' };
  return withLock_(8000, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const folderSheet = ss.getSheetByName(FOLDERS_SHEET_NAME);
    const values = folderSheet.getDataRange().getValues();

    let targetRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (normalizeKey_(values[i][2]) === normalizeKey_(name)) { targetRow = i + 1; break; }
    }
    if (targetRow === -1) return { error: '폴더를 찾을 수 없습니다: ' + name };
    folderSheet.deleteRow(targetRow);

    // 그 폴더에 속한 링크들도 함께 삭제 (고아 링크 방지) — 뒤에서부터 지워야 행번호가 안 꼬임
    const linkSheet = ss.getSheetByName(LINKS_SHEET_NAME);
    const linkValues = linkSheet.getDataRange().getValues();
    for (let i = linkValues.length - 1; i >= 1; i--) {
      if (normalizeKey_(linkValues[i][0]) === normalizeKey_(name)) linkSheet.deleteRow(i + 1);
    }
    return { success: true };
  });
}

function handleAddLink(body) {
  const folderName = String(body.folderName || '').trim();
  const title = String(body.title || '').trim();
  let url = String(body.url || '').trim();
  if (!folderName) return { error: '폴더명이 없습니다.' };
  if (!title) return { error: '제목이 없습니다.' };
  if (!url) return { error: 'URL이 없습니다.' };
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  return withLock_(8000, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const folderSheet = ss.getSheetByName(FOLDERS_SHEET_NAME);
    const folderValues = folderSheet.getDataRange().getValues();
    const exists = folderValues.slice(1).some(function (row) {
      return normalizeKey_(row[2]) === normalizeKey_(folderName);
    });
    if (!exists) return { error: '존재하지 않는 폴더입니다: ' + folderName + ' (먼저 폴더를 추가해주세요)' };

    const linkSheet = ss.getSheetByName(LINKS_SHEET_NAME);
    linkSheet.appendRow([folderName, title, url, body.mode || '']);
    return { success: true };
  });
}

function handleDeleteLink(body) {
  const folderName = String(body.folderName || '').trim();
  const title = String(body.title || '').trim();
  if (!folderName || !title) return { error: '폴더명과 제목이 모두 필요합니다.' };

  return withLock_(8000, function () {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LINKS_SHEET_NAME);
    const values = sheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (normalizeKey_(values[i][0]) === normalizeKey_(folderName) && normalizeKey_(values[i][1]) === normalizeKey_(title)) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { error: '해당 링크를 찾을 수 없습니다.' };
  });
}

/**
 * 폴더 순서를 통째로 다시 매긴다. order는 화면에서 드래그로 재배열한 뒤의
 * 폴더명 배열(위에서 아래 순서)이다 — Folders 시트의 "순서"(A열) 값만 그 인덱스로 갱신한다.
 */
function handleReorderFolders(body) {
  const order = Array.isArray(body.order) ? body.order : [];
  if (!order.length) return { error: '순서 정보가 없습니다.' };
  return withLock_(8000, function () {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(FOLDERS_SHEET_NAME);
    const values = sheet.getDataRange().getValues();
    const orderIndex = {};
    order.forEach(function (name, idx) { orderIndex[normalizeKey_(name)] = idx; });
    for (let i = 1; i < values.length; i++) {
      const key = normalizeKey_(values[i][2]);
      if (Object.prototype.hasOwnProperty.call(orderIndex, key)) {
        sheet.getRange(i + 1, 1).setValue(orderIndex[key]);
      }
    }
    return { success: true };
  });
}

/**
 * 한 폴더 안 링크들의 순서를 다시 배열한다. Links 시트엔 순서 컬럼이 따로 없어서,
 * 시트에 실제로 나타나는 행 순서 자체가 곧 표시 순서다 — 그래서 해당 폴더의 기존 행을
 * 전부 지우고(뒤에서부터), 요청받은 새 순서대로 시트 맨 아래에 다시 추가한다.
 * (다른 폴더 링크들과 섞이지만, 화면에서는 폴더명으로 다시 묶어서 보여주므로 상관없음)
 */
function handleReorderLinks(body) {
  const folderName = String(body.folderName || '').trim();
  const order = Array.isArray(body.order) ? body.order : [];
  if (!folderName || !order.length) return { error: '폴더명과 순서 정보가 필요합니다.' };
  return withLock_(8000, function () {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LINKS_SHEET_NAME);
    const values = sheet.getDataRange().getValues();
    const key = normalizeKey_(folderName);

    const rowsByTitle = {};
    for (let i = values.length - 1; i >= 1; i--) {
      if (normalizeKey_(values[i][0]) === key) {
        rowsByTitle[normalizeKey_(values[i][1])] = values[i];
        sheet.deleteRow(i + 1);
      }
    }
    order.forEach(function (title) {
      const row = rowsByTitle[normalizeKey_(title)];
      if (row) sheet.appendRow(row);
    });
    return { success: true };
  });
}

/**
 * 링크 하나를 다른 폴더로 옮긴다(폴더명 컬럼만 바꿔서 다시 씀). 정확한 위치는
 * 옮긴 뒤 그 폴더 맨 끝에 들어가고, 세부 순서를 더 조정하고 싶으면 그 폴더 안에서
 * 같은 폴더 안 드래그(reorderLinks)로 다시 옮기면 된다.
 */
function handleMoveLink(body) {
  const fromFolder = String(body.fromFolder || '').trim();
  const toFolder = String(body.toFolder || '').trim();
  const title = String(body.title || '').trim();
  if (!fromFolder || !toFolder || !title) return { error: '이동에 필요한 정보가 부족합니다.' };
  if (normalizeKey_(fromFolder) === normalizeKey_(toFolder)) return { success: true }; // 같은 폴더면 할 일 없음

  return withLock_(8000, function () {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const folderSheet = ss.getSheetByName(FOLDERS_SHEET_NAME);
    const folderValues = folderSheet.getDataRange().getValues();
    const toExists = folderValues.slice(1).some(function (row) { return normalizeKey_(row[2]) === normalizeKey_(toFolder); });
    if (!toExists) return { error: '이동할 폴더가 존재하지 않습니다: ' + toFolder };

    const linkSheet = ss.getSheetByName(LINKS_SHEET_NAME);
    const values = linkSheet.getDataRange().getValues();
    for (let i = values.length - 1; i >= 1; i--) {
      if (normalizeKey_(values[i][0]) === normalizeKey_(fromFolder) && normalizeKey_(values[i][1]) === normalizeKey_(title)) {
        const row = values[i];
        linkSheet.deleteRow(i + 1);
        linkSheet.appendRow([toFolder, row[1], row[2], row[3]]); // 폴더명만 바꿔서 맨 아래에 다시 추가
        return { success: true };
      }
    }
    return { error: '이동할 링크를 찾을 수 없습니다.' };
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
