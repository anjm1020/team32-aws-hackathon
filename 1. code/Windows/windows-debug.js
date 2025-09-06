/**
 * Windows 호환성 디버깅 스크립트
 * Chrome Extension에서 Windows 환경 문제 진단
 */

// Windows 환경 감지
function detectWindowsEnvironment() {
  const info = {
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    isWindows: navigator.platform.toLowerCase().includes('win'),
    chromeVersion: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || 'unknown',
    timestamp: new Date().toISOString()
  };
  
  console.log('🔍 Windows 환경 감지:', info);
  return info;
}

// HTTP Response 디버깅
function debugHttpResponse() {
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const [url, options] = args;
    console.log('🌐 Fetch 요청:', { url, options, platform: navigator.platform });
    
    try {
      const response = await originalFetch.apply(this, args);
      console.log('✅ Fetch 응답:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        platform: navigator.platform
      });
      
      // Response 복제하여 내용 확인
      const clonedResponse = response.clone();
      try {
        const text = await clonedResponse.text();
        console.log('📄 응답 내용:', {
          length: text.length,
          preview: text.substring(0, 200),
          isEmpty: !text || text.trim() === '',
          platform: navigator.platform
        });
      } catch (textError) {
        console.error('❌ 응답 텍스트 읽기 실패:', textError);
      }
      
      return response;
    } catch (error) {
      console.error('❌ Fetch 오류:', {
        error: error.message,
        name: error.name,
        stack: error.stack,
        platform: navigator.platform
      });
      throw error;
    }
  };
}

// Chrome Extension Context 디버깅
function debugExtensionContext() {
  const contextInfo = {
    chromeRuntime: !!chrome?.runtime,
    runtimeId: chrome?.runtime?.id,
    lastError: chrome?.runtime?.lastError,
    isExtensionContext: !!(chrome && chrome.runtime && chrome.runtime.id),
    platform: navigator.platform
  };
  
  console.log('🔧 Extension Context:', contextInfo);
  return contextInfo;
}

// 메시지 전송 디버깅
function debugMessageSending() {
  if (!chrome?.runtime?.sendMessage) {
    console.error('❌ chrome.runtime.sendMessage 사용 불가');
    return;
  }
  
  const originalSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = function(message, callback) {
    console.log('📤 메시지 전송:', { message, platform: navigator.platform });
    
    return originalSendMessage.call(this, message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('❌ 메시지 전송 오류:', chrome.runtime.lastError);
      } else {
        console.log('📥 메시지 응답:', { response, platform: navigator.platform });
      }
      
      if (callback) callback(response);
    });
  };
}

// 전체 디버깅 초기화
function initWindowsDebugging() {
  console.log('🚀 Windows 호환성 디버깅 시작');
  
  detectWindowsEnvironment();
  debugExtensionContext();
  debugHttpResponse();
  debugMessageSending();
  
  // 주기적 상태 체크
  setInterval(() => {
    const context = debugExtensionContext();
    if (!context.isExtensionContext) {
      console.warn('⚠️ Extension Context 무효화됨');
    }
  }, 5000);
  
  console.log('✅ Windows 디버깅 설정 완료');
}

// 자동 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWindowsDebugging);
} else {
  initWindowsDebugging();
}

// 전역 함수로 노출
window.windowsDebug = {
  detectEnvironment: detectWindowsEnvironment,
  debugContext: debugExtensionContext,
  init: initWindowsDebugging
};