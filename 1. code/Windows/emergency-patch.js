/**
 * 긴급 Windows 호환성 패치
 * HTTP Response 문제 해결을 위한 최후의 수단
 */

// 서버 응답 강제 처리 함수
function forceProcessResponse(url, data) {
  console.log('🚨 긴급 패치: 강제 응답 처리', { url, dataLength: data?.length });
  
  // XMLHttpRequest 사용 (fetch 대신)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'text/plain, */*');
    xhr.timeout = 30000;
    
    xhr.onreadystatechange = function() {
      console.log('XHR 상태 변경:', {
        readyState: xhr.readyState,
        status: xhr.status,
        responseText: xhr.responseText?.substring(0, 100)
      });
      
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          console.log('✅ XHR 성공:', {
            status: xhr.status,
            responseLength: xhr.responseText?.length || 0,
            response: xhr.responseText?.substring(0, 200)
          });
          resolve(xhr.responseText || '서버 응답 수신 완료');
        } else {
          console.error('❌ XHR 실패:', xhr.status, xhr.statusText);
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      }
    };
    
    xhr.onerror = function() {
      console.error('❌ XHR 네트워크 오류');
      reject(new Error('네트워크 오류'));
    };
    
    xhr.ontimeout = function() {
      console.error('❌ XHR 타임아웃');
      reject(new Error('요청 시간 초과'));
    };
    
    try {
      xhr.send(JSON.stringify(data));
      console.log('📤 XHR 요청 전송 완료');
    } catch (error) {
      console.error('❌ XHR 전송 실패:', error);
      reject(error);
    }
  });
}

// 긴급 패치 활성화 함수
function activateEmergencyPatch() {
  console.log('🚨 긴급 Windows 패치 활성화');
  
  // background.js의 sendToServer 함수 오버라이드
  if (typeof sendToServer === 'function') {
    const originalSendToServer = sendToServer;
    
    window.sendToServer = async function(data, retryCount = 0) {
      console.log('🚨 긴급 패치: sendToServer 오버라이드');
      
      try {
        // 기존 방식 시도
        return await originalSendToServer(data, retryCount);
      } catch (error) {
        console.log('🚨 기존 방식 실패, XHR로 재시도:', error.message);
        
        // XHR 방식으로 재시도
        try {
          const url = new URL(`${CONFIG.EC2_URL}/api/ask`);
          url.searchParams.set('securityMode', CONFIG.SECURITY_MODE.toString());
          
          const response = await forceProcessResponse(url.toString(), data);
          
          // 응답 처리
          if (response && response.trim()) {
            const formattedResponses = formatServerResponse(response.trim());
            formattedResponses.forEach((message) => {
              if (typeof message === 'string') {
                sendChatMessage('bot', message);
              } else if (message && message.text) {
                sendChatMessage('bot', message.text, message.backgroundColor, message.borderColor);
              }
            });
          }
          
          return true;
        } catch (xhrError) {
          console.error('🚨 XHR 방식도 실패:', xhrError);
          sendChatMessage('bot', `❌ 긴급 패치 실패: ${xhrError.message}`);
          return false;
        }
      }
    };
  }
  
  console.log('✅ 긴급 패치 활성화 완료');
}

// Windows 환경에서만 자동 활성화
if (navigator.platform.toLowerCase().includes('win')) {
  console.log('🔍 Windows 환경 감지, 긴급 패치 준비');
  
  // DOM 로드 후 활성화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(activateEmergencyPatch, 2000);
    });
  } else {
    setTimeout(activateEmergencyPatch, 2000);
  }
}

// 수동 활성화 함수 (콘솔에서 호출 가능)
window.activateEmergencyPatch = activateEmergencyPatch;