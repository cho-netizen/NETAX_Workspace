// ============================================================
// NETAX Desk 공용 설정
// GAS(Code.gs)를 배포한 뒤 나오는 웹앱 URL을 아래에 붙여넣으세요.
// 비워두면 화면에서 폴더/링크 추가·삭제 기능이 꺼진 채로(기존처럼 CSV만 읽는 방식으로) 동작합니다.
// ============================================================
window.DESK_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyFbvXiV6rSzCvhtc_T2WrzNF5ZxhOFWtSSsgzSavzPbjv4LBGhjXhu_Q2_8m-PDj8s/exec',
  // [2026.08] 통합 백엔드 인증 비밀값 — 서버(gs-backend)의 스크립트 속성 API_SECRET과 같은 값.
  API_SECRET: 'c235d6c3e3fd0eb7567da6e58849c61eeeb8d904497f5f1d41729d705208330e'
};